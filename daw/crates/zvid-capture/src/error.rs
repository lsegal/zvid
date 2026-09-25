use std::fmt;

/// Camera access state for this process.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Permission {
    /// The user hasn't been asked yet.
    NotDetermined,
    Authorized,
    /// The user or system settings turned camera access off.
    Denied,
    /// Policy (parental controls, MDM) blocks camera access.
    Restricted,
}

impl Permission {
    /// The error to report when capture can't start because of this state.
    pub fn as_error(self) -> Option<CaptureError> {
        match self {
            Self::Denied => Some(CaptureError::PermissionDenied),
            Self::Restricted => Some(CaptureError::PermissionRestricted),
            Self::NotDetermined | Self::Authorized => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureError {
    /// Camera access is turned off for this app.
    PermissionDenied,
    /// Camera access is blocked by policy.
    PermissionRestricted,
    /// Another application or session holds the camera exclusively.
    DeviceBusy,
    /// No camera with this ID is connected.
    DeviceNotFound(String),
    /// The device offers no format this crate can capture.
    NoSupportedFormat,
    /// Camera capture isn't implemented on this platform.
    Unsupported,
    /// A platform API failed.
    Platform {
        context: &'static str,
        message: String,
    },
}

impl CaptureError {
    pub(crate) fn platform(context: &'static str, message: impl fmt::Display) -> Self {
        Self::Platform {
            context,
            message: message.to_string(),
        }
    }
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PermissionDenied => f.write_str("camera access was denied"),
            Self::PermissionRestricted => {
                f.write_str("camera access is restricted by system policy")
            }
            Self::DeviceBusy => f.write_str("the camera is in use by another application"),
            Self::DeviceNotFound(id) => write!(f, "no camera with id {id:?} is connected"),
            Self::NoSupportedFormat => f.write_str("the camera offers no supported capture format"),
            Self::Unsupported => f.write_str("camera capture isn't supported on this platform"),
            Self::Platform { context, message } => write!(f, "{context}: {message}"),
        }
    }
}

impl std::error::Error for CaptureError {}
