use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

use serde_json::Value;
use zvid_capture::record::{AudioBlock, RecordError, RecordStats, Recorded};
use zvid_capture::{
    CaptureError, ColorInfo, DeviceId, Format, Frame, HostTime, PixelFormat, Rotation, Selection,
    SessionStats, Transport,
};
use zvid_daw_core::{LiveStatus, LocalTime, Recording, TapWriter, audio_tap};
use zvid_daw_ui::Phase;

use super::*;

const WAIT: Duration = Duration::from_secs(5);

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        thread::sleep(Duration::from_millis(5));
    }
}

fn device(id: &str, name: &str, transport: Transport) -> Device {
    Device {
        id: DeviceId(id.to_string()),
        name: name.to_string(),
        transport,
    }
}

fn frame(sequence: u64) -> Arc<Frame> {
    Arc::new(Frame {
        width: 2,
        height: 2,
        format: PixelFormat::Nv12,
        color: ColorInfo {
            bt709: true,
            full_range: false,
        },
        rotation: Rotation::None,
        pts: HostTime::from_nanos(1_000_000_000 + sequence * 33_333_333),
        sequence,
        data: vec![0; Frame::nv12_len(2, 2)],
    })
}

/// The camera the fake has open.
struct Open {
    id: String,
    frames: FrameSink,
    preview: PreviewSink,
    count: Arc<AtomicU64>,
}

struct FakeSession {
    selection: Selection,
    count: Arc<AtomicU64>,
}

impl CameraSession for FakeSession {
    fn selection(&self) -> Selection {
        self.selection
    }

    fn stats(&self) -> SessionStats {
        SessionStats {
            frames: self.count.load(Ordering::Relaxed),
            ..SessionStats::default()
        }
    }
}

#[derive(Default)]
struct FileState {
    filename: String,
    stats: Mutex<RecordStats>,
    audio: Mutex<Vec<AudioBlock>>,
    stopped: AtomicBool,
}

struct FakeFile(Arc<FileState>);

impl CaptureFile for FakeFile {
    fn filename(&self) -> &str {
        &self.0.filename
    }

    fn push_frame(&self, frame: Arc<Frame>) {
        let mut stats = lock(&self.0.stats);
        let file_sec = stats.frames_written as f64 / 30.0;
        stats.frames_received += 1;
        stats.frames_written += 1;
        stats.frame_clock = Some(FrameClock {
            host_time: frame.pts,
            file_sec,
        });
    }

    fn push_audio(&self, block: AudioBlock) {
        assert!(
            !self.0.stopped.load(Ordering::Acquire),
            "audio after the file finished"
        );
        lock(&self.0.audio).push(block);
    }

    fn stats(&self) -> RecordStats {
        lock(&self.0.stats).clone()
    }

    fn stop(self: Box<Self>) -> Result<Recorded, RecordError> {
        self.0.stopped.store(true, Ordering::Release);
        let stats = self.stats();
        Ok(Recorded {
            filename: self.0.filename.clone(),
            dimensions: (1920, 1080),
            fps: Rational::new(30, 1),
            duration_sec: stats.frames_written as f64 / 30.0,
            codec: "fake",
            has_audio: false,
            zero: HostTime::from_nanos(0),
            stats,
        })
    }
}

#[derive(Default)]
struct Fake {
    devices: Mutex<Vec<Device>>,
    /// Errors `open` returns, by device ID.
    refuse: Mutex<HashMap<String, CaptureError>>,
    open: Mutex<Option<Open>>,
    hotplug: Mutex<Option<DeviceSink>>,
    files: Mutex<Vec<Arc<FileState>>>,
    configs: Mutex<Vec<RecordConfig>>,
}

impl Fake {
    fn new(devices: Vec<Device>) -> Arc<Self> {
        Arc::new(Self {
            devices: Mutex::new(devices),
            ..Self::default()
        })
    }

