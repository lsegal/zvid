//! The AUv2 component itself: the factory, the plug-in interface and its
//! selector handlers, and the Cocoa view factory.

mod class_info;
mod control;
mod instance;
mod log;
mod view;

use std::ffi::c_void;

pub use instance::{AudioUnitInstance, instance_from_unit};

/// The `AudioComponentFactoryFunction` named by the `factoryFunction` plist
/// key. Returns a new `AudioComponentPlugInInterface`, which the component
/// loader opens, drives through `Lookup`, and finally closes.
///
/// # Safety
///
/// Only the AudioComponent loader may call this; the returned pointer must be
/// released through the interface's `Close`.
pub unsafe fn factory(_description: *const c_void) -> *mut c_void {
    AudioUnitInstance::create().cast()
}
