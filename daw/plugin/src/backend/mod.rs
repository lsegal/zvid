//! The editor's [`Backend`], over camera capture, recording and the take
//! log.
//!
//! - **Cameras** come from `zvid-capture`. A hot-plug watcher keeps the
//!   list current and emits `camerasChanged`.
//! - **Selection** opens the camera for preview and stores the choice in
//!   the plugin state. The stored choice is restored, by unique ID and then
//!   by name, when the backend starts and whenever the host loads a state
//!   with a different choice.
//! - **Capture**: [`Backend::arm`] starts a capture file and sends
//!   [`Command::Arm`] to the format layer's control thread, which turns
//!   play/stop spans into takes. Frames go to the file while armed, and the
//!   file's frame clock is forwarded as [`Command::FrameClock`].
//!   [`Backend::disarm`] sends [`Command::Disarm`] and finalizes the file
//!   on a worker thread.
//! - **Takes** the control thread opens and closes arrive as
//!   [`TakeChange`]s and become `takeOpened` and `takeClosed` events.
//! - **Failures**: when the camera is unplugged, stops sending video, or
//!   the recorder fails, the capture stops, the footage so far is kept, and
//!   the editor gets an error status and an `error` event.
//!
//! Commands run on the editor's worker threads. A monitor thread owned by
//! the backend applies take changes, hot-plug events and recorder progress.
//! None of this touches the audio thread.

mod local_time;
pub mod map;
mod platform;

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use zvid_capture::record::{FrameClock, RecordConfig, VideoEncoderChoice};
use zvid_capture::{Device, DeviceEvent, Rational};
use zvid_daw_core::{CameraChoice, Capture, Command, RecordRoot, State, TakeChange};
use zvid_daw_ui::mock::rfc3339_utc;
use zvid_daw_ui::{
    Backend, Camera, CaptureInfo, Channels, ErrorCode, Status, TakeFile, TakeInfo, UiError,
    UiEvent, VideoFormat, takes_from_state,
};

pub use platform::{
    CameraSession, CaptureFile, DeviceSink, FrameSink, Platform, PreviewSink, System,
};

use map::StatusInputs;

/// How often the monitor thread applies take changes, hot-plug events and
/// recorder progress.
const TICK: Duration = Duration::from_millis(50);
/// An open camera that delivers no frame for this long has failed.
const STALL: Duration = Duration::from_secs(5);

/// The format layer's side of the backend: what VST3's `Component` and
/// AU's `AudioUnitInstance` expose for the editor.
pub struct HostLink {
    /// The persisted plugin state (`shared_state()`).
    pub state: Arc<Mutex<State>>,
    /// Where capture commands go (`commands()`).
    pub commands: Sender<Command>,
    /// Takes the control thread opens and closes (`take_changes()`).
    pub takes: Receiver<TakeChange>,
    /// Tells the host the state changed, so it marks the set as modified.
    pub state_changed: Box<dyn Fn() + Send + Sync>,
    /// Where capture files are written.
    pub record_root: RecordRoot,
}

pub struct CaptureBackend {
    platform: Arc<dyn Platform>,
    channels: Arc<Channels>,
    state: Arc<Mutex<State>>,
    commands: Sender<Command>,
    state_changed: Box<dyn Fn() + Send + Sync>,
    root: RecordRoot,
    stall: Duration,
    inner: Mutex<Inner>,
    /// The file frames are recorded to while armed. The capture thread
    /// reads it for every frame, so it has its own lock.
    recorder: Arc<Mutex<Option<Box<dyn CaptureFile>>>>,
}

#[derive(Default)]
struct Inner {
    devices: Vec<Device>,
    /// The chosen camera, whether or not it is open.
    selected: Option<Device>,
    camera: Option<OpenCamera>,
    error: Option<UiError>,
    capture: Option<Active>,
    /// Captures started by this instance, the `NN` in file names.
    captures: u32,
    /// The state's camera choice as last applied, to notice state loads.
    choice: Option<CameraChoice>,
    /// Bumped whenever the camera is opened or closed, so an open that was
    /// overtaken by another is discarded.
    generation: u64,
}

struct OpenCamera {
    session: Box<dyn CameraSession>,
    format: VideoFormat,
    fps: Rational,
    /// Frames seen at `frames_at`, to notice a camera that stopped.
    frames: u64,
    frames_at: Instant,
}

