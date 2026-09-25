use crate::fanout::Dispatcher;
use crate::{CaptureError, Device, DeviceId, Format, FormatPreference, Permission, Selection};
use std::sync::Arc;
use std::time::Duration;

pub(crate) fn list_devices() -> Result<Vec<Device>, CaptureError> {
    Ok(Vec::new())
}

pub(crate) fn supported_formats(id: &DeviceId) -> Result<Vec<Format>, CaptureError> {
    Err(CaptureError::DeviceNotFound(id.0.clone()))
}

pub(crate) fn permission() -> Permission {
    Permission::Authorized
}

pub(crate) fn request_permission() -> Permission {
    Permission::Authorized
}

pub(crate) fn run_main_loop_for(duration: Duration) {
    std::thread::sleep(duration);
}

pub(crate) struct Session;

impl Session {
    pub(crate) fn start(
        _device: &DeviceId,
        _pref: &FormatPreference,
        _dispatcher: Dispatcher,
    ) -> Result<(Self, Selection), CaptureError> {
        Err(CaptureError::Unsupported)
    }
}

pub(crate) struct Notifier;

impl Notifier {
    pub(crate) fn register(_nudge: Arc<dyn Fn() + Send + Sync>) -> Result<Self, CaptureError> {
        Err(CaptureError::Unsupported)
    }
}