    /// Delivers a frame and a preview from the open camera.
    fn deliver(&self, sequence: u64) {
        let mut open = lock(&self.open);
        let open = open.as_mut().expect("a camera is open");
        open.count.fetch_add(1, Ordering::Relaxed);
        (open.frames)(&frame(sequence));
        (open.preview)(vec![0xFF, 0xD8, sequence as u8]);
    }

    fn open_id(&self) -> Option<String> {
        lock(&self.open).as_ref().map(|open| open.id.clone())
    }

    fn plug(&self, event: DeviceEvent) {
        {
            let mut devices = lock(&self.devices);
            match &event {
                DeviceEvent::Removed(device) => devices.retain(|known| known.id != device.id),
                DeviceEvent::Added(device) | DeviceEvent::Changed(device) => {
                    devices.push(device.clone())
                }
            }
        }
        let mut hotplug = lock(&self.hotplug);
        (hotplug.as_mut().expect("watching"))(event);
    }

    fn file(&self, index: usize) -> Arc<FileState> {
        Arc::clone(&lock(&self.files)[index])
    }
}

impl Platform for Fake {
    fn devices(&self) -> Result<Vec<Device>, CaptureError> {
        Ok(lock(&self.devices).clone())
    }

    fn watch(&self, on_event: DeviceSink) -> Result<Box<dyn Any>, CaptureError> {
        *lock(&self.hotplug) = Some(on_event);
        Ok(Box::new(()))
    }

    fn open(
        &self,
        device: &DeviceId,
        frames: FrameSink,
        preview: PreviewSink,
    ) -> Result<Box<dyn CameraSession>, CaptureError> {
        if let Some(error) = lock(&self.refuse).get(&device.0) {
            return Err(error.clone());
        }
        let count = Arc::new(AtomicU64::new(0));
        *lock(&self.open) = Some(Open {
            id: device.0.clone(),
            frames,
            preview,
            count: Arc::clone(&count),
        });
        let portrait = device.0 == "iphone";
        let (width, height) = if portrait { (1080, 1920) } else { (1920, 1080) };
        Ok(Box::new(FakeSession {
            selection: Selection {
                index: 0,
                format: Format {
                    width,
                    height,
                    fps: Rational::new(60, 1),
                },
                fps: Rational::new(30, 1),
            },
            count,
        }))
    }

    fn record(&self, config: RecordConfig) -> Result<Box<dyn CaptureFile>, RecordError> {
        let file = Arc::new(FileState {
            filename: format!("video-{:02}-9-25-20-36-12-0.mp4", config.counter),
            ..FileState::default()
        });
        lock(&self.files).push(Arc::clone(&file));
        lock(&self.configs).push(config);
        Ok(Box::new(FakeFile(file)))
    }

    fn now_sec(&self) -> f64 {
        42.0
    }

    fn local_time(&self) -> LocalTime {
        LocalTime {
            month: 9,
            day: 25,
            hour: 20,
            minute: 36,
            second: 12,
        }
    }
}

fn cameras() -> Vec<Device> {
    vec![
        device("builtin", "FaceTime HD Camera", Transport::BuiltIn),
        device("usb-1", "Logitech BRIO", Transport::Usb),
        device("iphone", "iPhone Camera", Transport::Continuity),
    ]
}

/// The platform the plugin's own tests start the backend on: a fake with
/// [`Rig`]'s cameras, so no test touches real hardware.
pub(crate) fn platform() -> Arc<dyn Platform> {
    Fake::new(cameras())
}

struct Rig {
    fake: Arc<Fake>,
    backend: Arc<CaptureBackend>,
    state: Arc<Mutex<State>>,
    commands: Receiver<Command>,
    takes: Sender<TakeChange>,
    /// The control thread's side of the Live companion's status.
    live: LiveSlot,
    dirty: Arc<AtomicU32>,
    root: RecordRoot,
    /// The format layer's side of the audio tap.
    tap: Option<Mutex<TapWriter>>,
}

