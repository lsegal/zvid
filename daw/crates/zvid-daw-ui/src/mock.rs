//! A scripted [`Backend`] for the harness and tests. It has no camera or
//! host: cameras are canned, the transport is driven by
//! [`MockBackend::set_playing`], the Live companion by
//! [`MockBackend::set_live`], and preview frames are a test pattern.
//!
//! Two cameras fail on purpose so the error states can be exercised:
//! [`DENIED_CAMERA`] (permission denied) and [`BUSY_CAMERA`] (in use).

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use zvid_daw_core::{RecordRoot, Recording, State};

use crate::backend::Backend;
use crate::channels::Channels;
use crate::image::encode_rgb;
use crate::model::{
    Camera, CaptureInfo, ErrorCode, LiveInfo, Phase, Status, TakeFile, TakeInfo, Transport, UiError,
    UiEvent, VideoFormat, takes_from_state,
};

pub const DENIED_CAMERA: &str = "mock-denied";
pub const BUSY_CAMERA: &str = "mock-busy";

/// Song tempo the mock transport runs at.
const TEMPO: f64 = 120.0;

pub struct MockBackend {
    channels: Channels,
    root: RecordRoot,
    /// File, relative to the root, that new takes point at.
    clip: Option<String>,
    inner: Mutex<Inner>,
}

struct Inner {
    cameras: Vec<Camera>,
    extra_camera: Option<Camera>,
    selected: Option<String>,
    error: Option<UiError>,
    capture: Option<Capture>,
    state: State,
    next_take: u32,
    frame: u64,
    song_beats: f64,
    live: Option<LiveInfo>,
}

struct Capture {
    armed_at: Instant,
    takes: u32,
    /// Start of the open take: `(when, file offset, song beats)`.
    open: Option<(Instant, f64, f64)>,
}

impl MockBackend {
    /// A backend whose takes live under `root`. New takes point at `clip`
    /// (relative to the root) when given, else at a file that doesn't exist.
    pub fn new(root: RecordRoot, state: State, clip: Option<String>) -> Self {
        Self {
            channels: Channels::new(),
            root,
            clip,
            inner: Mutex::new(Inner {
                cameras: default_cameras(),
                extra_camera: Some(Camera {
                    id: "mock-phone".into(),
                    name: "Pixel 8 (Link to Windows)".into(),
                    transport: Transport::Virtual,
                }),
                selected: None,
                error: None,
                capture: None,
                state,
                next_take: 1,
                frame: 0,
                song_beats: 64.0,
                live: None,
            }),
        }
    }