/// The capture in progress.
struct Active {
    started: Instant,
    takes: u32,
    dropped: u64,
    clock: Option<FrameClock>,
}

impl CaptureBackend {
    /// Starts the backend and its monitor thread, which lists the cameras
    /// and restores the camera stored in the state.
    pub fn start(platform: Arc<dyn Platform>, link: HostLink) -> Arc<Self> {
        Self::start_with(platform, link, STALL)
    }

    fn start_with(platform: Arc<dyn Platform>, link: HostLink, stall: Duration) -> Arc<Self> {
        let HostLink {
            state,
            commands,
            takes,
            state_changed,
            record_root,
        } = link;
        let backend = Arc::new(Self {
            platform,
            channels: Arc::new(Channels::new()),
            state,
            commands,
            state_changed,
            root: record_root,
            stall,
            inner: Mutex::new(Inner::default()),
            recorder: Arc::new(Mutex::new(None)),
        });
        let weak = Arc::downgrade(&backend);
        let spawned = thread::Builder::new()
            .name("zvid-editor-backend".to_string())
            .spawn(move || monitor(weak, takes));
        if let Err(error) = spawned {
            log(&format!("could not start the backend thread: {error}"));
        }
        backend
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        lock(&self.inner)
    }

    fn emit(&self, event: &UiEvent) {
        self.channels.events.emit(event);
    }

    fn emit_status(&self) {
        self.emit(&UiEvent::Status(self.status()));
    }

    fn send(&self, command: Command) {
        if self.commands.send(command).is_err() {
            log("the plugin's control thread is gone; the command was dropped");
        }
    }

    /// Lists the cameras for the first time.
    fn load_devices(&self) {
        match self.platform.devices() {
            Ok(devices) => {
                let cameras = map::cameras(&devices);
                self.lock().devices = devices;
                self.emit(&UiEvent::CamerasChanged(cameras));
            }
            Err(error) => log(&format!("could not list cameras: {error}")),
        }
    }

    /// Opens the camera stored in the state if it changed since it was
    /// last applied: at start, and when the host loads a state.
    fn restore(&self) {
        let choice = lock(&self.state).camera.clone();
        let mut inner = self.lock();
        if inner.choice == choice {
            return;
        }
        inner.choice = choice.clone();
        if inner.capture.is_some() {
            return;
        }
        let device = choice
            .as_ref()
            .and_then(|choice| map::find_choice(choice, &inner.devices))
            .cloned();
        drop(inner);
        // A camera that isn't connected yet opens when it appears.
        if let Some(device) = device {
            log(&format!("restoring camera {:?}", device.name));
            let _ = self.open_camera(device);
        }
    }

    /// Opens `device` in place of the current camera. The camera opens
    /// without the lock held, since the system may ask for permission.
    fn open_camera(&self, device: Device) -> Result<(), UiError> {
        let (previous, generation) = {
            let mut inner = self.lock();
            if inner.capture.is_some() {
                return Err(UiError::new(
                    ErrorCode::InvalidRequest,
                    "Stop capturing before switching cameras.",
                ));
            }
            inner.generation += 1;
            inner.selected = Some(device.clone());
            inner.error = None;
            (inner.camera.take(), inner.generation)
        };
        drop(previous);
        self.channels.preview.clear();
        self.emit_status();

        let recorder = Arc::clone(&self.recorder);
        let frames: FrameSink = Box::new(move |frame| {
            if let Some(file) = lock(&recorder).as_ref() {
                file.push_frame(Arc::clone(frame));
            }
        });
        let channels = Arc::clone(&self.channels);
        let preview: PreviewSink = Box::new(move |jpeg| channels.preview.publish(jpeg));
        let opened = self.platform.open(&device.id, frames, preview);

        let mut inner = self.lock();
        if inner.generation != generation {
            // Another camera was chosen meanwhile; that one wins.
            drop(inner);
            drop(opened);
            return Ok(());
        }
        match opened {
            Ok(session) => {
                let selection = session.selection();
                inner.camera = Some(OpenCamera {
                    session,
                    format: map::video_format(&selection),
                    fps: selection.fps,
                    frames: 0,
                    frames_at: Instant::now(),
                });
                drop(inner);
                log(&format!(
                    "opened {:?} at {} ({} fps)",
                    device.name, selection.format, selection.fps
                ));
                self.emit_status();
                Ok(())
            }
            Err(error) => {
                log(&format!("could not open {:?}: {error}", device.name));
                let error = map::capture_error(&error);
                inner.error = Some(error.clone());
                drop(inner);
                self.channels.preview.clear();
                self.emit_status();
                self.emit(&UiEvent::Error(error.clone()));
                Err(error)
            }
        }
    }

