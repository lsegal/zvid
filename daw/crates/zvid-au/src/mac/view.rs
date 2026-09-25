//! `kAudioUnitProperty_CocoaUI`: the view factory class hosts instantiate to
//! build the editor. The class is defined in Rust and conforms to
//! `AUCocoaUIBase`.

use std::ffi::c_uint;
use std::ptr::NonNull;

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{ClassType, MainThreadMarker, MainThreadOnly, define_class};
use objc2_app_kit::NSView;
use objc2_audio_toolbox::{AUCocoaUIBase, AudioUnit, AudioUnitCocoaViewInfo};
use objc2_foundation::{NSBundle, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};

use super::instance_from_unit;
use crate::component::{BUNDLE_ID, VIEW_FACTORY_CLASS};

/// Editor size used when the host asks for none.
pub const DEFAULT_EDITOR_SIZE: (f64, f64) = (720.0, 480.0);
/// `AUCocoaUIBase` interface version this factory implements.
const INTERFACE_VERSION: c_uint = 0;

define_class!(
    /// Creates the editor view for a ZVID Capture unit.
    // Keep the name in sync with `VIEW_FACTORY_CLASS`.
    #[unsafe(super(NSObject))]
    #[name = "ZVIDCaptureAUViewFactory"]
    pub struct ViewFactory;

    unsafe impl NSObjectProtocol for ViewFactory {}

    unsafe impl AUCocoaUIBase for ViewFactory {
        #[unsafe(method(interfaceVersion))]
        fn interface_version(&self) -> c_uint {
            INTERFACE_VERSION
        }

        #[unsafe(method_id(uiViewForAudioUnit:withSize:))]
        fn ui_view(&self, unit: AudioUnit, size: NSSize) -> Option<Retained<NSView>> {
            editor_view(unit, size)
        }
    }
);

/// The editor for `unit`: an `NSView` the host embeds in its plugin window.
/// The webview editor (#195) attaches to this view.
fn editor_view(unit: AudioUnit, size: NSSize) -> Option<Retained<NSView>> {
    let mtm = MainThreadMarker::new()?;
    // Only build editors for our own units.
    // SAFETY: the host passes the open unit the view is for.
    unsafe { instance_from_unit(unit) }?;
    let (width, height) = if size.width >= 1.0 && size.height >= 1.0 {
        (size.width, size.height)
    } else {
        DEFAULT_EDITOR_SIZE
    };
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height));
    Some(NSView::initWithFrame(NSView::alloc(mtm), frame))
}

/// The CocoaUI property value: this bundle and the view factory class name.
/// Both are returned retained; the host releases them.
pub fn cocoa_view_info() -> Option<AudioUnitCocoaViewInfo> {
    // Register the class now, so the host finds it when it looks it up by
    // name in the (already loaded) bundle.
    let _ = ViewFactory::class();
    let bundle = NSBundle::bundleWithIdentifier(&NSString::from_str(BUNDLE_ID))?;
    let url = Retained::into_raw(bundle.bundleURL());
    let class_name = Retained::into_raw(NSString::from_str(VIEW_FACTORY_CLASS));
    Some(AudioUnitCocoaViewInfo {
        mCocoaAUViewBundleLocation: NonNull::new(url.cast())?,
        mCocoaAUViewClass: [NonNull::new(class_name.cast())?],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_name_matches_the_component_constant() {
        assert_eq!(ViewFactory::class().name().to_str(), Ok(VIEW_FACTORY_CLASS));
    }

    #[test]
    fn view_factory_conforms_to_au_cocoa_ui_base() {
        let factory: Retained<ViewFactory> = unsafe { objc2::msg_send![ViewFactory::class(), new] };
        assert_eq!(unsafe { factory.interfaceVersion() }, INTERFACE_VERSION);
    }
}
