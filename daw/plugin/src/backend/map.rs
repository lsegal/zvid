//! Pure translations from the capture layer and the take log to the
//! editor's model: devices to menu entries, capture errors to [`UiError`]s,
//! take changes to [`UiEvent`]s, and the backend's state to [`Status`]. Also
//! from the format layer's audio tap to the recorder's audio blocks.

use zvid_capture::record::{AudioBlock, AudioFormat};
use zvid_capture::{CaptureError, Device, HostTime, Selection};
use zvid_daw_core::{CameraChoice, RecordRoot, TakeChange, TapBlock};
use zvid_daw_ui::{
    Camera, CaptureInfo, ErrorCode, LiveInfo, Phase, Status, TakeInfo, Transport, UiError,
    UiEvent, VideoFormat,
};

/// The camera menu's transport label for a capture-layer transport.
pub fn transport(transport: zvid_capture::Transport) -> Transport {
    use zvid_capture::Transport as Capture;
    match transport {
        Capture::BuiltIn => Transport::BuiltIn,
        Capture::Usb | Capture::Thunderbolt => Transport::Usb,
        Capture::Continuity => Transport::Continuity,
        Capture::Virtual => Transport::Virtual,
        Capture::Wireless => Transport::Network,
        Capture::Unknown => Transport::Unknown,
    }
}

pub fn camera(device: &Device) -> Camera {
    Camera {
        id: device.id.0.clone(),
        name: device.name.clone(),
        transport: transport(device.transport),
    }
}

pub fn cameras(devices: &[Device]) -> Vec<Camera> {
    devices.iter().map(camera).collect()
}

/// The footer's format: the device format's size at the frame rate
/// requested from it.
pub fn video_format(selection: &Selection) -> VideoFormat {
    let fps = selection.fps.reduced();
    VideoFormat {
        width: selection.format.width,
        height: selection.format.height,
        fps: [fps.num, fps.den],
    }
}

/// The device a persisted choice refers to: the one with its unique ID,
/// else the first one with its name.
pub fn find_choice<'a>(choice: &CameraChoice, devices: &'a [Device]) -> Option<&'a Device> {
    devices
        .iter()
        .find(|device| device.id.0 == choice.id)
        .or_else(|| devices.iter().find(|device| device.name == choice.name))
}

/// The error shown when a camera can't be opened.
pub fn capture_error(error: &CaptureError) -> UiError {
    match error {
        CaptureError::PermissionDenied => UiError::new(
            ErrorCode::PermissionDenied,
            "Camera access is off for this app.",
        ),
        CaptureError::PermissionRestricted => UiError::new(
            ErrorCode::PermissionDenied,
            "Camera access is blocked by a system policy.",
        ),
        CaptureError::DeviceBusy => UiError::new(
            ErrorCode::DeviceBusy,
            "This camera is in use by another app.",
        ),
        CaptureError::DeviceNotFound(_) => {
            UiError::new(ErrorCode::NotFound, "That camera is no longer connected.")
        }
        CaptureError::NoSupportedFormat => UiError::new(
            ErrorCode::Internal,
            "This camera offers no video format ZVID Capture can record.",
        ),
        CaptureError::Unsupported => UiError::new(
            ErrorCode::Internal,
            "Camera capture isn't supported on this system.",
        ),
        CaptureError::Platform { .. } => UiError::new(
            ErrorCode::Internal,
            format!("The camera could not be opened: {error}."),
        ),
    }
}

/// The error shown when the open camera goes away. `capturing` says
/// whether a capture was stopped because of it.
pub fn device_lost(capturing: bool, cause: &str) -> UiError {
    let message = if capturing {
        format!("Capture stopped: {cause}. Footage up to that point was saved.")
    } else {
        format!("{}.", capitalize(cause))
    };
    UiError::new(ErrorCode::DeviceLost, message)
}

/// The error shown when the recorder stops on its own, keeping the file.
pub fn recording_failed(message: &str) -> UiError {
    UiError::new(
        ErrorCode::Internal,
        format!(
            "Capture stopped: recording failed ({message}). Footage up to that point was saved."
        ),
    )
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// The event announcing a take change.
pub fn take_event(change: &TakeChange, root: &RecordRoot) -> UiEvent {
    match change {
        TakeChange::Opened { index, .. } => UiEvent::TakeOpened { index: *index },
        TakeChange::Closed(recording) => {
            UiEvent::TakeClosed(TakeInfo::from_recording(recording, root))
        }
    }
}

/// The recorder's format for tapped audio at `sample_rate`: the tap is
/// always stereo, with mono input duplicated.
pub fn audio_format(sample_rate: f64) -> AudioFormat {
    AudioFormat {
        sample_rate: sample_rate.round() as u32,
        channels: 2,
    }
}

/// A tapped block as the recorder takes it, timed on the host clock.
pub fn audio_block(block: TapBlock) -> AudioBlock {
    AudioBlock {
        host_time: Some(HostTime::from_nanos(
            (block.host_time * 1e9).round().max(0.0) as u64,
        )),
        samples: block.samples,
    }
}

/// What [`status`] is computed from.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StatusInputs<'a> {
    /// The chosen camera's ID.
    pub camera_id: Option<&'a str>,
    /// The open camera's format; `None` while it is opening or failed.
    pub format: Option<VideoFormat>,
    pub capture: Option<CaptureInfo>,
    pub error: Option<&'a UiError>,
    /// The Live companion, while it is connected.
    pub live: Option<LiveInfo>,
}

