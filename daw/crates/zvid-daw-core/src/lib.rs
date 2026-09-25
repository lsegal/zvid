//! Pure, host-independent logic for the ZVID Capture plugin: the persisted
//! state schema, the transport-following take tracker, capture file naming
//! and record-root resolution, plus the lock-free plumbing the plugin-format
//! layers share with the audio thread. Nothing here touches cameras, hosts or
//! UI.

pub mod audio;
pub mod naming;
pub mod paths;
pub mod ring;
pub mod state;
pub mod tracker;

pub use audio::InputTap;

pub use naming::{LocalTime, capture_filename, next_capture_filename};
pub use paths::{RecordRoot, RecordRootKind};
pub use state::{Recording, RecordingMeta, State, StateError, frame_start};
pub use tracker::{Anchor, Event, Input, Take, TakeTracker, TransportSnapshot};
