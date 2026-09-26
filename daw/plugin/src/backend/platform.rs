//! What the backend needs from cameras, the recorder and the clocks, so its
//! logic can be tested without hardware. [`System`] is the real thing,
//! over `zvid-capture`.

use std::any::Any;
use std::sync::Arc;

use zvid_capture::record::{RecordConfig, RecordError, RecordStats, Recorded, Recorder};
use zvid_capture::{
    CaptureConfig, CaptureError, CaptureSession, Device, DeviceEvent, DeviceId, DeviceWatcher,
    Frame, PreviewConfig, Selection, SessionStats,
};
use zvid_daw_core::{LocalTime, clock};

/// Receives every captured frame on the capture thread.
pub type FrameSink = Box<dyn FnMut(&Arc<Frame>) + Send>;
/// Receives preview JPEGs on the preview thread.
pub type PreviewSink = Box<dyn FnMut(Vec<u8>) + Send>;
/// Receives hot-plug events on the watcher thread.
pub type DeviceSink = Box<dyn FnMut(DeviceEvent) + Send>;

pub trait Platform: Send + Sync + 'static {
    fn devices(&self) -> Result<Vec<Device>, CaptureError>;
    /// Watches for hot-plug until the returned guard is dropped. Called on,
    /// and the guard dropped on, the backend's monitor thread.
    fn watch(&self, on_event: DeviceSink) -> Result<Box<dyn Any>, CaptureError>;
    /// Opens a camera for preview and capture. May block while the system
    /// asks for camera permission.
    fn open(
        &self,
        device: &DeviceId,
        frames: FrameSink,
        preview: PreviewSink,
    ) -> Result<Box<dyn CameraSession>, CaptureError>;
    /// Starts a capture file.
    fn record(&self, config: RecordConfig) -> Result<Box<dyn CaptureFile>, RecordError>;
    /// Seconds on the host clock that transport snapshots and frames use.
    fn now_sec(&self) -> f64;
    /// Local wall-clock time, for capture file names.
    fn local_time(&self) -> LocalTime;
}

/// An open camera. Capture stops when it is dropped.
pub trait CameraSession: Send {
    fn selection(&self) -> Selection;
    fn stats(&self) -> SessionStats;
}

/// A capture file being recorded.
pub trait CaptureFile: Send {
    /// The file name relative to the record root.
    fn filename(&self) -> &str;
    /// Queues a frame without blocking.
    fn push_frame(&self, frame: Arc<Frame>);
    fn stats(&self) -> RecordStats;
    /// Finishes the file. Blocks while it is finalized.
    fn stop(self: Box<Self>) -> Result<Recorded, RecordError>;
}

/// Cameras, recorder and clocks of the machine the plugin runs on.
pub struct System;

impl Platform for System {
    fn devices(&self) -> Result<Vec<Device>, CaptureError> {
        zvid_capture::list_devices()
    }

    fn watch(&self, on_event: DeviceSink) -> Result<Box<dyn Any>, CaptureError> {
        Ok(Box::new(DeviceWatcher::start(on_event)?))
    }

    fn open(
        &self,
        device: &DeviceId,
        frames: FrameSink,
        mut preview: PreviewSink,
    ) -> Result<Box<dyn CameraSession>, CaptureError> {
        let config = CaptureConfig::new()
            .on_frame(frames)
            .on_preview(PreviewConfig::default(), move |frame| preview(frame.jpeg));
        Ok(Box::new(CaptureSession::start(device, config)?))
    }

    fn record(&self, config: RecordConfig) -> Result<Box<dyn CaptureFile>, RecordError> {
        Ok(Box::new(Recorder::start(config)?))
    }

    fn now_sec(&self) -> f64 {
        clock::now_sec()
    }

    fn local_time(&self) -> LocalTime {
        super::local_time::now()
    }
}

impl CameraSession for CaptureSession {
    fn selection(&self) -> Selection {
        CaptureSession::selection(self)
    }

    fn stats(&self) -> SessionStats {
        CaptureSession::stats(self)
    }
}

impl CaptureFile for Recorder {
    fn filename(&self) -> &str {
        Recorder::filename(self)
    }

    fn push_frame(&self, frame: Arc<Frame>) {
        Recorder::push_frame(self, frame);
    }

    fn stats(&self) -> RecordStats {
        Recorder::stats(self)
    }

    fn stop(self: Box<Self>) -> Result<Recorded, RecordError> {
        Recorder::stop(*self)
    }
}
