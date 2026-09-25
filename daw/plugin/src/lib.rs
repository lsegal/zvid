//! The ZVID Capture plugin binary. It ties the capture, UI and plugin-format
//! crates together and is bundled into `.vst3` and `.component` by `xtask`.

/// Display name the `/app` importer keys on.
pub const PLUGIN_NAME: &str = "ZVID Capture";
/// Vendor name reported to hosts.
pub const VENDOR: &str = "ZVID";

/// The AUv2 `AudioComponentFactoryFunction`, exported under the name the
/// `.component` bundle's `Info.plist` gives as `factoryFunction`.
///
/// # Safety
///
/// Only the AudioComponent loader may call this.
#[cfg(target_os = "macos")]
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ZVIDCaptureAUFactory(
    description: *const std::ffi::c_void,
) -> *mut std::ffi::c_void {
    // SAFETY: forwarded from the loader.
    unsafe { zvid_au::factory(description) }
}