    /// The camera to open without being asked: the chosen camera again
    /// after it failed, or the stored choice once it is connected. With
    /// `any_error`, any failure is retried (the Refresh devices button);
    /// otherwise only a camera that went away is.
    fn camera_to_reopen(inner: &Inner, any_error: bool) -> Option<Device> {
        if inner.capture.is_some() || inner.camera.is_some() {
            return None;
        }
        let wanted = match (&inner.selected, &inner.error) {
            (Some(selected), Some(error))
                if any_error
                    || matches!(error.code, ErrorCode::DeviceLost | ErrorCode::NotFound) =>
            {
                CameraChoice {
                    id: selected.id.0.clone(),
                    name: selected.name.clone(),
                }
            }
            (None, _) => inner.choice.clone()?,
            _ => return None,
        };
        map::find_choice(&wanted, &inner.devices).cloned()
    }

    /// Stops the capture, if one is running, keeping what was recorded.
    /// The file is finalized on a worker thread, or before returning with
    /// `wait`.
    fn stop_capture(&self, inner: &mut Inner, wait: bool) {
        if inner.capture.take().is_none() {
            return;
        }
        let file = lock(&self.recorder).take();
        if let Some(clock) = file.as_ref().and_then(|file| file.stats().frame_clock) {
            // Place the take's end with the latest frame written.
            self.send(frame_clock(clock));
        }
        self.send(Command::Disarm {
            at: self.platform.now_sec(),
        });
        let Some(file) = file else {
            return;
        };
        let finish = move || match file.stop() {
            Ok(recorded) => log(&format!(
                "finished {} ({:.1} s)",
                recorded.filename, recorded.duration_sec
            )),
            Err(error) => log(&format!("could not finish the capture file: {error}")),
        };
        if wait {
            finish();
        } else if let Err(error) = thread::Builder::new()
            .name("zvid-capture-finish".to_string())
            .spawn(finish)
        {
            log(&format!("could not finish the capture file: {error}"));
        }
    }

    /// Stops the capture and closes the camera after a failure, and tells
    /// the editor why.
    fn fail(&self, error: UiError) {
        log(&format!("camera failed: {}", error.message));
        let mut inner = self.lock();
        self.stop_capture(&mut inner, false);
        inner.generation += 1;
        let camera = inner.camera.take();
        inner.error = Some(error.clone());
        drop(inner);
        drop(camera);
        self.channels.preview.clear();
        self.emit_status();
        self.emit(&UiEvent::Error(error));
    }

    fn take_changed(&self, change: TakeChange) {
        let mut inner = self.lock();
        let opened = match (&change, inner.capture.as_mut()) {
            (TakeChange::Opened { index, .. }, Some(active)) => {
                active.takes = active.takes.max(index + 1);
                true
            }
            // The capture already ended, as for an unanchored capture's
            // single take; only its close is news.
            (TakeChange::Opened { .. }, None) => return,
            (TakeChange::Closed(_), _) => false,
        };
        drop(inner);
        self.emit(&map::take_event(&change, &self.root));
        if opened {
            self.emit_status();
        }
    }

    fn device_event(&self, event: DeviceEvent) {
        let mut inner = self.lock();
        let lost = match &event {
            DeviceEvent::Removed(device) => {
                inner.devices.retain(|known| known.id != device.id);
                inner.camera.is_some()
                    && inner
                        .selected
                        .as_ref()
                        .is_some_and(|selected| selected.id == device.id)
            }
            DeviceEvent::Added(device) | DeviceEvent::Changed(device) => {
                match inner.devices.iter_mut().find(|known| known.id == device.id) {
                    Some(known) => *known = device.clone(),
                    None => inner.devices.push(device.clone()),
                }
                false
            }
        };
        let cameras = map::cameras(&inner.devices);
        let capturing = inner.capture.is_some();
        let reopen = Self::camera_to_reopen(&inner, false);
        drop(inner);
        self.emit(&UiEvent::CamerasChanged(cameras));
        if lost {
            self.fail(map::device_lost(capturing, "the camera was disconnected"));
        } else if let Some(device) = reopen {
            let _ = self.open_camera(device);
        }
    }