    /// A backend for a plugin editor in the format crates' own tests: takes
    /// start from `state`, and new ones go under the Documents record root,
    /// or the temp directory without one.
    pub fn for_plugin(state: State) -> Self {
        Self::new(RecordRoot::resolve_or_temp(None), state, None)
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// The plugin state, as the host would save it.
    pub fn state(&self) -> State {
        self.inner().state.clone()
    }

    /// Starts or stops the simulated transport. Playing while armed opens a
    /// take; stopping closes it.
    pub fn set_playing(&self, playing: bool) {
        let mut inner = self.inner();
        let beats = inner.song_beats;
        let Some(capture) = inner.capture.as_mut() else {
            return;
        };
        match (playing, capture.open.is_some()) {
            (true, false) => {
                let offset = capture.armed_at.elapsed().as_secs_f64();
                capture.open = Some((Instant::now(), offset, beats));
                let index = capture.takes;
                capture.takes += 1;
                drop(inner);
                self.channels.events.emit(&UiEvent::TakeOpened { index });
                self.emit_status();
            }
            (false, true) => {
                let open = capture.open.take();
                let take = self.close_take(&mut inner, open);
                drop(inner);
                self.channels.events.emit(&UiEvent::TakeClosed(take));
                self.emit_status();
            }
            _ => {}
        }
    }

    /// Simulates the Live companion connecting (`Some`), changing Live's
    /// record buttons, or going away (`None`).
    pub fn set_live(&self, live: Option<LiveInfo>) {
        let mut inner = self.inner();
        if inner.live == live {
            return;
        }
        inner.live = live;
        drop(inner);
        self.emit_status();
    }

    /// Whether a capture is running.
    pub fn is_armed(&self) -> bool {
        self.inner().capture.is_some()
    }

    /// Publishes the next test-pattern preview frame, or clears the
    /// preview when no camera is open.
    pub fn publish_frame(&self) {
        let mut inner = self.inner();
        let format = format_of(inner.selected.as_deref());
        let (Some(format), None) = (format, &inner.error) else {
            drop(inner);
            self.channels.preview.clear();
            return;
        };
        inner.frame += 1;
        let frame = inner.frame;
        let capturing = inner.capture.is_some();
        drop(inner);
        let (width, height) = if format.height > format.width {
            (180, 320)
        } else {
            (320, 180)
        };
        self.channels
            .preview
            .publish(test_pattern(width, height, frame, capturing));
    }

    fn close_take(&self, inner: &mut Inner, open: Option<(Instant, f64, f64)>) -> TakeInfo {
        let id = format!("mock-take-{}", inner.next_take);
        inner.next_take += 1;
        let filename = self
            .clip
            .clone()
            .unwrap_or_else(|| format!("{id}-missing.mp4"));
        let camera = inner
            .selected
            .as_deref()
            .and_then(|selected| inner.cameras.iter().find(|camera| camera.id == selected))
            .map_or_else(String::new, |camera| camera.name.clone());
        let (duration, offset, beats) = match open {
            Some((started, offset, beats)) => {
                (started.elapsed().as_secs_f64(), offset, Some(beats))
            }
            None => (
                inner
                    .capture
                    .as_ref()
                    .map_or(0.0, |capture| capture.armed_at.elapsed().as_secs_f64()),
                0.0,
                None,
            ),
        };
        if beats.is_some() {
            inner.song_beats += (duration * TEMPO / 60.0).ceil() + 4.0;
        }
        let format = format_of(inner.selected.as_deref()).unwrap_or(VideoFormat {
            width: 1920,
            height: 1080,
            fps: [30, 1],
        });
        let recording: Recording = serde_json::from_value(serde_json::json!({
            "id": id,
            "filename": filename,
            "dimensions": [format.width, format.height],
            "fps": format.fps,
            "frameStart": 0,
            "fileOffsetSec": offset,
            "transportStartSec": beats.map(|beats| beats * 60.0 / TEMPO),
            "transportStartBeats": beats,
            "durationSec": duration,
            "tempo": beats.map(|_| TEMPO),
            "timeSignature": beats.map(|_| [4, 4]),
            "camera": camera,
            "createdAt": rfc3339_utc(SystemTime::now()),
        }))
        .expect("mock recordings deserialize");
        let take = TakeInfo::from_recording(&recording, &self.root);
        inner.state.recordings.push(recording);
        take
    }

    fn emit_status(&self) {
        self.channels.events.emit(&UiEvent::Status(self.status()));
    }
}

impl Backend for MockBackend {
    fn cameras(&self) -> Vec<Camera> {
        self.inner().cameras.clone()
    }

    fn select_camera(&self, id: &str) -> Result<(), UiError> {
        let mut inner = self.inner();
        if inner.capture.is_some() {
            return Err(UiError::new(
                ErrorCode::InvalidRequest,
                "stop capturing before switching cameras",
            ));
        }
        if !inner.cameras.iter().any(|camera| camera.id == id) {
            return Err(UiError::new(ErrorCode::NotFound, "that camera is gone"));
        }
        inner.selected = Some(id.to_string());
        inner.error = match id {
            DENIED_CAMERA => Some(UiError::new(
                ErrorCode::PermissionDenied,
                "Camera access is turned off for Ableton Live.",
            )),
            BUSY_CAMERA => Some(UiError::new(
                ErrorCode::DeviceBusy,
                "Another app is using this camera.",
            )),
            _ => None,
        };
        let error = inner.error.clone();
        drop(inner);
        self.emit_status();
        match error {
            Some(error) => {
                self.channels.preview.clear();
                self.channels.events.emit(&UiEvent::Error(error.clone()));
                Err(error)
            }
            None => Ok(()),
        }
    }

    fn refresh_devices(&self) -> Result<Vec<Camera>, UiError> {
        let mut inner = self.inner();
        if let Some(camera) = inner.extra_camera.take() {
            inner.cameras.push(camera);
        }
        let cameras = inner.cameras.clone();
        drop(inner);
        self.channels
            .events
            .emit(&UiEvent::CamerasChanged(cameras.clone()));
        Ok(cameras)
    }

    fn arm(&self) -> Result<(), UiError> {
        let mut inner = self.inner();
        if inner.selected.is_none() || inner.error.is_some() {
            return Err(UiError::new(
                ErrorCode::InvalidRequest,
                "choose a working camera before recording",
            ));
        }
        if inner.capture.is_none() {
            inner.capture = Some(Capture {
                armed_at: Instant::now(),
                takes: 0,
                open: None,
            });
        }
        drop(inner);
        self.emit_status();
        Ok(())
    }

