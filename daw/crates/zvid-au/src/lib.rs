//! AUv2 (`.component`) format layer for ZVID Capture, in pure Rust.
//!
//! The component is macOS only. [`component`] and [`transport`] hold the
//! platform-independent parts (the component identity, its `Info.plist`, and
//! the host-transport conversion) so they build and test everywhere; the AU
//! ABI itself lives behind `cfg(target_os = "macos")`.

pub mod component;
pub mod transport;

#[cfg(target_os = "macos")]
mod mac;

#[cfg(target_os = "macos")]
pub use mac::{AudioUnitInstance, factory, instance_from_unit};
