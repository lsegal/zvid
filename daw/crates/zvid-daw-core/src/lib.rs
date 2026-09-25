//! Pure, host-independent logic for the ZVID Capture plugin: the persisted
//! state schema, the transport-following take tracker, the transport-change
//! watch both format layers share, capture file naming, record-root
//! resolution, the audio-to-control-thread ring and swap cell, and the link
//! to the optional Live companion script. Nothing here touches cameras, hosts
//! or UI; the only I/O is locating Documents and the companion's localhost
//! UDP socket.

pub mod live;
pub mod naming;
pub mod paths;
pub mod ring;
pub mod state;
pub mod swap;
pub mod tracker;
pub mod transport;

pub use live::{LiveLink, LiveStatus};
pub use naming::{LocalTime, capture_filename, next_capture_filename};
pub use paths::{RecordRoot, RecordRootKind};
pub use ring::{Consumer, Producer, ring};
pub use state::{Recording, RecordingMeta, State, StateError, frame_start};
pub use tracker::{Anchor, Event, Input, Take, TakeTracker, TransportSnapshot};
pub use transport::{Change, ProcessSnapshot, TransportFollower, TransportWatch, describe};

/// Environment variable naming the file the format layers append their
/// diagnostic log to, since hosts such as Live don't show a plugin's stderr.
pub const LOG_ENV: &str = "ZVID_DAW_LOG";

/// Display name the `/app` importer keys on.
pub const PLUGIN_NAME: &str = "ZVID Capture";
/// Vendor name reported to hosts.
pub const VENDOR: &str = "ZVID";
