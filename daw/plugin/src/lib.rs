//! The ZVID Capture plugin binary. It ties the capture, UI and plugin-format
//! crates together and is bundled into `.vst3` and `.component` by `xtask`.
//!
//! This crate exports the VST3 module entry points (`GetPluginFactory` on
//! every platform, plus the platform's load/unload hooks) and, on macOS, the
//! AUv2 factory function. [`backend`] implements the editor's backend over
//! the capture layer and the format layers' take log; both factories
//! register it so every instance's editors use it.

use std::ffi::c_void;
use std::sync::Arc;

use zvid_daw_ui::{Backend, HostLink};

pub mod backend;

pub use zvid_daw_core::{PLUGIN_NAME, VENDOR};

/// Makes the format layers start a [`backend::CaptureBackend`] for each
/// instance's editors. Called before the host can create an instance.
fn register_backend() {
    zvid_daw_ui::register_backend(capture_backend);
}

fn capture_backend(link: HostLink) -> Arc<dyn Backend> {
    backend::CaptureBackend::start(platform(), link)
}

#[cfg(not(test))]
fn platform() -> Arc<dyn backend::Platform> {
    Arc::new(backend::System)
}

#[cfg(test)]
fn platform() -> Arc<dyn backend::Platform> {
    backend::tests::platform()
}

/// Returns the VST3 plugin factory.
#[unsafe(no_mangle)]
pub extern "system" fn GetPluginFactory() -> *mut c_void {
    register_backend();
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

/// The AUv2 `AudioComponentFactoryFunction`, exported under the name the
/// `.component` bundle's `Info.plist` gives as `factoryFunction`.
///
/// # Safety
///
/// Only the AudioComponent loader may call this.
#[cfg(target_os = "macos")]
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ZVIDCaptureAUFactory(description: *const c_void) -> *mut c_void {
    register_backend();
    // SAFETY: forwarded from the loader.
    unsafe { zvid_au::factory(description) }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;
    use zvid_daw_core::State;
    use zvid_daw_ui::ErrorCode;
    use zvid_vst3::abi::{FUnknownVtbl, IPLUGIN_FACTORY2_IID, result, vtbl};
    use zvid_vst3::component::Component;

    /// Checks that `backend` is the capture backend over the test platform,
    /// wired to `state`: it lists the fake's cameras, not the mock's, and
    /// stores the chosen one in the instance's state.
    fn assert_capture_backend(backend: &dyn Backend, state: impl Fn() -> State) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while backend.cameras().len() != 3 {
            assert!(Instant::now() < deadline, "timed out waiting for cameras");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(backend.cameras()[0].id, "builtin");
        backend.select_camera("usb-1").unwrap();
        assert_eq!(
            state().camera.map(|camera| camera.id).as_deref(),
            Some("usb-1")
        );
    }

    /// Checks that a backend whose instance was destroyed is shut down.
    fn assert_shut_down(backend: &dyn Backend) {
        let error = backend.select_camera("builtin").unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(backend.cameras().is_empty());
    }

    #[test]
    fn vst3_editors_use_the_capture_backend() {
        register_backend();
        let component = Component::create();
        let backend = {
            // SAFETY: `create` returns a live component holding one
            // reference, released below.
            let instance = unsafe { &*component };
            let backend = instance.backend();
            assert!(Arc::ptr_eq(&backend, &instance.backend()));
            assert_capture_backend(backend.as_ref(), || instance.state().clone());
            backend
        };

        // SAFETY: the component's first field is its `IComponent` vtable,
        // and this drops the reference `create` returned.
        unsafe {
            let unknown: *mut c_void = component.cast();
            (vtbl::<FUnknownVtbl>(unknown).release)(unknown);
        }
        assert_shut_down(backend.as_ref());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn au_editors_use_the_capture_backend() {
        // SAFETY: the factory ignores the description, and the unit is freed
        // below as `Close` would.
        let unit = unsafe { ZVIDCaptureAUFactory(std::ptr::null()) };
        let instance = unsafe { Box::from_raw(unit.cast::<zvid_au::AudioUnitInstance>()) };
        let backend = instance.backend();
        assert!(Arc::ptr_eq(&backend, &instance.backend()));
        assert_capture_backend(backend.as_ref(), || instance.state().clone());

        drop(instance);
        assert_shut_down(backend.as_ref());
    }

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
