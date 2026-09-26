//! The editor `IPlugView`: hosts the webview editor ([`zvid_daw_ui::Editor`])
//! in the host's parent window (`NSView` on macOS, `HWND` on Windows).
//!
//! The view also implements `IPlugViewContentScaleSupport`. VST3 view sizes
//! are in physical pixels on Windows and in points on macOS; the view keeps
//! its size in points and converts at the ABI boundary.

use std::cell::RefCell;
use std::ffi::c_void;
use std::mem::offset_of;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering, fence};
use std::sync::{Arc, Mutex};

use zvid_daw_ui::dpi::LogicalSize;
use zvid_daw_ui::{Backend, DEFAULT_SIZE, Editor, EditorOptions, ParentWindow};

use crate::abi::result::{FALSE, INVALID_ARGUMENT, NO_INTERFACE, OK};
use crate::abi::*;
use crate::log::log;

/// The parent window type this platform's hosts pass to `attached`.
#[cfg(target_os = "macos")]
const PLATFORM_TYPE: Option<&str> = Some(PLATFORM_NSVIEW);
#[cfg(windows)]
const PLATFORM_TYPE: Option<&str> = Some(PLATFORM_HWND);
#[cfg(not(any(target_os = "macos", windows)))]
const PLATFORM_TYPE: Option<&str> = None;

const VIEW: usize = offset_of!(View, vtbl);
const SCALE: usize = offset_of!(View, scale_vtbl);

/// The size and display scale the editor is laid out for.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Geometry {
    /// In points.
    size: LogicalSize<f64>,
    scale: f64,
}

#[repr(C)]
pub struct View {
    vtbl: &'static IPlugViewVtbl,
    scale_vtbl: &'static IPlugViewContentScaleSupportVtbl,
    refs: AtomicU32,
    geometry: Mutex<Geometry>,
    /// Host parent window while attached.
    parent: AtomicPtr<c_void>,
    /// Host `IPlugFrame`; owned by the host, so not reference-counted.
    frame: AtomicPtr<c_void>,
    backend: Arc<dyn Backend>,
    /// The webview while attached. Hosts call `IPlugView` on their UI
    /// thread, which is the only thread that touches it.
    editor: RefCell<Option<Editor>>,
}

impl View {
    /// Allocates a view holding one reference, whose editor will talk to
    /// `backend`.
    pub fn create(backend: Arc<dyn Backend>) -> *mut View {
        Box::into_raw(Box::new(View {
            vtbl: &VIEW_VTBL,
            scale_vtbl: &SCALE_VTBL,
            refs: AtomicU32::new(1),
            geometry: Mutex::new(Geometry {
                size: DEFAULT_SIZE,
                scale: 1.0,
            }),
            parent: AtomicPtr::new(ptr::null_mut()),
            frame: AtomicPtr::new(ptr::null_mut()),
            backend,
            editor: RefCell::new(None),
        }))
    }

    /// The host parent window while attached.
    pub fn parent(&self) -> Option<*mut c_void> {
        let parent = self.parent.load(Ordering::Acquire);
        (!parent.is_null()).then_some(parent)
    }

    /// Whether the webview editor is open.
    pub fn has_editor(&self) -> bool {
        self.editor.borrow().is_some()
    }

