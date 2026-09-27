//! The ZVID Capture plugin editor, hosted the same way as the Tauri app: a
//! Rust host embedding a web frontend (`daw/ui`).
//!
//! - [`Editor`] puts a wry child webview into the host's plugin window.
//! - The `zvid://` protocol ([`protocol`]) serves the embedded frontend,
//!   Tauri-style `invoke` commands and `emit` events, preview frames, take
//!   files and poster frames.
//! - [`LiveControl`] lets Live's record buttons arm the capture through the
//!   optional companion script.
//! - The plugin implements [`Backend`]; [`mock::MockBackend`] stands in for
//!   it in the harness (`cargo run -p zvid-daw-ui --example harness`) and
//!   tests.

pub mod assets;
pub mod backend;
pub mod channels;
pub mod desktop;
pub mod editor;
pub mod image;
pub mod live;
pub mod mock;
pub mod model;
pub mod poster;
pub mod protocol;
pub mod range;

/// Size and position types used by [`Editor`].
pub use wry::dpi;

pub use backend::{Backend, BackendFactory, HostLink, instance_backend, register_backend};
pub use channels::{Channels, EventLog, PreviewSlot};
pub use desktop::{Desktop, SystemDesktop};
pub use editor::{DEFAULT_SIZE, Editor, EditorOptions, MIN_SIZE, ParentWindow};
pub use live::LiveControl;
pub use model::{
    Camera, CaptureInfo, ErrorCode, LiveInfo, Phase, Status, TakeFile, TakeInfo, Transport,
    UiError, UiEvent, VideoFormat, takes_from_state,
};
