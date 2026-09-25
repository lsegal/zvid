//! What the editor needs from the rest of the plugin.

use crate::channels::Channels;
use crate::model::{Camera, Status, TakeFile, TakeInfo, UiError};

/// The plugin side of the editor. The plugin implements this over its
/// capture layer and take tracker; [`crate::mock::MockBackend`] implements
/// it for the harness and tests.
///
/// Commands are called on worker threads, never on the host's UI thread,
/// so they may block briefly. State changes are announced by emitting
/// [`crate::UiEvent`]s on [`Backend::channels`], and preview frames are
/// published there too.
pub trait Backend: Send + Sync + 'static {
    /// Every camera the capture layer can see, in menu order.
    fn cameras(&self) -> Vec<Camera>;
    /// Opens the camera with this ID for preview and remembers it in the
    /// plugin state.
    fn select_camera(&self, id: &str) -> Result<(), UiError>;
    /// Rescans devices and returns the new list.
    fn refresh_devices(&self) -> Result<Vec<Camera>, UiError>;
    /// Starts a capture (the Record button).
    fn arm(&self) -> Result<(), UiError>;
    /// Ends the capture (the Stop capturing button).
    fn disarm(&self) -> Result<(), UiError>;
    fn status(&self) -> Status;
    /// The takes in the plugin state, newest first.
    fn takes(&self) -> Vec<TakeInfo>;
    /// The file behind a take, or `None` for an unknown ID.
    fn take_file(&self, id: &str) -> Option<TakeFile>;
    fn channels(&self) -> &Channels;
}