    fn disarm(&self) -> Result<(), UiError> {
        let mut inner = self.inner();
        let Some(mut capture) = inner.capture.take() else {
            return Ok(());
        };
        let open = capture.open.take();
        let take = (open.is_some() || capture.takes == 0).then(|| {
            inner.capture = Some(capture);
            let take = self.close_take(&mut inner, open);
            inner.capture = None;
            take
        });
        drop(inner);
        if let Some(take) = take {
            self.channels.events.emit(&UiEvent::TakeClosed(take));
        }
        self.emit_status();
        Ok(())
    }

    fn status(&self) -> Status {
        let inner = self.inner();
        let format = format_of(inner.selected.as_deref());
        let phase = match (&inner.error, &inner.capture, &inner.selected) {
            (Some(_), _, _) => Phase::Error,
            (None, Some(_), _) => Phase::Capturing,
            (None, None, Some(_)) => Phase::Ready,
            (None, None, None) => Phase::NoCamera,
        };
        Status {
            phase,
            camera_id: inner.selected.clone(),
            format: if inner.error.is_some() { None } else { format },
            capture: inner.capture.as_ref().map(|capture| CaptureInfo {
                elapsed_ms: capture.armed_at.elapsed().as_millis() as u64,
                takes: capture.takes,
                // Simulated: one dropped frame every 10 s, so the footer
                // counter shows in the harness.
                dropped_frames: capture.armed_at.elapsed().as_secs() / 10,
            }),
            error: inner.error.clone(),
            live: inner.live,
        }
    }

    fn takes(&self) -> Vec<TakeInfo> {
        takes_from_state(&self.inner().state, &self.root)
    }

    fn take_file(&self, id: &str) -> Option<TakeFile> {
        let inner = self.inner();
        inner
            .state
            .recordings
            .iter()
            .find(|recording| recording.id == id)
            .map(|recording| TakeFile::from_recording(recording, &self.root))
    }

    fn channels(&self) -> &Channels {
        &self.channels
    }
}

fn default_cameras() -> Vec<Camera> {
    [
        ("mock-builtin", "FaceTime HD Camera", Transport::BuiltIn),
        ("mock-iphone", "iPhone Camera", Transport::Continuity),
        ("mock-usb", "Logitech BRIO", Transport::Usb),
        (DENIED_CAMERA, "Studio Display Camera", Transport::Usb),
        (BUSY_CAMERA, "OBS Virtual Camera", Transport::Virtual),
    ]
    .into_iter()
    .map(|(id, name, transport)| Camera {
        id: id.into(),
        name: name.into(),
        transport,
    })
    .collect()
}

fn format_of(camera: Option<&str>) -> Option<VideoFormat> {
    Some(match camera? {
        "mock-iphone" | "mock-phone" => VideoFormat {
            width: 1080,
            height: 1920,
            fps: [30, 1],
        },
        "mock-usb" => VideoFormat {
            width: 3840,
            height: 2160,
            fps: [30000, 1001],
        },
        _ => VideoFormat {
            width: 1920,
            height: 1080,
            fps: [30, 1],
        },
    })
}

/// A scrolling colour-bar pattern with a sweep line, as JPEG.
fn test_pattern(width: u32, height: u32, frame: u64, capturing: bool) -> Vec<u8> {
    const BARS: [[u8; 3]; 7] = [
        [192, 192, 192],
        [192, 192, 0],
        [0, 192, 192],
        [0, 192, 0],
        [192, 0, 192],
        [192, 0, 0],
        [0, 0, 192],
    ];
    let sweep = (frame * 4 % u64::from(width)) as u32;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for y in 0..height {
        for x in 0..width {
            let pixel = if x.abs_diff(sweep) < 2 {
                if capturing {
                    [255, 111, 157]
                } else {
                    [238, 242, 255]
                }
            } else if y > height * 3 / 4 {
                let level = (x * 255 / width) as u8;
                [level, level, level]
            } else {
                BARS[(x * 7 / width) as usize]
            };
            rgb.extend(pixel);
        }
    }
    encode_rgb(&rgb, width, height)
}

/// Formats a time as an RFC 3339 UTC timestamp with second precision.
pub fn rfc3339_utc(time: SystemTime) -> String {
    let secs = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days, after Howard Hinnant's date algorithms.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn backend() -> MockBackend {
        let root = RecordRoot::resolve_with(None, Some(std::path::Path::new("/nowhere"))).unwrap();
        MockBackend::new(root, State::default(), None)
    }

