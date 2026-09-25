//! The ZVID Capture plugin binary. It ties the capture, UI and plugin-format
//! crates together and is bundled into `.vst3` and `.component` by `xtask`.

/// Display name the `/app` importer keys on.
pub const PLUGIN_NAME: &str = "ZVID Capture";
/// Vendor name reported to hosts.
pub const VENDOR: &str = "ZVID";
