//! Camera discovery and capture for ZVID Capture.
//!
//! - [`list_devices`] and [`DeviceWatcher`] enumerate cameras, including
//!   Continuity Camera and phone "webcam" apps, with hot-plug events.
//! - [`CaptureSession`] captures NV12 frames timestamped on the host
//!   monotonic clock ([`HostTime`]) and fans them out to the encoder at full
//!   rate and to a downscaled JPEG preview for the UI.
//!
//! Backends: AVFoundation on macOS, Media Foundation on Windows. Other
//! platforms build but report [`CaptureError::Unsupported`].

// The shared pipeline is only driven by the macOS and Windows backends.
#![cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]

mod backend;
mod clock;
mod error;
mod fanout;
mod format;
mod frame;
mod jitter;
mod preview;
mod watch;

use std::fmt;
use std::sync::{Arc, Mutex};

pub use clock::HostTime;
pub use error::{CaptureError, Permission};
pub use fanout::{FrameCallback, PreviewCallback, SessionStats};
pub use format::{select_format, Format, FormatPreference, Rational, Selection};
pub use frame::{pack_nv12, ColorInfo, Frame, PixelFormat, Rotation};
pub use jitter::JitterStats;
pub use preview::{PreviewConfig, PreviewFrame};
pub use watch::{diff as diff_devices, DeviceEvent, DeviceWatcher};

/// A stable, unique device identifier: the AVFoundation `uniqueID` on macOS
/// and the Media Foundation symbolic link on Windows. Safe to persist.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DeviceId(pub String);

impl fmt::Display for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// How a camera is connected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Transport {
    /// Part of the computer, such as a FaceTime or laptop camera.
    BuiltIn,
    Usb,
    Thunderbolt,
    /// An iPhone used through Continuity Camera.
    Continuity,
    /// A software camera: Camera Extensions (Camo, DroidCam), Windows
    /// virtual cameras, and Phone Link connected cameras.
    Virtual,
    /// A network or wireless camera.
    Wireless,
    Unknown,
}

impl fmt::Display for Transport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::BuiltIn => "built-in",
            Self::Usb => "USB",
            Self::Thunderbolt => "Thunderbolt",
            Self::Continuity => "Continuity Camera",
            Self::Virtual => "virtual",
            Self::Wireless => "wireless",
            Self::Unknown => "unknown",
        })
    }
}

/// A connected camera.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Device {
    pub id: DeviceId,
    /// Human-readable name for the device dropdown.
    pub name: String,
    pub transport: Transport,
}

/// Lists connected cameras.
pub fn list_devices() -> Result<Vec<Device>, CaptureError> {
    backend::list_devices()
}

/// Lists the capture formats a camera offers.
pub fn supported_formats(id: &DeviceId) -> Result<Vec<Format>, CaptureError> {
    backend::supported_formats(id)
}

/// The current camera permission state, without prompting.
pub fn permission() -> Permission {
    backend::permission()
}

/// Requests camera access, prompting the user the first time. Blocks until
/// the user answers, so don't call it on the UI thread.
pub fn request_permission() -> Permission {
    backend::request_permission()
}

/// Services platform callbacks for `duration` on the calling thread.
///
/// Hosts already run a main run loop; standalone tools on macOS call this
/// from the main thread so AVFoundation can deliver device notifications.
pub fn run_main_loop_for(duration: std::time::Duration) {
    backend::run_main_loop_for(duration)
}

/// Settings for [`CaptureSession::start`].
#[derive(Default)]
pub struct CaptureConfig {
    pub format: FormatPreference,
    on_frame: Option<FrameCallback>,
    preview: Option<(PreviewConfig, PreviewCallback)>,
}

impl CaptureConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn format(mut self, format: FormatPreference) -> Self {
        self.format = format;
        self
    }

    /// Receives every frame at full rate, on the capture thread (the encoder).
    pub fn on_frame(mut self, callback: impl FnMut(&Arc<Frame>) + Send + 'static) -> Self {
        self.on_frame = Some(Box::new(callback));
        self
    }

    /// Receives throttled, downscaled JPEG previews on a worker thread (the UI).
    pub fn on_preview(
        mut self,
        config: PreviewConfig,
        callback: impl FnMut(PreviewFrame) + Send + 'static,
    ) -> Self {
        self.preview = Some((config, Box::new(callback)));
        self
    }
}

/// A running capture from one camera. Capture stops when this is dropped.
pub struct CaptureSession {
    device: DeviceId,
    selection: Selection,
    stats: Arc<Mutex<SessionStats>>,
    inner: Option<backend::Session>,
}

impl CaptureSession {
    /// Opens `device` in the best format allowed by `config.format` and
    /// starts delivering frames. Requests camera permission if needed.
    pub fn start(device: &DeviceId, config: CaptureConfig) -> Result<Self, CaptureError> {
        if let Some(error) = request_permission().as_error() {
            return Err(error);
        }
        let dispatcher = fanout::Dispatcher::new(config.on_frame, config.preview);
        let stats = dispatcher.stats();
        let (inner, selection) = backend::Session::start(device, &config.format, dispatcher)?;
        Ok(Self {
            device: device.clone(),
            selection,
            stats,
            inner: Some(inner),
        })
    }

    pub fn device(&self) -> &DeviceId {
        &self.device
    }

    /// The device format in use and the frame rate requested from it.
    pub fn selection(&self) -> Selection {
        self.selection
    }

    pub fn stats(&self) -> SessionStats {
        *fanout::lock(&self.stats)
    }

    /// Stops capture and waits for in-flight callbacks to finish.
    pub fn stop(mut self) -> SessionStats {
        self.inner.take();
        self.stats()
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        self.inner.take();
    }
}