    fn events(backend: &MockBackend, after: u64) -> Vec<serde_json::Value> {
        let batch = backend.channels().events.poll(
            Some(after),
            Duration::from_millis(1),
            &AtomicBool::new(false),
        );
        batch
            .events
            .iter()
            .map(|json| serde_json::from_str(json).unwrap())
            .collect()
    }

    #[test]
    fn formats_rfc3339() {
        assert_eq!(rfc3339_utc(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        let time = UNIX_EPOCH + Duration::from_secs(1_790_368_572);
        assert_eq!(rfc3339_utc(time), "2026-09-25T20:36:12Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400);
        assert_eq!(rfc3339_utc(leap), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn walks_through_the_capture_states() {
        let backend = backend();
        assert_eq!(backend.status().phase, Phase::NoCamera);
        assert!(backend.arm().is_err());

        backend.select_camera("mock-builtin").unwrap();
        assert_eq!(backend.status().phase, Phase::Ready);
        backend.publish_frame();
        assert!(backend.channels().preview.latest().is_some());

        backend.arm().unwrap();
        assert_eq!(backend.status().phase, Phase::Capturing);
        assert!(backend.select_camera("mock-usb").is_err());
        backend.set_playing(true);
        backend.set_playing(false);
        backend.set_playing(true);
        assert_eq!(backend.status().capture.unwrap().takes, 2);
        backend.disarm().unwrap();

        let takes = backend.takes();
        assert_eq!(takes.len(), 2);
        assert!(takes.iter().all(|take| !take.unanchored && take.missing));
        assert_eq!(takes[0].time_signature, Some([4, 4]));
        assert_eq!(backend.status().phase, Phase::Ready);

        let names: Vec<String> = events(&backend, 0)
            .iter()
            .map(|event| event["event"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(names.iter().filter(|name| *name == "takeOpened").count(), 2);
        assert_eq!(names.iter().filter(|name| *name == "takeClosed").count(), 2);
    }

    #[test]
    fn reports_the_live_companion() {
        let backend = backend();
        assert_eq!(backend.status().live, None);
        let armed = Some(LiveInfo { record_armed: true });
        backend.set_live(armed);
        backend.set_live(armed);
        assert_eq!(backend.status().live, armed);
        backend.set_live(None);
        assert_eq!(backend.status().live, None);
        let lives: Vec<serde_json::Value> = events(&backend, 0)
            .iter()
            .map(|event| event["payload"]["live"].clone())
            .collect();
        assert_eq!(
            lives,
            [
                serde_json::json!({ "recordArmed": true }),
                serde_json::Value::Null
            ]
        );
    }

    #[test]
    fn a_capture_without_playback_is_unanchored() {
        let backend = backend();
        backend.select_camera("mock-builtin").unwrap();
        backend.arm().unwrap();
        backend.disarm().unwrap();
        let takes = backend.takes();
        assert_eq!(takes.len(), 1);
        assert!(takes[0].unanchored);
        assert_eq!(backend.state().recordings.len(), 1);
        assert!(backend.take_file(&takes[0].id).is_some());
        assert!(backend.take_file("nope").is_none());
    }

    #[test]
    fn failing_cameras_report_errors() {
        let backend = backend();
        let error = backend.select_camera(DENIED_CAMERA).unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied);
        let status = backend.status();
        assert_eq!(status.phase, Phase::Error);
        assert_eq!(status.error.unwrap().code, ErrorCode::PermissionDenied);
        assert!(backend.arm().is_err());
        backend.publish_frame();
        assert!(backend.channels().preview.latest().is_none());

        let error = backend.select_camera(BUSY_CAMERA).unwrap_err();
        assert_eq!(error.code, ErrorCode::DeviceBusy);
        backend.select_camera("mock-iphone").unwrap();
        let status = backend.status();
        assert_eq!(status.phase, Phase::Ready);
        assert_eq!(status.format.unwrap().height, 1920);
    }

    #[test]
    fn refresh_finds_the_phone() {
        let backend = backend();
        let before = backend.cameras().len();
        let cameras = backend.refresh_devices().unwrap();
        assert_eq!(cameras.len(), before + 1);
        assert_eq!(backend.refresh_devices().unwrap().len(), before + 1);
        assert_eq!(events(&backend, 0)[0]["event"], "camerasChanged");
    }
}
