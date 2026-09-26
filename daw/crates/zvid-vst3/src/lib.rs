//! The ZVID Capture VST3 format layer: a hand-written subset of the VST3 COM
//! ABI, rebuilt from the public VST3 interface documentation without the
//! Steinberg SDK or bindings generated from its headers.
//!
//! - [`abi`]: interface IDs, vtables, structs and result codes.
//! - [`plugin_factory`]: the `IPluginFactory2` behind `GetPluginFactory`.
//! - [`component::Component`]: the single-component `IComponent` +
//!   `IAudioProcessor` + `IEditController`.
//! - [`view::View`]: the editor `IPlugView`.
//! - [`moduleinfo`]: the bundle's `moduleinfo.json`.

pub mod abi;
pub mod component;
mod factory;
mod log;
pub mod moduleinfo;
pub mod transport;
pub mod view;

pub use factory::plugin_factory;
pub use log::LOG_ENV;

/// The four words of the ZVID Capture class ID. Also the controller class
/// ID, since the component is its own controller.
pub const CLASS_ID_WORDS: [u32; 4] = [0xDC05282D, 0x436D4620, 0xB10F6845, 0x1DA9BE4B];
pub const CLASS_ID: abi::Tuid = abi::uid(
    CLASS_ID_WORDS[0],
    CLASS_ID_WORDS[1],
    CLASS_ID_WORDS[2],
    CLASS_ID_WORDS[3],
);
/// Plugin categories hosts browse by.
pub const SUB_CATEGORIES: &str = "Fx|Tools";
pub const URL: &str = "https://github.com/lsegal/zvid";
/// Plugin version reported to hosts.
pub const VERSION: &str = zvid_daw_core::VERSION;
/// VST3 interface version the ABI subset follows.
pub const SDK_VERSION: &str = "VST 3.7";