impl Rig {
    fn new(state: State) -> Self {
        Self::with_stall(state, Duration::from_secs(60))
    }

    fn with_stall(state: State, stall: Duration) -> Self {
        Self::build(state, stall, true)
    }

    /// A rig whose format layer has no audio tap to give.
    fn without_tap() -> Self {
        Self::build(State::default(), Duration::from_secs(60), false)
    }

    fn build(state: State, stall: Duration, tapped: bool) -> Self {
        let fake = Fake::new(cameras());
        let state = Arc::new(Mutex::new(state));
        let (commands, command_reader) = mpsc::channel();
        let (takes, take_reader) = mpsc::channel();
        let live = LiveSlot::default();
        let dirty = Arc::new(AtomicU32::new(0));
        let counter = Arc::clone(&dirty);
        let root = RecordRoot::resolve_with(None, Some(std::path::Path::new("/nowhere"))).unwrap();
        let platform: Arc<dyn Platform> = fake.clone();
        let (tap, audio) = if tapped {
            let (writer, reader) = audio_tap(1 << 12);
            (Some(Mutex::new(writer)), Some(reader))
        } else {
            (None, None)
        };
        let backend = CaptureBackend::start_with(
            platform,
            HostLink {
                state: Arc::clone(&state),
                commands,
                takes: take_reader,
                live: live.clone(),
                state_changed: Box::new(move || {
                    counter.fetch_add(1, Ordering::Relaxed);
                }),
                record_root: root.clone(),
                audio,
            },
            stall,
        );
        let rig = Self {
            fake,
            backend,
            state,
            commands: command_reader,
            takes,
            live,
            dirty,
            root,
            tap,
        };
        wait_for("the camera list", || rig.backend.cameras().len() == 3);
        wait_for("the watcher", || lock(&rig.fake.hotplug).is_some());
        rig
    }

    fn events(&self) -> Vec<Value> {
        self.backend
            .channels()
            .events
            .poll(Some(0), Duration::ZERO, &AtomicBool::new(false))
            .events
            .iter()
            .map(|json| serde_json::from_str(json).unwrap())
            .collect()
    }

    fn named(&self, name: &str) -> Vec<Value> {
        self.events()
            .into_iter()
            .filter(|event| event["event"] == name)
            .collect()
    }

    fn wait_for_event(&self, name: &str, count: usize) -> Vec<Value> {
        wait_for(name, || self.named(name).len() >= count);
        self.named(name)
    }

    fn next_command(&self) -> Command {
        self.commands.recv_timeout(WAIT).expect("a command")
    }

    /// Plays a block of `frames` stereo frames through the tap, as the
    /// audio thread does, with sample values counting up from `start`.
    fn play(&self, host_time: f64, sample_rate: f64, frames: usize, start: f32) {
        let mut tap = lock(self.tap.as_ref().expect("a tap"));
        assert!(tap.push(host_time, sample_rate, frames, |frame| {
            let value = start + frame as f32;
            [value, -value]
        }));
    }

    /// Lets the monitor thread drain the tap a few times.
    fn settle(&self) {
        thread::sleep(TICK * 4);
    }
}

fn audio(file: &FileState) -> Vec<AudioBlock> {
    lock(&file.audio).clone()
}

fn recording(id: &str, filename: &str) -> Recording {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "filename": filename,
        "dimensions": [1920, 1080],
        "fps": [30, 1],
        "frameStart": 915,
        "fileOffsetSec": 1.5,
        "transportStartSec": 32.0,
        "transportStartBeats": 64.0,
        "durationSec": 2.0,
        "tempo": 120.0,
        "timeSignature": [4, 4],
        "camera": "Logitech BRIO",
        "createdAt": "2026-09-25T20:36:12Z",
    }))
    .unwrap()
}