    fn geometry(&self) -> Geometry {
        *self.geometry.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn update(&self, change: impl FnOnce(&mut Geometry)) -> Geometry {
        let mut geometry = self.geometry.lock().unwrap_or_else(|e| e.into_inner());
        change(&mut geometry);
        *geometry
    }

    fn attach(&self, parent: *mut c_void) -> TResult {
        let Some(window) = parent_window(parent) else {
            return FALSE;
        };
        // A host that attaches twice without `removed` replaces the editor.
        drop(self.editor.borrow_mut().take());
        let Geometry { size, scale } = self.geometry();
        // SAFETY: the host keeps `parent` alive until `removed`, which drops
        // the editor, and calls `attached` on its UI thread.
        let editor = unsafe {
            Editor::attach(
                window,
                size,
                scale,
                self.backend.clone(),
                EditorOptions::default(),
            )
        };
        match editor {
            Ok(editor) => {
                *self.editor.borrow_mut() = Some(editor);
                self.parent.store(parent, Ordering::Release);
                OK
            }
            Err(error) => {
                log(&format!("could not open the editor: {error}"));
                FALSE
            }
        }
    }

    fn remove(&self) {
        self.parent.store(ptr::null_mut(), Ordering::Release);
        let editor = self.editor.borrow_mut().take();
        drop(editor);
    }

    fn resize(&self, rect: ViewRect) {
        let geometry = self.update(|geometry| geometry.size = to_size(rect, geometry.scale));
        if let Some(editor) = self.editor.borrow().as_ref()
            && let Err(error) = editor.set_size(geometry.size)
        {
            log(&format!("could not resize the editor: {error}"));
        }
    }

    fn set_scale(&self, scale: f64) {
        let before = self.geometry();
        let after = self.update(|geometry| geometry.scale = scale);
        if let Some(editor) = self.editor.borrow().as_ref()
            && let Err(error) = editor.set_scale_factor(scale)
        {
            log(&format!("could not rescale the editor: {error}"));
        }
        // The size in points stays; ask the host for the pixels it now
        // needs. The host answers with `onSize`.
        let mut rect = to_rect(after.size, after.scale);
        let frame = self.frame.load(Ordering::Acquire);
        if rect != to_rect(before.size, before.scale) && !frame.is_null() {
            let resize_view = unsafe { vtbl::<IPlugFrameVtbl>(frame) }.resize_view;
            let view = ptr::from_ref(self).cast_mut().cast();
            unsafe { resize_view(frame, view, &mut rect) };
        }
    }
}

/// View pixels per point: Windows hosts size views in physical pixels,
/// macOS hosts in points.
fn pixels_per_point(scale: f64) -> f64 {
    if cfg!(windows) { scale } else { 1.0 }
}

/// The host rect for `size` points at display scale `scale`.
pub fn to_rect(size: LogicalSize<f64>, scale: f64) -> ViewRect {
    let pixels = pixels_per_point(scale);
    ViewRect {
        left: 0,
        top: 0,
        right: (size.width * pixels).round() as i32,
        bottom: (size.height * pixels).round() as i32,
    }
}

/// The size in points of a host rect at display scale `scale`.
pub fn to_size(rect: ViewRect, scale: f64) -> LogicalSize<f64> {
    let pixels = pixels_per_point(scale);
    LogicalSize::new(
        f64::from(rect.width()) / pixels,
        f64::from(rect.height()) / pixels,
    )
}

/// Clamps `rect` to at least [`zvid_daw_ui::MIN_SIZE`] at display scale `scale`,
/// keeping its origin.
pub fn constrain(rect: ViewRect, scale: f64) -> ViewRect {
    let min = to_rect(zvid_daw_ui::editor::constrain(to_size(rect, scale)), scale);
    ViewRect {
        right: rect.left + rect.width().max(min.width()),
        bottom: rect.top + rect.height().max(min.height()),
        ..rect
    }
}

/// The editor's parent for an `HWND` `attached` accepted.
#[cfg(windows)]
fn parent_window(parent: *mut c_void) -> Option<ParentWindow> {
    std::num::NonZeroIsize::new(parent as isize).map(ParentWindow::Win32)
}

/// The editor's parent for an `NSView` `attached` accepted.
#[cfg(target_os = "macos")]
fn parent_window(parent: *mut c_void) -> Option<ParentWindow> {
    ptr::NonNull::new(parent).map(ParentWindow::AppKit)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn parent_window(_parent: *mut c_void) -> Option<ParentWindow> {
    None
}

unsafe fn supported(kind: FIDString) -> bool {
    PLATFORM_TYPE.is_some_and(|platform| unsafe { fid_eq(kind, platform) })
}

unsafe fn this<'a, const OFFSET: usize>(this: *mut c_void) -> &'a View {
    unsafe { &*this.byte_sub(OFFSET).cast::<View>() }
}

static VIEW_VTBL: IPlugViewVtbl = IPlugViewVtbl {
    unknown: FUnknownVtbl {
        query_interface: view_query_interface::<VIEW>,
        add_ref: view_add_ref::<VIEW>,
        release: view_release::<VIEW>,
    },
    is_platform_type_supported: view_is_platform_type_supported,
    attached: view_attached,
    removed: view_removed,
    on_wheel: view_on_wheel,
    on_key_down: view_on_key,
    on_key_up: view_on_key,
    get_size: view_get_size,
    on_size: view_on_size,
    on_focus: view_on_focus,
    set_frame: view_set_frame,
    can_resize: view_can_resize,
    check_size_constraint: view_check_size_constraint,
};

static SCALE_VTBL: IPlugViewContentScaleSupportVtbl = IPlugViewContentScaleSupportVtbl {
    unknown: FUnknownVtbl {
        query_interface: view_query_interface::<SCALE>,
        add_ref: view_add_ref::<SCALE>,
        release: view_release::<SCALE>,
    },
    set_content_scale_factor: view_set_content_scale_factor,
};

unsafe extern "system" fn view_query_interface<const OFFSET: usize>(
    this_: *mut c_void,
    iid: *const Tuid,
    obj: *mut *mut c_void,
) -> TResult {
    if obj.is_null() {
        return INVALID_ARGUMENT;
    }
    let offset = match unsafe { read_tuid(iid.cast()) } {
        Some(FUNKNOWN_IID | IPLUG_VIEW_IID) => VIEW,
        Some(IPLUG_VIEW_CONTENT_SCALE_SUPPORT_IID) => SCALE,
        _ => {
            unsafe { *obj = ptr::null_mut() };
            return NO_INTERFACE;
        }
    };
    let view = unsafe { this::<OFFSET>(this_) };
    view.refs.fetch_add(1, Ordering::Relaxed);
    unsafe { *obj = ptr::from_ref(view).byte_add(offset).cast_mut().cast() };
    OK
}

unsafe extern "system" fn view_add_ref<const OFFSET: usize>(this_: *mut c_void) -> u32 {
    unsafe { this::<OFFSET>(this_) }
        .refs
        .fetch_add(1, Ordering::Relaxed)
        + 1
}

unsafe extern "system" fn view_release<const OFFSET: usize>(this_: *mut c_void) -> u32 {
    let view = unsafe { this::<OFFSET>(this_) };
    let remaining = view.refs.fetch_sub(1, Ordering::Release) - 1;
    if remaining == 0 {
        fence(Ordering::Acquire);
        drop(unsafe { Box::from_raw(ptr::from_ref(view).cast_mut()) });
    }
    remaining
}

unsafe extern "system" fn view_is_platform_type_supported(
    _this: *mut c_void,
    kind: FIDString,
) -> TResult {
    if unsafe { supported(kind) } {
        OK
    } else {
        FALSE
    }
}

unsafe extern "system" fn view_attached(
    this_: *mut c_void,
    parent: *mut c_void,
    kind: FIDString,
) -> TResult {
    if parent.is_null() || !unsafe { supported(kind) } {
        return FALSE;
    }
    unsafe { this::<VIEW>(this_) }.attach(parent)
}

unsafe extern "system" fn view_removed(this_: *mut c_void) -> TResult {
    unsafe { this::<VIEW>(this_) }.remove();
    OK
}

unsafe extern "system" fn view_on_wheel(_this: *mut c_void, _distance: f32) -> TResult {
    FALSE
}

unsafe extern "system" fn view_on_key(
    _this: *mut c_void,
    _key: u16,
    _key_code: i16,
    _modifiers: i16,
) -> TResult {
    FALSE
}

unsafe extern "system" fn view_get_size(this_: *mut c_void, size: *mut ViewRect) -> TResult {
    let Some(size) = (unsafe { size.as_mut() }) else {
        return INVALID_ARGUMENT;
    };
    let geometry = unsafe { this::<VIEW>(this_) }.geometry();
    *size = to_rect(geometry.size, geometry.scale);
    OK
}

unsafe extern "system" fn view_on_size(this_: *mut c_void, size: *mut ViewRect) -> TResult {
    let Some(size) = (unsafe { size.as_ref() }) else {
        return INVALID_ARGUMENT;
    };
    unsafe { this::<VIEW>(this_) }.resize(*size);
    OK
}

unsafe extern "system" fn view_on_focus(_this: *mut c_void, _state: TBool) -> TResult {
    OK
}

unsafe extern "system" fn view_set_frame(this_: *mut c_void, frame: *mut c_void) -> TResult {
    unsafe { this::<VIEW>(this_) }
        .frame
        .store(frame, Ordering::Release);
    OK
}

unsafe extern "system" fn view_can_resize(_this: *mut c_void) -> TResult {
    OK
}

unsafe extern "system" fn view_check_size_constraint(
    this_: *mut c_void,
    rect: *mut ViewRect,
) -> TResult {
    let Some(rect) = (unsafe { rect.as_mut() }) else {
        return INVALID_ARGUMENT;
    };
    *rect = constrain(*rect, unsafe { this::<VIEW>(this_) }.geometry().scale);
    OK
}

unsafe extern "system" fn view_set_content_scale_factor(
    this_: *mut c_void,
    factor: f32,
) -> TResult {
    if !factor.is_finite() || factor <= 0.0 {
        return INVALID_ARGUMENT;
    }
    unsafe { this::<SCALE>(this_) }.set_scale(f64::from(factor));
    OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;
    use zvid_daw_core::State;
    use zvid_daw_ui::MIN_SIZE;
    use zvid_daw_ui::mock::MockBackend;

    fn create() -> *mut View {
        View::create(Arc::new(MockBackend::for_plugin(State::default())))
    }

    unsafe fn view_vtbl(view: *mut View) -> &'static IPlugViewVtbl {
        unsafe { vtbl::<IPlugViewVtbl>(view.cast()) }
    }

    /// The host rect for a size given in points at `scale`.
    fn pixels(width: f64, height: f64, scale: f64) -> (i32, i32) {
        let rect = to_rect(LogicalSize::new(width, height), scale);
        (rect.width(), rect.height())
    }

    /// Records `IPlugFrame::resizeView` calls.
    #[repr(C)]
    struct Frame {
        vtbl: &'static IPlugFrameVtbl,
        view: *mut c_void,
        resized: Option<ViewRect>,
    }

    unsafe extern "system" fn frame_query_interface(
        _this: *mut c_void,
        _iid: *const Tuid,
        _obj: *mut *mut c_void,
    ) -> TResult {
        NO_INTERFACE
    }

    unsafe extern "system" fn frame_ref(_this: *mut c_void) -> u32 {
        1
    }

    unsafe extern "system" fn frame_resize_view(
        this_: *mut c_void,
        view: *mut c_void,
        new_size: *mut ViewRect,
    ) -> TResult {
        let frame = unsafe { &mut *this_.cast::<Frame>() };
        frame.view = view;
        frame.resized = Some(unsafe { *new_size });
        // Like a host: resize the view to what it asked for.
        unsafe { (vtbl::<IPlugViewVtbl>(view).on_size)(view, new_size) }
    }

    static FRAME_VTBL: IPlugFrameVtbl = IPlugFrameVtbl {
        unknown: FUnknownVtbl {
            query_interface: frame_query_interface,
            add_ref: frame_ref,
            release: frame_ref,
        },
        resize_view: frame_resize_view,
    };

    #[test]
    fn tracks_size() {
        let view = create();
        unsafe {
            let v = view_vtbl(view);
            let this_ = view.cast::<c_void>();
            let mut rect = ViewRect::default();
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!((rect.width(), rect.height()), pixels(680.0, 760.0, 1.0));
            assert_eq!((v.can_resize)(this_), OK);

            let mut small = ViewRect {
                left: 10,
                top: 20,
                right: 30,
                bottom: 40,
            };
            assert_eq!((v.check_size_constraint)(this_, &mut small), OK);
            assert_eq!(
                small,
                ViewRect {
                    left: 10,
                    top: 20,
                    right: 10 + MIN_SIZE.width as i32,
                    bottom: 20 + MIN_SIZE.height as i32,
                }
            );
            let mut big = ViewRect {
                left: 0,
                top: 0,
                right: 1000,
                bottom: 700,
            };
            assert_eq!((v.check_size_constraint)(this_, &mut big), OK);
            assert_eq!((big.width(), big.height()), (1000, 700));
            assert_eq!((v.on_size)(this_, &mut big), OK);
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!(rect, big);
            assert!(!(*view).has_editor());
            assert_eq!((v.unknown.release)(this_), 0);
        }
    }

    #[test]
    fn follows_the_content_scale() {
        let view = create();
        unsafe {
            let v = view_vtbl(view);
            let this_ = view.cast::<c_void>();
            let mut frame = Frame {
                vtbl: &FRAME_VTBL,
                view: ptr::null_mut(),
                resized: None,
            };
            let frame_ptr = ptr::from_mut(&mut frame).cast::<c_void>();
            assert_eq!((v.set_frame)(this_, frame_ptr), OK);

            let mut scale = ptr::null_mut();
            assert_eq!(
                (v.unknown.query_interface)(
                    this_,
                    &IPLUG_VIEW_CONTENT_SCALE_SUPPORT_IID,
                    &mut scale
                ),
                OK
            );
            assert!(!scale.is_null());
            assert_ne!(scale, this_);
            let s = vtbl::<IPlugViewContentScaleSupportVtbl>(scale);
            assert_eq!((s.set_content_scale_factor)(scale, 0.0), INVALID_ARGUMENT);
            assert_eq!((s.set_content_scale_factor)(scale, f32::NAN), INVALID_ARGUMENT);
            assert_eq!((s.set_content_scale_factor)(scale, 1.5), OK);

            let expected = to_rect(DEFAULT_SIZE, 1.5);
            if cfg!(windows) {
                assert_eq!((expected.width(), expected.height()), (1020, 1140));
                assert_eq!(frame.resized, Some(expected));
                assert_eq!(frame.view, this_);
            } else {
                // macOS hosts size views in points, so nothing changes.
                assert_eq!(frame.resized, None);
            }
            let mut rect = ViewRect::default();
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!(rect, expected);

            // The minimum is in points too.
            let mut small = ViewRect::default();
            assert_eq!((v.check_size_constraint)(this_, &mut small), OK);
            assert_eq!(small, to_rect(MIN_SIZE, 1.5));

            // Going back to 1x keeps the size in points.
            frame.resized = None;
            assert_eq!((s.set_content_scale_factor)(scale, 1.0), OK);
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!(rect, to_rect(DEFAULT_SIZE, 1.0));

            assert_eq!((s.unknown.release)(scale), 1);
            assert_eq!((v.unknown.release)(this_), 0);
        }
    }

    #[test]
    fn converts_sizes_for_the_platform() {
        let size = LogicalSize::new(600.0, 700.0);
        let rect = to_rect(size, 2.0);
        if cfg!(windows) {
            assert_eq!((rect.width(), rect.height()), (1200, 1400));
        } else {
            assert_eq!((rect.width(), rect.height()), (600, 700));
        }
        assert_eq!(to_size(rect, 2.0), size);
    }

    #[test]
    fn rejects_foreign_parents_and_interfaces() {
        let view = create();
        unsafe {
            let v = view_vtbl(view);
            let this_ = view.cast::<c_void>();
            let bogus = CString::new("X11EmbedWindowID").unwrap();
            assert_eq!((v.is_platform_type_supported)(this_, bogus.as_ptr()), FALSE);
            let mut parent = 0u8;
            let parent = ptr::from_mut(&mut parent).cast::<c_void>();
            assert_eq!((v.attached)(this_, parent, bogus.as_ptr()), FALSE);
            if let Some(platform) = PLATFORM_TYPE {
                let platform = CString::new(platform).unwrap();
                assert_eq!((v.is_platform_type_supported)(this_, platform.as_ptr()), OK);
                assert_eq!(
                    (v.attached)(this_, ptr::null_mut(), platform.as_ptr()),
                    FALSE
                );
            }
            assert_eq!((*view).parent(), None);
            assert!(!(*view).has_editor());
            assert_eq!((v.removed)(this_), OK);
            assert_eq!((*view).parent(), None);

            let mut other = ptr::null_mut();
            assert_eq!(
                (v.unknown.query_interface)(this_, &IPLUG_VIEW_IID, &mut other),
                OK
            );
            assert_eq!(other, this_);
            assert_eq!((v.unknown.release)(this_), 1);
            assert_eq!(
                (v.unknown.query_interface)(this_, &IEDIT_CONTROLLER_IID, &mut other),
                NO_INTERFACE
            );
            assert!(other.is_null());
            assert_eq!((v.unknown.release)(this_), 0);
        }
    }
}
