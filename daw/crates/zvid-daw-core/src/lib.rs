//! Pure, host-independent logic for the ZVID Capture plugin: the persisted
//! state schema, the transport-following take tracker, capture file naming
//! and record-root resolution. Nothing here touches cameras, hosts or UI.

pub mod naming;
pub mod paths;
pub mod state;
pub mod tracker;

pub use naming::{LocalTime, capture_filename, next_capture_filename};
pub use paths::{RecordRoot, RecordRootKind};
pub use state::{Recording, RecordingMeta, State, StateError, frame_start};
pub use tracker::{Anchor, Event, Input, Take, TakeTracker, TransportSnapshot};
