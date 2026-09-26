//! What the editor needs from the rest of the plugin.

use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use zvid_daw_core::{Command, RecordRoot, State, TakeChange};

use crate::channels::Channels;
use crate::mock::MockBackend;
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
    /// Called when the plugin instance is destroyed, while editors may
    /// still hold the backend: stops any capture and closes the camera.
    /// Later commands fail.
    fn shutdown(&self) {}
}

/// The format layer's side of the backend: what VST3's `Component` and
/// AU's `AudioUnitInstance` expose for the editor.
pub struct HostLink {
    /// The persisted plugin state (`shared_state()`).
    pub state: Arc<Mutex<State>>,
    /// Where capture commands go (`commands()`).
    pub commands: Sender<Command>,
    /// Takes the control thread opens and closes (`take_changes()`).
    pub takes: Receiver<TakeChange>,
    /// Tells the host the state changed, so it marks the set as modified.
    pub state_changed: Box<dyn Fn() + Send + Sync>,
    /// Where capture files are written.
    pub record_root: RecordRoot,
}

/// Builds a plugin instance's backend from its [`HostLink`].
pub type BackendFactory = fn(HostLink) -> Arc<dyn Backend>;

static FACTORY: OnceLock<BackendFactory> = OnceLock::new();

/// Registers the factory [`instance_backend`] uses. The plugin binary
/// registers the real backend before the host creates any instance; the
/// format crates don't know it. Only the first registration counts.
pub fn register_backend(factory: BackendFactory) {
    let _ = FACTORY.set(factory);
}

/// The backend for a new plugin instance: the registered factory's, or a
/// [`MockBackend`] over a copy of the state when none is registered, as in
/// the format crates' own tests.
pub fn instance_backend(link: HostLink) -> Arc<dyn Backend> {
    match FACTORY.get() {
        Some(factory) => factory(link),
        None => {
            let state = link.state.lock().unwrap_or_else(|e| e.into_inner()).clone();
            Arc::new(MockBackend::new(link.record_root, state, None))
        }
    }
}
