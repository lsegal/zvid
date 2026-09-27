//! Persisted plugin state.
//!
//! The state is versioned JSON using the same key names as the Layers-style
//! `ProcessorState`, so `/app`'s `decodeLayersState` can read it. Hosts store
//! it hex-encoded (VST3 `ProcessorState`). Fields this version does not know
//! are kept and written back unchanged, so older plugins don't drop data
//! saved by newer ones.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::paths::RecordRootKind;
use crate::tracker::Take;

/// Schema version written by this crate.
pub const STATE_VERSION: &str = "1";
/// Value of the `plugin` key.
pub const PLUGIN_ID: &str = "zvid-capture";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub version: String,
    pub plugin: String,
    /// The root of the latest capture. Entries without their own
    /// `recordRoot`, saved by earlier versions, are relative to it.
    #[serde(default)]
    pub record_root: RecordRootKind,
    #[serde(default)]
    pub recordings: Vec<Recording>,
    /// The camera last chosen in the editor. Omitted until one is chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<CameraChoice>,
    /// Keys this version does not know, kept for round-tripping.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            version: STATE_VERSION.to_string(),
            plugin: PLUGIN_ID.to_string(),
            record_root: RecordRootKind::default(),
            recordings: Vec::new(),
            camera: None,
            extra: Map::new(),
        }
    }
}

/// A camera choice as persisted: restored by `id` (the capture layer's
/// unique device ID) first, then by `name`, since IDs can change between
/// machines and reconnections.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraChoice {
    pub id: String,
    pub name: String,
}

/// One take entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    /// Capture file name, relative to the record root.
    pub filename: String,
    /// The root `filename` is relative to, chosen when the capture armed.
    /// `None` for entries saved before roots were kept per entry; those use
    /// the state's `recordRoot`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_root: Option<RecordRootKind>,
    /// `[width, height]` in pixels.
    pub dimensions: [u32; 2],
    /// Frame rate as a `[numerator, denominator]` fraction.
    pub fps: [u32; 2],
    /// Arrangement frame of file frame 0.
    pub frame_start: i64,
    /// Seconds into the file where the take starts.
    pub file_offset_sec: f64,
    /// Song time at play start, or `None` for an unanchored capture.
    pub transport_start_sec: Option<f64>,
    pub transport_start_beats: Option<f64>,
    pub duration_sec: f64,
    pub tempo: Option<f64>,
    pub time_signature: Option<[u32; 2]>,
    pub camera: String,
    /// RFC 3339 UTC timestamp of the capture.
    pub created_at: String,
    /// Keys this version does not know, kept for round-tripping.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Capture details a [`Take`] needs to become a [`Recording`].
#[derive(Clone, Debug, PartialEq)]
pub struct RecordingMeta {
    pub id: String,
    pub filename: String,
    pub record_root: RecordRootKind,
    pub dimensions: [u32; 2],
    pub fps: [u32; 2],
    pub camera: String,
    pub created_at: String,
}

impl Recording {
    pub fn from_take(take: &Take, meta: RecordingMeta) -> Self {
        let anchor = take.anchor;
        let frame_start = anchor.map_or(0, |anchor| {
            frame_start(anchor.transport_start_sec, take.file_offset_sec, meta.fps)
        });
        Self {
            id: meta.id,
            filename: meta.filename,
            record_root: Some(meta.record_root),
            dimensions: meta.dimensions,
            fps: meta.fps,
            frame_start,
            file_offset_sec: take.file_offset_sec,
            transport_start_sec: anchor.map(|anchor| anchor.transport_start_sec),
            transport_start_beats: anchor.map(|anchor| anchor.transport_start_beats),
            duration_sec: take.duration_sec,
            tempo: anchor.map(|anchor| anchor.tempo),
            time_signature: anchor.map(|anchor| anchor.time_signature),
            camera: meta.camera,
            created_at: meta.created_at,
            extra: Map::new(),
        }
    }

    /// The root `filename` is relative to, falling back to the state's
    /// `recordRoot` (`state_root`) for entries that don't store one.
    pub fn record_root_or(&self, state_root: RecordRootKind) -> RecordRootKind {
        self.record_root.unwrap_or(state_root)
    }

    /// True for a capture that never saw playback; the importer skips it.
    pub fn is_unanchored(&self) -> bool {
        self.transport_start_sec.is_none()
    }
}

/// Arrangement frame of file frame 0:
/// `round(transportStartSec * fps) - round(fileOffsetSec * fps)`.
pub fn frame_start(transport_start_sec: f64, file_offset_sec: f64, fps: [u32; 2]) -> i64 {
    let rate = f64::from(fps[0]) / f64::from(fps[1].max(1));
    (transport_start_sec * rate).round() as i64 - (file_offset_sec * rate).round() as i64
}

