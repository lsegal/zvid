//! Pure, host-independent logic for the ZVID Capture plugin: the persisted
//! state schema, the transport-following take tracker, capture file naming,
//! record-root resolution, and the audio-to-control-thread ring and swap cell.
//! Nothing here touches cameras, hosts or UI.

pub mod naming;
pub mod paths;
pub mod ring;
pub mod state;
pub mod swap;
pub mod tracker;

pub use naming::{LocalTime, capture_filename, next_capture_filename};
pub use paths::{RecordRoot, RecordRootKind};
pub use ring::{Consumer, Producer, ring};
pub use state::{Recording, RecordingMeta, State, StateError, frame_start};
pub use tracker::{Anchor, Event, Input, Take, TakeTracker, TransportSnapshot};

/// Display name the `/app` importer keys on.
pub const PLUGIN_NAME: &str = "ZVID Capture";
/// Vendor name reported to hosts.
pub const VENDOR: &str = "ZVID";