#[test]
fn follows_the_live_companion() {
    let rig = Rig::new(State::default());
    assert_eq!(rig.backend.status().live, None);
    let before = rig.named("status").len();
    let status = |record_mode, session_record| LiveStatus {
        record_mode,
        session_record,
        ..LiveStatus::default()
    };

    rig.live.set(Some(status(false, false)));
    let statuses = rig.wait_for_event("status", before + 1);
    assert_eq!(
        statuses[before]["payload"]["live"],
        serde_json::json!({ "recordArmed": false })
    );

    rig.live.set(Some(status(false, true)));
    let statuses = rig.wait_for_event("status", before + 2);
    assert_eq!(statuses[before + 1]["payload"]["live"]["recordArmed"], true);
    assert_eq!(
        rig.backend.status().live,
        Some(LiveInfo { record_armed: true })
    );

    // Changes the editor doesn't show send nothing.
    rig.live.set(Some(LiveStatus {
        is_playing: true,
        ..status(true, false)
    }));
    rig.settle();
    assert_eq!(rig.named("status").len(), before + 2);

    rig.live.set(None);
    let statuses = rig.wait_for_event("status", before + 3);
    assert_eq!(statuses[before + 2]["payload"]["live"], Value::Null);
    assert_eq!(rig.backend.status().live, None);
}

#[test]
fn lists_cameras_and_follows_hot_plug() {
    let rig = Rig::new(State::default());
    let cameras = rig.backend.cameras();
    assert_eq!(cameras[0].id, "builtin");
    assert_eq!(cameras[1].transport, zvid_daw_ui::Transport::Usb);
    assert_eq!(cameras[2].transport, zvid_daw_ui::Transport::Continuity);
    assert_eq!(rig.named("camerasChanged").len(), 1);
    assert_eq!(rig.backend.status(), Status::default());

    rig.fake.plug(DeviceEvent::Added(device(
        "phone-link",
        "Pixel 8",
        Transport::Virtual,
    )));
    let changed = rig.wait_for_event("camerasChanged", 2);
    let menu = &changed[1]["payload"];
    assert_eq!(menu.as_array().unwrap().len(), 4);
    assert_eq!(menu[3]["transport"], "virtual");

    rig.fake.plug(DeviceEvent::Removed(device(
        "builtin",
        "FaceTime HD Camera",
        Transport::BuiltIn,
    )));
    rig.wait_for_event("camerasChanged", 3);
    assert_eq!(rig.backend.cameras().len(), 3);
    assert_eq!(rig.backend.refresh_devices().unwrap().len(), 3);
}

