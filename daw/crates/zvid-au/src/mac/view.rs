//! `kAudioUnitProperty_CocoaUI`: the view factory class hosts instantiate to
//! build the editor, and the editor view it returns. Both classes are
//! defined in Rust; the factory conforms to `AUCocoaUIBase`.
//!
//! The editor view owns the webview editor ([`zvid_daw_ui::Editor`]) while
//! it is in a window: it opens the editor when the host puts it in the
//! plugin window, follows its resizes and backing scale, and drops the
//! editor when it leaves the window or is deallocated.

use std::cell::RefCell;
use std::ffi::c_uint;
use std::ptr::NonNull;
use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{ClassType, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{NSResponder, NSView};
use objc2_audio_toolbox::{AUCocoaUIBase, AudioUnit, AudioUnitCocoaViewInfo};
use objc2_foundation::{NSBundle, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use zvid_daw_ui::dpi::LogicalSize;
use zvid_daw_ui::editor::constrain;
use zvid_daw_ui::{Backend, DEFAULT_SIZE, Editor, EditorOptions, ParentWindow};

use super::instance_from_unit;
use super::log::log;
use crate::component::{BUNDLE_ID, VIEW_FACTORY_CLASS};

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

pub struct EditorViewIvars {
    backend: Arc<dyn Backend>,
    /// The webview while the view is in a window.
    editor: RefCell<Option<Editor>>,
}

define_class!(
    /// The view the host embeds in its plugin window. It hosts the editor.
    // SAFETY: NSView has no subclassing requirements beyond calling super
    // in the overridden methods, and the class doesn't implement `Drop`.
    #[unsafe(super(NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ZVIDCaptureAUEditorView"]
    #[ivars = EditorViewIvars]
    pub struct EditorView;

    unsafe impl NSObjectProtocol for EditorView {}

    impl EditorView {
        #[unsafe(method(viewDidMoveToWindow))]
        fn view_did_move_to_window(&self) {
            let _: () = unsafe { msg_send![super(self), viewDidMoveToWindow] };
            if self.window().is_some() {
                self.open();
            } else {
                self.close();
            }
        }

        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
            if let Some(editor) = self.ivars().editor.borrow().as_ref()
                && let Err(error) = editor.set_size(self.size())
            {
                log(&format!("could not resize the editor: {error}"));
            }
        }

        #[unsafe(method(viewDidChangeBackingProperties))]
        fn view_did_change_backing_properties(&self) {
            let _: () = unsafe { msg_send![super(self), viewDidChangeBackingProperties] };
            if let Some(editor) = self.ivars().editor.borrow().as_ref()
                && let Err(error) = editor.set_scale_factor(self.scale())
            {
                log(&format!("could not rescale the editor: {error}"));
            }
        }
    }
);

impl EditorView {
    fn new(mtm: MainThreadMarker, frame: NSRect, backend: Arc<dyn Backend>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(EditorViewIvars {
            backend,
            editor: RefCell::new(None),
        });
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }

    /// Whether the webview editor is open.
    pub fn has_editor(&self) -> bool {
        self.ivars().editor.borrow().is_some()
    }

    /// The view's size in points.
    fn size(&self) -> LogicalSize<f64> {
        let size = self.frame().size;
        LogicalSize::new(size.width, size.height)
    }

    /// The backing scale of the window the view is in.
    fn scale(&self) -> f64 {
        self.window()
            .map_or(1.0, |window| window.backingScaleFactor())
    }

    fn open(&self) {
        if self.has_editor() {
            return;
        }
        let parent = ParentWindow::AppKit(NonNull::from(self).cast());
        // SAFETY: the view owns the editor, so it outlives it, and AppKit
        // only calls the view on the main thread.
        let editor = unsafe {
            Editor::attach(
                parent,
                self.size(),
                self.scale(),
                self.ivars().backend.clone(),
                EditorOptions::default(),
            )
        };
        match editor {
            Ok(editor) => *self.ivars().editor.borrow_mut() = Some(editor),
            Err(error) => log(&format!("could not open the editor: {error}")),
        }
    }

    fn close(&self) {
        let editor = self.ivars().editor.borrow_mut().take();
        drop(editor);
    }
}

/// The frame for a view the host asks for at `size`: the design's default
/// size when the host gives none, and never below the minimum.
fn editor_frame(size: NSSize) -> NSRect {
    let size = if size.width >= 1.0 && size.height >= 1.0 {
        LogicalSize::new(size.width, size.height)
    } else {
        DEFAULT_SIZE
    };
    let size = constrain(size);
    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(size.width, size.height))
}

/// The editor for `unit`: an `NSView` the host embeds in its plugin window.
fn editor_view(unit: AudioUnit, size: NSSize) -> Option<Retained<NSView>> {
    let mtm = MainThreadMarker::new()?;
    // Only build editors for our own units.
    // SAFETY: the host passes the open unit the view is for.
    let instance = unsafe { instance_from_unit(unit) }?;
    let view = EditorView::new(mtm, editor_frame(size), instance.backend());
    Some(Retained::into_super(view))
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
    use zvid_daw_core::State;
    use zvid_daw_ui::MIN_SIZE;
    use zvid_daw_ui::mock::MockBackend;

    #[test]
    fn class_name_matches_the_component_constant() {
        assert_eq!(ViewFactory::class().name().to_str(), Ok(VIEW_FACTORY_CLASS));
    }

    #[test]
    fn view_factory_conforms_to_au_cocoa_ui_base() {
        let factory: Retained<ViewFactory> = unsafe { objc2::msg_send![ViewFactory::class(), new] };
        assert_eq!(unsafe { factory.interfaceVersion() }, INTERFACE_VERSION);
    }

    #[test]
    fn sizes_the_editor_view_from_the_design() {
        let size = |width, height| editor_frame(NSSize::new(width, height)).size;
        assert_eq!(
            size(0.0, 0.0),
            NSSize::new(DEFAULT_SIZE.width, DEFAULT_SIZE.height)
        );
        assert_eq!(size(100.0, 900.0), NSSize::new(MIN_SIZE.width, 900.0));
        assert_eq!(size(1000.0, 800.0), NSSize::new(1000.0, 800.0));
    }

    #[test]
    fn opens_the_editor_only_in_a_window() {
        // AppKit views need the main thread, which the test harness only
        // gives a test when run with `--test-threads 1`.
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let backend = Arc::new(MockBackend::for_plugin(State::default()));
        let view = EditorView::new(mtm, editor_frame(NSSize::new(0.0, 0.0)), backend);
        assert!(!view.has_editor());
        view.setFrameSize(NSSize::new(700.0, 800.0));
        assert_eq!(view.size(), LogicalSize::new(700.0, 800.0));
        // Leaving a window it was never in closes nothing.
        view.viewDidMoveToWindow();
        assert!(!view.has_editor());
    }
}