#[derive(Debug)]
pub enum StateError {
    InvalidHex,
    Json(serde_json::Error),
}

impl fmt::Display for StateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHex => f.write_str("state is not valid hex"),
            Self::Json(error) => write!(f, "state is not valid JSON: {error}"),
        }
    }
}

impl std::error::Error for StateError {}

impl From<serde_json::Error> for StateError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl State {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("state serializes")
    }

    pub fn from_json(json: &str) -> Result<Self, StateError> {
        Ok(serde_json::from_str(json)?)
    }

    /// Uppercase hex of the JSON bytes, as stored in VST3 `ProcessorState`.
    pub fn to_hex(&self) -> String {
        const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
        let json = self.to_json();
        let mut hex = String::with_capacity(json.len() * 2);
        for byte in json.bytes() {
            hex.push(DIGITS[usize::from(byte >> 4)] as char);
            hex.push(DIGITS[usize::from(byte & 0xF)] as char);
        }
        hex
    }

    /// Decodes hex-encoded JSON, ignoring whitespace such as the line breaks
    /// Live wraps `ProcessorState` with.
    pub fn from_hex(hex: &str) -> Result<Self, StateError> {
        let digits: Vec<u8> = hex
            .bytes()
            .filter(|byte| !byte.is_ascii_whitespace())
            .map(|byte| (byte as char).to_digit(16).map(|digit| digit as u8))
            .collect::<Option<_>>()
            .ok_or(StateError::InvalidHex)?;
        if !digits.len().is_multiple_of(2) {
            return Err(StateError::InvalidHex);
        }
        let bytes: Vec<u8> = digits
            .chunks(2)
            .map(|pair| pair[0] << 4 | pair[1])
            .collect();
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracker::Anchor;

    const FIXTURE_JSON: &str = include_str!("../../../fixtures/state/zvid-capture-v1.json");
    const FIXTURE_HEX: &str = include_str!("../../../fixtures/state/zvid-capture-v1.hex");

    fn meta() -> RecordingMeta {
        RecordingMeta {
            id: "8a6f1f5e-3c1b-4f8e-9a57-2d7c1e0b9f10".to_string(),
            filename: "video-01-9-25-20-36-12-0.mp4".to_string(),
            record_root: RecordRootKind::Project,
            dimensions: [1920, 1080],
            fps: [30, 1],
            camera: "FaceTime HD Camera".to_string(),
            created_at: "2026-09-25T20:36:12Z".to_string(),
        }
    }

    fn anchored_take() -> Take {
        Take {
            index: 0,
            file_offset_sec: 1.5,
            anchor: Some(Anchor {
                transport_start_sec: 32.0,
                transport_start_beats: 64.0,
                tempo: 120.0,
                time_signature: [4, 4],
            }),
            duration_sec: 36.2,
        }
    }

    #[test]
    fn frame_start_subtracts_the_file_offset() {
        assert_eq!(frame_start(32.0, 1.5, [30, 1]), 960 - 45);
        assert_eq!(frame_start(0.0, 1.5, [30, 1]), -45);
        assert_eq!(frame_start(1.0, 0.0, [30000, 1001]), 30);
        assert_eq!(frame_start(10.0, 0.0, [30000, 1001]), 300);
    }

    #[test]
    fn builds_recordings_from_takes() {
        let recording = Recording::from_take(&anchored_take(), meta());
        assert_eq!(recording.frame_start, 915);
        assert_eq!(recording.transport_start_sec, Some(32.0));
        assert_eq!(recording.transport_start_beats, Some(64.0));
        assert_eq!(recording.tempo, Some(120.0));
        assert_eq!(recording.time_signature, Some([4, 4]));
        assert_eq!(recording.file_offset_sec, 1.5);
        assert_eq!(recording.duration_sec, 36.2);
        assert!(!recording.is_unanchored());

        let unanchored = Take {
            anchor: None,
            file_offset_sec: 0.0,
            ..anchored_take()
        };
        let recording = Recording::from_take(&unanchored, meta());
        assert!(recording.is_unanchored());
        assert_eq!(recording.frame_start, 0);
        let json: Value = serde_json::from_str(
            &State {
                recordings: vec![recording],
                ..State::default()
            }
            .to_json(),
        )
        .unwrap();
        assert_eq!(json["recordings"][0]["transportStartSec"], Value::Null);
    }

    #[test]
    fn writes_the_documented_keys() {
        let state = State {
            record_root: RecordRootKind::Project,
            recordings: vec![Recording::from_take(&anchored_take(), meta())],
            ..State::default()
        };
        let json: Value = serde_json::from_str(&state.to_json()).unwrap();
        assert_eq!(json["version"], "1");
        assert_eq!(json["plugin"], "zvid-capture");
        assert_eq!(json["recordRoot"], "project");
        assert_eq!(json["recordings"][0]["recordRoot"], "project");
        let mut keys: Vec<&str> = json["recordings"][0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "camera",
                "createdAt",
                "dimensions",
                "durationSec",
                "fileOffsetSec",
                "filename",
                "fps",
                "frameStart",
                "id",
                "recordRoot",
                "tempo",
                "timeSignature",
                "transportStartBeats",
                "transportStartSec",
            ]
        );
    }

    #[test]
    fn keeps_the_camera_choice() {
        let json: Value = serde_json::from_str(&State::default().to_json()).unwrap();
        assert!(json.get("camera").is_none());
        let state = State {
            camera: Some(CameraChoice {
                id: "0x1420000046d0893".to_string(),
                name: "Logitech BRIO".to_string(),
            }),
            ..State::default()
        };
        let json: Value = serde_json::from_str(&state.to_json()).unwrap();
        assert_eq!(
            json["camera"],
            serde_json::json!({ "id": "0x1420000046d0893", "name": "Logitech BRIO" })
        );
        assert!(!state.extra.contains_key("camera"));
        assert_eq!(State::from_json(&state.to_json()).unwrap(), state);
    }

    #[test]
    fn hex_round_trips() {
        let state = State {
            recordings: vec![Recording::from_take(&anchored_take(), meta())],
            ..State::default()
        };
        let hex = state.to_hex();
        assert!(
            hex.bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_lowercase())
        );
        assert_eq!(State::from_hex(&hex).unwrap(), state);
        let wrapped = format!("\n\t{}\n\t{}\n", &hex[..20], hex[20..].to_lowercase());
        assert_eq!(State::from_hex(&wrapped).unwrap(), state);
    }

    #[test]
    fn rejects_malformed_hex() {
        assert!(matches!(
            State::from_hex("ABC"),
            Err(StateError::InvalidHex)
        ));
        assert!(matches!(State::from_hex("ZZ"), Err(StateError::InvalidHex)));
        assert!(matches!(State::from_hex("7B"), Err(StateError::Json(_))));
    }

    #[test]
    fn keeps_unknown_fields() {
        let json = r#"{"version":"2","plugin":"zvid-capture","recordRoot":"documents","recordings":[{"id":"a","filename":"a.mp4","dimensions":[640,480],"fps":[25,1],"frameStart":0,"fileOffsetSec":0.0,"transportStartSec":null,"transportStartBeats":null,"durationSec":1.0,"tempo":null,"timeSignature":null,"camera":"Cam","createdAt":"2026-01-01T00:00:00Z","rotation":90}],"future":{"x":[1,2]}}"#;
        let state = State::from_json(json).unwrap();
        assert_eq!(state.version, "2");
        assert_eq!(state.extra["future"], serde_json::json!({ "x": [1, 2] }));
        assert_eq!(state.recordings[0].extra["rotation"], 90);
        let reparsed: Value = serde_json::from_str(&state.to_json()).unwrap();
        assert_eq!(reparsed, serde_json::from_str::<Value>(json).unwrap());
    }

    #[test]
    fn fills_defaults_for_missing_lists() {
        let state = State::from_json(r#"{"version":"1","plugin":"zvid-capture"}"#).unwrap();
        assert_eq!(state, State::default());
    }

    #[test]
    fn shared_fixture_matches_its_hex_encoding() {
        let state = State::from_json(FIXTURE_JSON).unwrap();
        assert_eq!(State::from_hex(FIXTURE_HEX).unwrap(), state);
        assert_eq!(state.to_hex(), FIXTURE_HEX.trim());
        assert_eq!(state.recordings.len(), 2);
        assert!(!state.recordings[0].is_unanchored());
        assert!(state.recordings[1].is_unanchored());
        assert!(state.extra.contains_key("futureKey"));
    }

    #[test]
    fn entries_without_a_root_use_the_state_root() {
        let state = State::from_json(FIXTURE_JSON).unwrap();
        assert_eq!(state.recordings[0].record_root, None);
        assert_eq!(
            state.recordings[0].record_root_or(state.record_root),
            RecordRootKind::Project
        );
        let documents = Recording {
            record_root: Some(RecordRootKind::Documents),
            ..state.recordings[0].clone()
        };
        assert_eq!(
            documents.record_root_or(state.record_root),
            RecordRootKind::Documents
        );
        let json: Value = serde_json::from_str(&state.to_json()).unwrap();
        assert!(json["recordings"][0].get("recordRoot").is_none());
    }
}