#[test]
fn walks_through_ready_capturing_and_ready() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("usb-1").unwrap();
    assert_eq!(rig.fake.open_id().as_deref(), Some("usb-1"));
    let status = rig.backend.status();
    assert_eq!(status.phase, Phase::Ready);
    assert_eq!(status.camera_id.as_deref(), Some("usb-1"));
    assert_eq!(
        status.format,
        Some(VideoFormat {
            width: 1920,
            height: 1080,
            fps: [30, 1],
        })
    );
    // The choice is in the state, and the host was told.
    assert_eq!(
        lock(&rig.state).camera,
        Some(CameraChoice {
            id: "usb-1".to_string(),
            name: "Logitech BRIO".to_string(),
        })
    );
    assert_eq!(rig.dirty.load(Ordering::Relaxed), 1);
    // Choosing it again changes nothing.
    rig.backend.select_camera("usb-1").unwrap();
    assert_eq!(rig.dirty.load(Ordering::Relaxed), 1);

    // Preview frames reach the preview slot.
    rig.fake.deliver(0);
    assert_eq!(
        &*rig.backend.channels().preview.latest().unwrap().jpeg,
        &[0xFF, 0xD8, 0]
    );

    rig.backend.arm().unwrap();
    let Command::Arm { capture, at } = rig.next_command() else {
        panic!("expected an arm");
    };
    assert_eq!(at, 42.0);
    assert_eq!(capture.filename, "video-01-9-25-20-36-12-0.mp4");
    assert_eq!(capture.dimensions, [1920, 1080]);
    assert_eq!(capture.fps, [30, 1]);
    assert_eq!(capture.camera, "Logitech BRIO");
    assert!(capture.created_at.ends_with('Z'));
    let config = lock(&rig.fake.configs)[0].clone();
    assert_eq!((config.counter, config.fps), (1, Rational::new(30, 1)));
    assert_eq!(config.root, rig.root);
    // The host hasn't processed any audio, so there is no format to record.
    assert_eq!(config.audio, None);
    let status = rig.backend.status();
    assert_eq!(status.phase, Phase::Capturing);
    assert_eq!(status.capture.unwrap().takes, 0);
    // Arming twice keeps the capture; the camera can't change meanwhile.
    rig.backend.arm().unwrap();
    assert_eq!(
        rig.backend.select_camera("builtin").unwrap_err().code,
        ErrorCode::InvalidRequest
    );

    // Frames go to the file, and its frame clock to the control thread.
    rig.fake.deliver(1);
    rig.fake.deliver(2);
    assert_eq!(
        lock(&rig.fake.file(0).stats).frames_written,
        2,
        "frames are recorded while armed"
    );
    let mut clock = None;
    wait_for("the frame clock", || {
        while let Ok(command) = rig.commands.try_recv() {
            if let Command::FrameClock {
                host_time,
                file_sec,
            } = command
            {
                clock = Some((host_time, file_sec));
            }
        }
        clock.is_some_and(|(_, file_sec)| file_sec > 0.0)
    });
    let (host_time, file_sec) = clock.unwrap();
    assert!((host_time - (1.0 + 2.0 * 0.033_333_333)).abs() < 1e-6);
    assert!((file_sec - 1.0 / 30.0).abs() < 1e-9);

    // Takes the control thread opens and closes reach the editor.
    rig.takes
        .send(TakeChange::Opened {
            index: 0,
            id: "video-01-9-25-20-36-12-0-take-1".to_string(),
        })
        .unwrap();
    let opened = rig.wait_for_event("takeOpened", 1);
    assert_eq!(opened[0]["payload"]["index"], 0);
    wait_for("the take count", || {
        rig.backend.status().capture.is_some_and(|c| c.takes == 1)
    });
    let take = recording(
        "video-01-9-25-20-36-12-0-take-1",
        "video-01-9-25-20-36-12-0.mp4",
    );
    lock(&rig.state).recordings.push(take.clone());
    rig.takes.send(TakeChange::Closed(take)).unwrap();
    let closed = rig.wait_for_event("takeClosed", 1);
    assert_eq!(
        closed[0]["payload"]["id"],
        "video-01-9-25-20-36-12-0-take-1"
    );
    assert_eq!(closed[0]["payload"]["fileOffsetSec"], 1.5);
    assert_eq!(closed[0]["payload"]["missing"], true);

    rig.backend.disarm().unwrap();
    let mut disarmed = false;
    while let Ok(command) = rig.commands.recv_timeout(WAIT) {
        if command == (Command::Disarm { at: 42.0 }) {
            disarmed = true;
            break;
        }
    }
    assert!(disarmed);
    wait_for("the file to finish", || {
        rig.fake.file(0).stopped.load(Ordering::Acquire)
    });
    // Frames after disarm aren't recorded.
    rig.fake.deliver(3);
    assert_eq!(lock(&rig.fake.file(0).stats).frames_written, 2);
    assert_eq!(rig.backend.status().phase, Phase::Ready);
    rig.backend.disarm().unwrap();

    // The next capture gets the next counter.
    rig.backend.arm().unwrap();
    assert_eq!(lock(&rig.fake.configs)[1].counter, 2);
    rig.backend.disarm().unwrap();

    let phases: Vec<Value> = rig
        .named("status")
        .iter()
        .map(|event| event["payload"]["phase"].clone())
        .collect();
    assert!(phases.contains(&Value::from("capturing")));
    assert_eq!(phases.last(), Some(&Value::from("ready")));
}

