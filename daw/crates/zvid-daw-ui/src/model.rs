//! The data the editor exchanges with the web frontend. Every type here is
//! serialized as camelCase JSON; `daw/ui/src/ipc/types.ts` mirrors it.

use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use zvid_daw_core::{LiveStatus, RecordRoot, Recording, State};

/// How a camera is attached, shown as the secondary line in the camera menu.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    BuiltIn,
    Usb,
    Continuity,
    Virtual,
    Network,
    #[default]
    Unknown,
}

/// One entry in the camera menu.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    /// Stable unique ID from the capture layer.
    pub id: String,
    pub name: String,
    pub transport: Transport,
}

/// Active capture format, shown in the footer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormat {
    /// Displayed size: portrait for a source rotated to portrait, even
    /// when its device format is landscape.
    pub width: u32,
    pub height: u32,
    /// Frame rate as a `[numerator, denominator]` fraction.
    pub fps: [u32; 2],
}

/// The header state: gray, green, pink or amber dot.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    NoCamera,
    Ready,
    Capturing,
    Error,
}

/// The capture in progress.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    /// Milliseconds since arm when this status was produced. The UI keeps
    /// the timer running on its own clock between status updates.
    pub elapsed_ms: u64,
    /// Takes opened so far in this capture.
    pub takes: u32,
    /// Frames dropped because the encoder fell behind, shown in the footer.
    pub dropped_frames: u64,
}

/// What the Live companion script reports while it is connected. The
/// capture card then follows Live's record buttons instead of offering its
/// own Record button.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    /// Either of Live's record buttons is on.
    pub record_armed: bool,
}

impl LiveInfo {
    pub fn from_status(status: &LiveStatus) -> Self {
        Self {
            record_armed: status.record_armed(),
        }
    }
}

/// Everything the header, preview and capture card render from.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    pub camera_id: Option<String>,
    pub format: Option<VideoFormat>,
    pub capture: Option<CaptureInfo>,
    pub error: Option<UiError>,
    /// The Live companion, or `None` while it isn't connected.
    pub live: Option<LiveInfo>,
}

/// One card in the takes list.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeInfo {
    pub id: String,
    pub filename: String,
    /// RFC 3339 UTC timestamp of the capture.
    pub created_at: String,
    pub duration_sec: f64,
    /// Seconds into the file where the take starts.
    pub file_offset_sec: f64,
    /// Song position in quarter-note beats, or `None` when unanchored.
    pub transport_start_beats: Option<f64>,
    pub time_signature: Option<[u32; 2]>,
    /// No playback happened during the capture.
    pub unanchored: bool,
    /// The file is not in the record root any more.
    pub missing: bool,
}

impl TakeInfo {
    pub fn from_recording(recording: &Recording, root: &RecordRoot) -> Self {
        Self {
            id: recording.id.clone(),
            filename: recording.filename.clone(),
            created_at: recording.created_at.clone(),
            duration_sec: recording.duration_sec,
            file_offset_sec: recording.file_offset_sec,
            transport_start_beats: recording.transport_start_beats,
            time_signature: recording.time_signature,
            unanchored: recording.is_unanchored(),
            missing: !root.path_of(&recording.filename).is_file(),
        }
    }
}

/// The takes list for a plugin state, newest first. `root_of` gives the
/// record root each recording's file is under.
pub fn takes_from_state(
    state: &State,
    root_of: impl Fn(&Recording) -> RecordRoot,
) -> Vec<TakeInfo> {
    let mut takes: Vec<TakeInfo> = state
        .recordings
        .iter()
        .rev()
        .map(|recording| TakeInfo::from_recording(recording, &root_of(recording)))
        .collect();
    // RFC 3339 UTC timestamps sort lexically; the stable sort keeps later
    // entries first when several share a timestamp.
    takes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    takes
}

/// Where a take lives on disk, for playback, posters and reveal.
#[derive(Clone, Debug, PartialEq)]
pub struct TakeFile {
    pub path: PathBuf,
    pub file_offset_sec: f64,
    pub duration_sec: f64,
}