/// The editor's status: an error wins, then a running capture, then a
/// chosen camera.
pub fn status(inputs: StatusInputs<'_>) -> Status {
    let phase = match (&inputs.error, &inputs.capture, &inputs.camera_id) {
        (Some(_), _, _) => Phase::Error,
        (None, Some(_), _) => Phase::Capturing,
        (None, None, Some(_)) => Phase::Ready,
        (None, None, None) => Phase::NoCamera,
    };
    Status {
        phase,
        camera_id: inputs.camera_id.map(str::to_string),
        format: inputs.error.is_none().then_some(inputs.format).flatten(),
        capture: inputs.error.is_none().then_some(inputs.capture).flatten(),
        error: inputs.error.cloned(),
        // Live's record buttons don't depend on the camera, so an error
        // doesn't hide them.
        live: inputs.live,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zvid_capture::{DeviceId, Format, Rational};
    use zvid_daw_core::Recording;

    fn device(id: &str, name: &str, transport: zvid_capture::Transport) -> Device {
        Device {
            id: DeviceId(id.to_string()),
            name: name.to_string(),
            transport,
        }
    }

    #[test]
    fn maps_every_transport() {
        use zvid_capture::Transport as Capture;
        let cases = [
            (Capture::BuiltIn, Transport::BuiltIn, "builtIn"),
            (Capture::Usb, Transport::Usb, "usb"),
            (Capture::Thunderbolt, Transport::Usb, "usb"),
            (Capture::Continuity, Transport::Continuity, "continuity"),
            (Capture::Virtual, Transport::Virtual, "virtual"),
            (Capture::Wireless, Transport::Network, "network"),
            (Capture::Unknown, Transport::Unknown, "unknown"),
        ];
        for (from, to, json) in cases {
            let camera = camera(&device("id", "Cam", from));
            assert_eq!(camera.transport, to);
            assert_eq!(serde_json::to_value(camera.transport).unwrap(), json);
        }
        let menu = cameras(&[device("0x1420000046d0893", "Logitech BRIO", Capture::Usb)]);
        assert_eq!(
            menu,
            [Camera {
                id: "0x1420000046d0893".to_string(),
                name: "Logitech BRIO".to_string(),
                transport: Transport::Usb,
            }]
        );
    }

    #[test]
    fn restores_by_id_then_by_name() {
        use zvid_capture::Transport as Capture;
        let devices = [
            device("usb-1", "Logitech BRIO", Capture::Usb),
            device("usb-2", "Logitech BRIO", Capture::Usb),
            device("iphone", "iPhone Camera", Capture::Continuity),
        ];
        let choice = |id: &str, name: &str| CameraChoice {
            id: id.to_string(),
            name: name.to_string(),
        };
        let found = |id, name| find_choice(&choice(id, name), &devices).map(|d| d.id.0.as_str());
        // The ID wins even when the name also matches another device.
        assert_eq!(found("usb-2", "Logitech BRIO"), Some("usb-2"));
        // The ID wins even when the device was renamed.
        assert_eq!(found("iphone", "Old iPhone"), Some("iphone"));
        // The ID changed (another machine or port): match the name.
        assert_eq!(found("usb-9", "Logitech BRIO"), Some("usb-1"));
        assert_eq!(found("gone", "Gone Camera"), None);
    }

    #[test]
    fn reports_the_requested_frame_rate() {
        let selection = Selection {
            index: 2,
            format: Format {
                width: 1080,
                height: 1920,
                fps: Rational::new(60, 1),
            },
            fps: Rational::new(60_000, 2_000),
        };
        assert_eq!(
            video_format(&selection),
            VideoFormat {
                width: 1080,
                height: 1920,
                fps: [30, 1],
            }
        );
    }

    #[test]
    fn maps_capture_errors_to_codes() {
        let code = |error: CaptureError| capture_error(&error).code;
        assert_eq!(
            code(CaptureError::PermissionDenied),
            ErrorCode::PermissionDenied
        );
        assert_eq!(
            code(CaptureError::PermissionRestricted),
            ErrorCode::PermissionDenied
        );
        assert_eq!(code(CaptureError::DeviceBusy), ErrorCode::DeviceBusy);
        assert_eq!(
            code(CaptureError::DeviceNotFound("x".into())),
            ErrorCode::NotFound
        );
        assert_eq!(code(CaptureError::NoSupportedFormat), ErrorCode::Internal);
        assert_eq!(code(CaptureError::Unsupported), ErrorCode::Internal);
        let platform = capture_error(&CaptureError::Platform {
            context: "activate source",
            message: "0x80070005".into(),
        });
        assert_eq!(platform.code, ErrorCode::Internal);
        assert!(platform.message.contains("activate source: 0x80070005"));

        let lost = device_lost(true, "the camera was disconnected");
        assert_eq!(lost.code, ErrorCode::DeviceLost);
        assert_eq!(
            lost.message,
            "Capture stopped: the camera was disconnected. Footage up to that point was saved."
        );
        assert_eq!(
            device_lost(false, "the camera was disconnected").message,
            "The camera was disconnected."
        );
        assert!(recording_failed("disk full").message.contains("disk full"));
    }

    #[test]
    fn maps_take_changes_to_events() {
        let root = RecordRoot::resolve_with(None, Some(std::path::Path::new("/nowhere"))).unwrap();
        let opened = TakeChange::Opened {
            index: 2,
            id: "video-01-take-3".to_string(),
        };
        assert_eq!(
            serde_json::to_value(take_event(&opened, &root)).unwrap(),
            serde_json::json!({ "event": "takeOpened", "payload": { "index": 2 } })
        );
        let recording: Recording = serde_json::from_value(serde_json::json!({
            "id": "video-01-take-3",
            "filename": "video-01.mp4",
            "dimensions": [1920, 1080],
            "fps": [30, 1],
            "frameStart": 915,
            "fileOffsetSec": 1.5,
            "transportStartSec": 32.0,
            "transportStartBeats": 64.0,
            "durationSec": 36.2,
            "tempo": 120.0,
            "timeSignature": [4, 4],
            "camera": "FaceTime HD Camera",
            "createdAt": "2026-09-25T20:36:12Z",
        }))
        .unwrap();
        let UiEvent::TakeClosed(take) = take_event(&TakeChange::Closed(recording), &root) else {
            panic!("expected takeClosed");
        };
        assert_eq!(take.id, "video-01-take-3");
        assert_eq!(take.file_offset_sec, 1.5);
        assert_eq!(take.transport_start_beats, Some(64.0));
        assert!(!take.unanchored);
        assert!(take.missing);
    }

    #[test]
    fn computes_the_status_phase() {
        let format = VideoFormat {
            width: 1920,
            height: 1080,
            fps: [30, 1],
        };
        let capture = CaptureInfo {
            elapsed_ms: 5_000,
            takes: 2,
            dropped_frames: 1,
        };
        let busy = UiError::new(ErrorCode::DeviceBusy, "busy");

        let status_of = |inputs: StatusInputs<'_>| status(inputs);
        assert_eq!(status_of(StatusInputs::default()), Status::default());

        let ready = status_of(StatusInputs {
            camera_id: Some("cam"),
            format: Some(format),
            ..StatusInputs::default()
        });
        assert_eq!(ready.phase, Phase::Ready);
        assert_eq!(ready.camera_id.as_deref(), Some("cam"));
        assert_eq!(ready.format, Some(format));

        // Chosen but still opening: ready, without a format yet.
        let opening = status_of(StatusInputs {
            camera_id: Some("cam"),
            ..StatusInputs::default()
        });
        assert_eq!((opening.phase, opening.format), (Phase::Ready, None));

        let capturing = status_of(StatusInputs {
            camera_id: Some("cam"),
            format: Some(format),
            capture: Some(capture),
            error: None,
            live: None,
        });
        assert_eq!(capturing.phase, Phase::Capturing);
        assert_eq!(capturing.capture, Some(capture));
        assert_eq!(capturing.live, None);

        let failed = status_of(StatusInputs {
            camera_id: Some("cam"),
            format: Some(format),
            capture: Some(capture),
            error: Some(&busy),
            live: Some(LiveInfo { record_armed: true }),
        });
        assert_eq!(failed.phase, Phase::Error);
        assert_eq!(failed.camera_id.as_deref(), Some("cam"));
        assert_eq!((failed.format, failed.capture), (None, None));
        assert_eq!(failed.error, Some(busy));
        assert_eq!(failed.live, Some(LiveInfo { record_armed: true }));
    }

    #[test]
    fn maps_tapped_audio_to_recorder_blocks() {
        assert_eq!(
            audio_format(44_100.0),
            AudioFormat {
                sample_rate: 44_100,
                channels: 2,
            }
        );
        assert_eq!(audio_format(47_999.6).sample_rate, 48_000);
        let block = audio_block(TapBlock {
            host_time: 12.5,
            sample_rate: 48_000.0,
            samples: vec![0.25, -0.25],
        });
        assert_eq!(block.host_time, Some(HostTime::from_nanos(12_500_000_000)));
        assert_eq!(block.samples, [0.25, -0.25]);
    }
}