#[test]
fn records_timed_input_audio_while_armed() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("usb-1").unwrap();
    // Audio before arm isn't recorded, but sets the capture's format.
    rig.play(9.0, 48_000.0, 2, 0.0);
    rig.settle();
    rig.backend.arm().unwrap();
    assert_eq!(
        lock(&rig.fake.configs)[0].audio,
        Some(AudioFormat {
            sample_rate: 48_000,
            channels: 2,
        })
    );
    let file = rig.fake.file(0);

    // Blocks reach the file with their host time, in order.
    rig.play(10.0, 48_000.0, 2, 1.0);
    rig.play(10.25, 48_000.0, 1, 5.0);
    wait_for("the audio", || audio(&file).len() == 2);
    assert_eq!(
        audio(&file),
        [
            AudioBlock {
                host_time: Some(HostTime::from_nanos(10_000_000_000)),
                samples: vec![1.0, -1.0, 2.0, -2.0],
            },
            AudioBlock {
                host_time: Some(HostTime::from_nanos(10_250_000_000)),
                samples: vec![5.0, -5.0],
            },
        ]
    );

    // A block at another rate can't go in this file.
    rig.play(10.5, 44_100.0, 1, 7.0);
    rig.settle();
    assert_eq!(audio(&file).len(), 2);

    // What was tapped before disarm is recorded, even if the monitor
    // thread hasn't drained it yet.
    rig.play(10.75, 48_000.0, 1, 8.0);
    rig.backend.disarm().unwrap();
    wait_for("the file to finish", || {
        file.stopped.load(Ordering::Acquire)
    });
    assert_eq!(audio(&file).len(), 3);
    assert_eq!(audio(&file)[2].samples, [8.0, -8.0]);
    // Audio after disarm isn't.
    rig.play(11.0, 48_000.0, 1, 9.0);
    rig.settle();
    assert_eq!(audio(&file).len(), 3);

    // The next capture records at the bus's new rate.
    rig.play(12.0, 44_100.0, 1, 0.0);
    rig.backend.arm().unwrap();
    assert_eq!(
        lock(&rig.fake.configs)[1].audio,
        Some(AudioFormat {
            sample_rate: 44_100,
            channels: 2,
        })
    );
    rig.play(12.5, 44_100.0, 1, 3.0);
    let second = rig.fake.file(1);
    wait_for("the audio", || audio(&second).len() == 1);
    assert_eq!(
        audio(&second)[0].host_time,
        Some(HostTime::from_nanos(12_500_000_000))
    );
    rig.backend.disarm().unwrap();
}

#[test]
fn records_video_only_without_a_tap() {
    let rig = Rig::without_tap();
    rig.backend.select_camera("usb-1").unwrap();
    rig.backend.arm().unwrap();
    assert_eq!(lock(&rig.fake.configs)[0].audio, None);
    rig.fake.deliver(0);
    rig.settle();
    rig.backend.disarm().unwrap();
    let file = rig.fake.file(0);
    wait_for("the file to finish", || {
        file.stopped.load(Ordering::Acquire)
    });
    assert_eq!(lock(&file.stats).frames_written, 1);
    assert!(audio(&file).is_empty());
}

#[test]
fn an_unanchored_capture_only_announces_its_close() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("builtin").unwrap();
    rig.backend.arm().unwrap();
    rig.backend.disarm().unwrap();
    // The control thread opens and closes the one take after disarm.
    let take = recording("video-01-take-1", "video-01.mp4");
    rig.takes
        .send(TakeChange::Opened {
            index: 0,
            id: take.id.clone(),
        })
        .unwrap();
    rig.takes.send(TakeChange::Closed(take)).unwrap();
    rig.wait_for_event("takeClosed", 1);
    assert!(rig.named("takeOpened").is_empty());
}