impl TakeFile {
    pub fn from_recording(recording: &Recording, root: &RecordRoot) -> Self {
        Self {
            path: root.path_of(&recording.filename),
            file_offset_sec: recording.file_offset_sec,
            duration_sec: recording.duration_sec,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// Camera access was denied; the UI links to the privacy settings.
    PermissionDenied,
    /// Another application holds the camera.
    DeviceBusy,
    DeviceLost,
    NotFound,
    InvalidRequest,
    Internal,
}

/// An error shown to the user and returned from failed commands.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    pub code: ErrorCode,
    pub message: String,
}

impl UiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for UiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for UiError {}

/// Events pushed to the frontend, modeled on Tauri `emit`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", content = "payload", rename_all = "camelCase")]
pub enum UiEvent {
    Status(Status),
    CamerasChanged(Vec<Camera>),
    /// A take opened in the running capture; carries its zero-based index.
    TakeOpened {
        index: u32,
    },
    /// A take closed and was added to the plugin state.
    TakeClosed(TakeInfo),
    Error(UiError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn recording(id: &str, created_at: &str, anchored: bool) -> Recording {
        let json = serde_json::json!({
            "id": id,
            "filename": format!("{id}.mp4"),
            "dimensions": [1920, 1080],
            "fps": [30, 1],
            "frameStart": 0,
            "fileOffsetSec": 1.5,
            "transportStartSec": if anchored { Some(32.0) } else { None },
            "transportStartBeats": if anchored { Some(64.0) } else { None },
            "durationSec": 36.2,
            "tempo": if anchored { Some(120.0) } else { None },
            "timeSignature": if anchored { Some([4, 4]) } else { None },
            "camera": "Cam",
            "createdAt": created_at,
        });
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn lists_takes_newest_first_and_flags_missing_files() {
        let dir = std::env::temp_dir().join(format!("zvid-ui-model-{}", std::process::id()));
        let root = RecordRoot::resolve_with(Some(&dir), None).unwrap();
        fs::create_dir_all(&root.dir).unwrap();
        fs::write(root.path_of("b.mp4"), b"").unwrap();

        let state = State {
            recordings: vec![
                recording("a", "2026-09-25T20:31:00Z", true),
                recording("b", "2026-09-25T20:36:00Z", false),
                recording("c", "2026-09-25T20:31:00Z", true),
            ],
            ..State::default()
        };
        let takes = takes_from_state(&state, |_| root.clone());
        let ids: Vec<&str> = takes.iter().map(|take| take.id.as_str()).collect();
        assert_eq!(ids, ["b", "c", "a"]);
        assert!(!takes[0].missing);
        assert!(takes[0].unanchored);
        assert!(takes[1].missing);
        assert_eq!(takes[1].transport_start_beats, Some(64.0));
        assert_eq!(takes[1].time_signature, Some([4, 4]));

        let file = TakeFile::from_recording(&state.recordings[1], &root);
        assert_eq!(file.path, root.dir.join("b.mp4"));
        assert_eq!(file.file_offset_sec, 1.5);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn events_use_tauri_style_names() {
        let json = serde_json::to_value(UiEvent::TakeOpened { index: 2 }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "event": "takeOpened", "payload": { "index": 2 } })
        );
        let json = serde_json::to_value(UiEvent::Status(Status {
            phase: Phase::Capturing,
            camera_id: Some("cam".into()),
            format: None,
            capture: Some(CaptureInfo {
                elapsed_ms: 5000,
                takes: 1,
                dropped_frames: 3,
            }),
            error: None,
            live: Some(LiveInfo { record_armed: true }),
        }))
        .unwrap();
        assert_eq!(json["event"], "status");
        assert_eq!(json["payload"]["phase"], "capturing");
        assert_eq!(json["payload"]["live"]["recordArmed"], true);
        assert_eq!(json["payload"]["cameraId"], "cam");
        assert_eq!(json["payload"]["capture"]["elapsedMs"], 5000);
        assert_eq!(json["payload"]["capture"]["droppedFrames"], 3);
        let json = serde_json::to_value(Status::default()).unwrap();
        assert_eq!(json["live"], serde_json::Value::Null);
        let json = serde_json::to_value(UiEvent::CamerasChanged(vec![Camera {
            id: "1".into(),
            name: "iPhone".into(),
            transport: Transport::Continuity,
        }]))
        .unwrap();
        assert_eq!(json["event"], "camerasChanged");
        assert_eq!(json["payload"][0]["transport"], "continuity");
        let json = serde_json::to_value(UiError::new(ErrorCode::PermissionDenied, "no")).unwrap();
        assert_eq!(json["code"], "permissionDenied");
    }
}
