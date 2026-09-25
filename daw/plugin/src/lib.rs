//! The ZVID Capture plugin binary. It ties the capture, UI and plugin-format
//! crates together and is bundled into `.vst3` and `.component` by `xtask`.
//!
//! This crate exports the VST3 module entry points: `GetPluginFactory` on
//! every platform, plus the platform's load/unload hooks.

use std::ffi::c_void;

pub use zvid_daw_core::{PLUGIN_NAME, VENDOR};

/// Returns the VST3 plugin factory.
#[unsafe(no_mangle)]
pub extern "system" fn GetPluginFactory() -> *mut c_void {
    zvid_vst3::plugin_factory()
}

/// Called once after Windows loads the module.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn InitDll() -> bool {
    true
}

/// Called once before Windows unloads the module.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn ExitDll() -> bool {
    true
}

/// Called once after macOS loads the bundle, with its `CFBundleRef`.
#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub extern "C" fn bundleEntry(_bundle: *mut c_void) -> bool {
    true
}

/// Called once before macOS unloads the bundle.
#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub extern "C" fn bundleExit() -> bool {
    true
}

/// Called once after Linux loads the module, with its `dlopen` handle.
#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn ModuleEntry(_handle: *mut c_void) -> bool {
    true
}

/// Called once before Linux unloads the module.
#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn ModuleExit() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use zvid_vst3::abi::{FUnknownVtbl, IPLUGIN_FACTORY2_IID, result, vtbl};

    #[test]
    fn exports_the_plugin_factory() {
        let factory = GetPluginFactory();
        assert!(!factory.is_null());
        let mut out = std::ptr::null_mut();
        let query = unsafe { vtbl::<FUnknownVtbl>(factory) }.query_interface;
        assert_eq!(
            unsafe { query(factory, &IPLUGIN_FACTORY2_IID, &mut out) },
            result::OK
        );
        assert_eq!(out, factory);
    }
}