#[test]
fn lists_takes_from_the_state() {
    let rig = Rig::new(State {
        recordings: vec![
            recording("a", "video-01.mp4"),
            recording("b", "video-02.mp4"),
        ],
        ..State::default()
    });
    let takes = rig.backend.takes();
    assert_eq!(takes.len(), 2);
    assert_eq!(takes[0].id, "b");
    let file = rig.backend.take_file("a").unwrap();
    assert_eq!(file.path, rig.root.dir.join("video-01.mp4"));
    assert_eq!(file.file_offset_sec, 1.5);
    assert!(rig.backend.take_file("nope").is_none());
}

#[test]
fn restores_the_stored_camera_by_id_then_by_name() {
    let choice = |id: &str, name: &str| CameraChoice {
        id: id.to_string(),
        name: name.to_string(),
    };
    // The ID changed (another machine), so the name finds it.
    let rig = Rig::new(State {
        camera: Some(choice("usb-elsewhere", "Logitech BRIO")),
        ..State::default()
    });
    wait_for("the restored camera", || {
        rig.fake.open_id().as_deref() == Some("usb-1")
    });
    assert_eq!(rig.backend.status().phase, Phase::Ready);
    // Restoring doesn't mark the set as modified.
    assert_eq!(rig.dirty.load(Ordering::Relaxed), 0);

    // The host loads a state whose camera matches by ID.
    lock(&rig.state).camera = Some(choice("iphone", "Renamed iPhone"));
    wait_for("the loaded camera", || {
        rig.fake.open_id().as_deref() == Some("iphone")
    });
    let status = rig.backend.status();
    assert_eq!(status.camera_id.as_deref(), Some("iphone"));
    assert_eq!(status.format.unwrap().height, 1920);
}

#[test]
fn opens_the_stored_camera_once_it_is_plugged_in() {
    let rig = Rig::new(State {
        camera: Some(CameraChoice {
            id: "cam-link".to_string(),
            name: "Cam Link 4K".to_string(),
        }),
        ..State::default()
    });
    thread::sleep(TICK * 2);
    assert_eq!(rig.backend.status().phase, Phase::NoCamera);
    rig.fake.plug(DeviceEvent::Added(device(
        "cam-link",
        "Cam Link 4K",
        Transport::Usb,
    )));
    wait_for("the camera to open", || {
        rig.fake.open_id().as_deref() == Some("cam-link")
    });
    assert_eq!(rig.backend.status().phase, Phase::Ready);
}