    /// Forwards recorder progress, and fails a capture whose recorder or
    /// camera stopped.
    fn tick(&self) {
        self.restore();
        let mut inner = self.lock();
        let mut changed = false;
        let stats = lock(&self.recorder).as_ref().map(|file| file.stats());
        if let (Some(active), Some(stats)) = (inner.capture.as_mut(), stats) {
            if stats.frame_clock != active.clock {
                active.clock = stats.frame_clock;
                if let Some(clock) = stats.frame_clock {
                    self.send(frame_clock(clock));
                }
            }
            if stats.frames_dropped != active.dropped {
                active.dropped = stats.frames_dropped;
                changed = true;
            }
            if let Some(error) = stats.error {
                drop(inner);
                self.fail(map::recording_failed(&error));
                return;
            }
        }
        if let Some(camera) = inner.camera.as_mut() {
            let frames = camera.session.stats().frames;
            if frames != camera.frames {
                camera.frames = frames;
                camera.frames_at = Instant::now();
            } else if camera.frames_at.elapsed() >= self.stall {
                let capturing = inner.capture.is_some();
                drop(inner);
                self.fail(map::device_lost(
                    capturing,
                    "the camera stopped sending video",
                ));
                return;
            }
        }
        drop(inner);
        if changed {
            self.emit_status();
        }
    }
}

impl Backend for CaptureBackend {
    fn cameras(&self) -> Vec<Camera> {
        map::cameras(&self.lock().devices)
    }

    fn select_camera(&self, id: &str) -> Result<(), UiError> {
        let (device, reopen) = {
            let inner = self.lock();
            if inner.capture.is_some() {
                return Err(UiError::new(
                    ErrorCode::InvalidRequest,
                    "Stop capturing before switching cameras.",
                ));
            }
            let device = inner
                .devices
                .iter()
                .find(|device| device.id.0 == id)
                .cloned();
            let open = inner.camera.is_some()
                && inner.error.is_none()
                && inner
                    .selected
                    .as_ref()
                    .is_some_and(|selected| selected.id.0 == id);
            (device, !open)
        };
        let device = match device {
            Some(device) => device,
            // The menu may be ahead of the list; look again.
            None => {
                self.refresh_devices()?;
                let inner = self.lock();
                inner
                    .devices
                    .iter()
                    .find(|device| device.id.0 == id)
                    .cloned()
                    .ok_or_else(|| {
                        UiError::new(ErrorCode::NotFound, "That camera is no longer connected.")
                    })?
            }
        };
        let choice = CameraChoice {
            id: device.id.0.clone(),
            name: device.name.clone(),
        };
        let changed = {
            let mut state = lock(&self.state);
            let changed = state.camera.as_ref() != Some(&choice);
            state.camera = Some(choice.clone());
            changed
        };
        self.lock().choice = Some(choice);
        if changed {
            (self.state_changed)();
        }
        if reopen {
            self.open_camera(device)
        } else {
            Ok(())
        }
    }

    fn refresh_devices(&self) -> Result<Vec<Camera>, UiError> {
        let devices = self
            .platform
            .devices()
            .map_err(|error| map::capture_error(&error))?;
        let mut inner = self.lock();
        inner.devices = devices;
        let cameras = map::cameras(&inner.devices);
        let retry = Self::camera_to_reopen(&inner, true);
        drop(inner);
        self.emit(&UiEvent::CamerasChanged(cameras.clone()));
        if let Some(device) = retry {
            let _ = self.open_camera(device);
        }
        Ok(cameras)
    }