#[test]
fn reports_permission_denied_and_device_busy() {
    let rig = Rig::new(State::default());
    lock(&rig.fake.refuse).insert("builtin".to_string(), CaptureError::PermissionDenied);
    lock(&rig.fake.refuse).insert("usb-1".to_string(), CaptureError::DeviceBusy);

    let error = rig.backend.select_camera("builtin").unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let status = rig.backend.status();
    assert_eq!(status.phase, Phase::Error);
    assert_eq!(status.camera_id.as_deref(), Some("builtin"));
    assert_eq!(status.error.unwrap().code, ErrorCode::PermissionDenied);
    assert_eq!(
        rig.backend.arm().unwrap_err().code,
        ErrorCode::InvalidRequest
    );
    assert!(rig.backend.channels().preview.latest().is_none());

    let error = rig.backend.select_camera("usb-1").unwrap_err();
    assert_eq!(error.code, ErrorCode::DeviceBusy);
    assert_eq!(
        rig.backend.status().error.unwrap().code,
        ErrorCode::DeviceBusy
    );
    let errors = rig.named("error");
    assert_eq!(errors[0]["payload"]["code"], "permissionDenied");
    assert_eq!(errors[1]["payload"]["code"], "deviceBusy");

    // The other app lets go; Refresh devices tries the camera again.
    lock(&rig.fake.refuse).clear();
    rig.backend.refresh_devices().unwrap();
    assert_eq!(rig.fake.open_id().as_deref(), Some("usb-1"));
    let status = rig.backend.status();
    assert_eq!((status.phase, status.error), (Phase::Ready, None));

    assert_eq!(
        rig.backend.select_camera("nope").unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[test]
fn a_camera_lost_mid_capture_stops_the_capture_and_keeps_the_footage() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("usb-1").unwrap();
    rig.backend.arm().unwrap();
    rig.fake.deliver(0);
    rig.fake.plug(DeviceEvent::Removed(device(
        "usb-1",
        "Logitech BRIO",
        Transport::Usb,
    )));
    wait_for("the error", || rig.backend.status().phase == Phase::Error);
    let status = rig.backend.status();
    assert_eq!(status.error.as_ref().unwrap().code, ErrorCode::DeviceLost);
    assert_eq!(status.capture, None);
    let errors = rig.wait_for_event("error", 1);
    assert_eq!(errors[0]["payload"]["code"], "deviceLost");
    assert!(
        errors[0]["payload"]["message"]
            .as_str()
            .unwrap()
            .starts_with("Capture stopped: the camera was disconnected.")
    );
    let commands: Vec<Command> = rig.commands.try_iter().collect();
    assert!(matches!(commands[0], Command::Arm { .. }));
    assert_eq!(commands.last(), Some(&Command::Disarm { at: 42.0 }));
    wait_for("the file to finish", || {
        rig.fake.file(0).stopped.load(Ordering::Acquire)
    });
    assert_eq!(lock(&rig.fake.file(0).stats).frames_written, 1);
    assert!(rig.backend.channels().preview.latest().is_none());

    // Plugging it back in reopens it.
    rig.fake.plug(DeviceEvent::Added(device(
        "usb-1",
        "Logitech BRIO",
        Transport::Usb,
    )));
    wait_for("the camera to reopen", || {
        rig.backend.status().phase == Phase::Ready
    });
}

#[test]
fn a_camera_that_stops_sending_video_fails() {
    let rig = Rig::with_stall(State::default(), Duration::from_millis(200));
    rig.backend.select_camera("builtin").unwrap();
    wait_for("the stall", || rig.backend.status().phase == Phase::Error);
    let error = rig.backend.status().error.unwrap();
    assert_eq!(error.code, ErrorCode::DeviceLost);
    assert_eq!(error.message, "The camera stopped sending video.");
}

#[test]
fn a_recorder_failure_stops_the_capture() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("builtin").unwrap();
    rig.backend.arm().unwrap();
    lock(&rig.fake.file(0).stats).frames_dropped = 3;
    wait_for("the dropped frames", || {
        rig.backend
            .status()
            .capture
            .is_some_and(|capture| capture.dropped_frames == 3)
    });
    lock(&rig.fake.file(0).stats).error = Some("disk full".to_string());
    wait_for("the error", || rig.backend.status().phase == Phase::Error);
    let error = rig.backend.status().error.unwrap();
    assert_eq!(error.code, ErrorCode::Internal);
    assert!(error.message.contains("disk full"));
    wait_for("the file to finish", || {
        rig.fake.file(0).stopped.load(Ordering::Acquire)
    });
}

#[test]
fn dropping_the_backend_finishes_the_capture() {
    let rig = Rig::new(State::default());
    rig.backend.select_camera("builtin").unwrap();
    rig.backend.arm().unwrap();
    let file = rig.fake.file(0);
    let Rig {
        backend, commands, ..
    } = rig;
    drop(backend);
    wait_for("the backend to go", || {
        commands
            .try_iter()
            .any(|command| matches!(command, Command::Disarm { .. }))
    });
    wait_for("the file to finish", || {
        file.stopped.load(Ordering::Acquire)
    });
}