    fn arm(&self) -> Result<(), UiError> {
        let mut inner = self.lock();
        if inner.capture.is_some() {
            return Ok(());
        }
        let (Some(device), Some(camera), None) = (&inner.selected, &inner.camera, &inner.error)
        else {
            return Err(UiError::new(
                ErrorCode::InvalidRequest,
                "Choose a working camera before recording.",
            ));
        };
        let counter = inner.captures + 1;
        let file = self
            .platform
            .record(RecordConfig {
                root: self.root.clone(),
                counter,
                armed_at: self.platform.local_time(),
                fps: camera.fps,
                // The input-bus tap isn't timed on the host clock yet, so
                // captures are video only.
                audio: None,
                video_encoder: VideoEncoderChoice::Auto,
            })
            .map_err(|error| {
                log(&format!("could not start recording: {error}"));
                UiError::new(
                    ErrorCode::Internal,
                    format!("Could not start recording: {error}."),
                )
            })?;
        let capture = Capture {
            filename: file.filename().to_string(),
            dimensions: [camera.format.width, camera.format.height],
            fps: camera.format.fps,
            camera: device.name.clone(),
            created_at: rfc3339_utc(SystemTime::now()),
        };
        log(&format!("recording to {}", capture.filename));
        let at = self.platform.now_sec();
        *lock(&self.recorder) = Some(file);
        self.send(Command::Arm { capture, at });
        inner.captures = counter;
        inner.capture = Some(Active {
            started: Instant::now(),
            takes: 0,
            dropped: 0,
            clock: None,
        });
        drop(inner);
        self.emit_status();
        Ok(())
    }

    fn disarm(&self) -> Result<(), UiError> {
        let mut inner = self.lock();
        if inner.capture.is_none() {
            return Ok(());
        }
        self.stop_capture(&mut inner, false);
        drop(inner);
        self.emit_status();
        Ok(())
    }

    fn status(&self) -> Status {
        let inner = self.lock();
        map::status(StatusInputs {
            camera_id: inner.selected.as_ref().map(|device| device.id.0.as_str()),
            format: inner.camera.as_ref().map(|camera| camera.format),
            capture: inner.capture.as_ref().map(|active| CaptureInfo {
                elapsed_ms: active.started.elapsed().as_millis() as u64,
                takes: active.takes,
                dropped_frames: active.dropped,
            }),
            error: inner.error.as_ref(),
        })
    }

    fn takes(&self) -> Vec<TakeInfo> {
        takes_from_state(&lock(&self.state), &self.root)
    }

    fn take_file(&self, id: &str) -> Option<TakeFile> {
        lock(&self.state)
            .recordings
            .iter()
            .find(|recording| recording.id == id)
            .map(|recording| TakeFile::from_recording(recording, &self.root))
    }

    fn channels(&self) -> &Channels {
        &self.channels
    }
}

impl Drop for CaptureBackend {
    fn drop(&mut self) {
        let mut inner = std::mem::take(&mut *self.lock());
        // Finish the file before the plugin can be unloaded.
        self.stop_capture(&mut inner, true);
        drop(inner);
        self.channels.preview.clear();
    }
}

/// Runs until the backend is dropped: restores the stored camera, then
/// applies take changes, hot-plug events and recorder progress.
fn monitor(backend: Weak<CaptureBackend>, takes: Receiver<TakeChange>) {
    let (events, hotplug) = mpsc::channel();
    // The watcher lives on this thread and stops when it ends.
    let _watcher = {
        let Some(backend) = backend.upgrade() else {
            return;
        };
        backend.load_devices();
        backend.restore();
        backend
            .platform
            .watch(Box::new(move |event| {
                let _ = events.send(event);
            }))
            .inspect_err(|error| log(&format!("could not watch for cameras: {error}")))
            .ok()
    };
    loop {
        let Some(backend) = backend.upgrade() else {
            return;
        };
        for change in takes.try_iter() {
            backend.take_changed(change);
        }
        for event in hotplug.try_iter() {
            backend.device_event(event);
        }
        backend.tick();
        drop(backend);
        thread::sleep(TICK);
    }
}

fn frame_clock(clock: FrameClock) -> Command {
    Command::FrameClock {
        host_time: clock.host_time.as_nanos() as f64 / 1e9,
        file_sec: clock.file_sec,
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Diagnostic log, like the format layers': stderr, plus the file named
/// by [`zvid_daw_core::LOG_ENV`] when set.
fn log(line: &str) {
    use std::io::Write;
    let line = format!("[zvid-backend] {line}\n");
    let _ = std::io::stderr().write_all(line.as_bytes());
    if let Some(path) = std::env::var_os(zvid_daw_core::LOG_ENV)
        && let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests;
