//! The editor `IPlugView`. Until the webview host (#195) lands this is a
//! placeholder: it accepts the host's parent window (`NSView` on macOS,
//! `HWND` on Windows), tracks the editor size and draws nothing.

use std::ffi::c_void;
use std::ptr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering, fence};

use crate::abi::result::{FALSE, INVALID_ARGUMENT, NO_INTERFACE, OK};
use crate::abi::*;

/// Editor size when first opened.
pub const DEFAULT_SIZE: (i32, i32) = (720, 480);
/// Smallest size the editor can be resized to.
pub const MIN_SIZE: (i32, i32) = (480, 320);

/// The parent window type this platform's hosts pass to `attached`.
#[cfg(target_os = "macos")]
const PLATFORM_TYPE: Option<&str> = Some(PLATFORM_NSVIEW);
#[cfg(windows)]
const PLATFORM_TYPE: Option<&str> = Some(PLATFORM_HWND);
#[cfg(not(any(target_os = "macos", windows)))]
const PLATFORM_TYPE: Option<&str> = None;

#[repr(C)]
pub struct View {
    vtbl: &'static IPlugViewVtbl,
    refs: AtomicU32,
    size: Mutex<ViewRect>,
    /// Host parent window while attached.
    parent: AtomicPtr<c_void>,
    /// Host `IPlugFrame`; owned by the host, so not reference-counted.
    frame: AtomicPtr<c_void>,
}

impl View {
    /// Allocates a view holding one reference.
    pub fn create() -> *mut View {
        Box::into_raw(Box::new(View {
            vtbl: &VIEW_VTBL,
            refs: AtomicU32::new(1),
            size: Mutex::new(ViewRect {
                left: 0,
                top: 0,
                right: DEFAULT_SIZE.0,
                bottom: DEFAULT_SIZE.1,
            }),
            parent: AtomicPtr::new(ptr::null_mut()),
            frame: AtomicPtr::new(ptr::null_mut()),
        }))
    }

    /// The host parent window while attached.
    pub fn parent(&self) -> Option<*mut c_void> {
        let parent = self.parent.load(Ordering::Acquire);
        (!parent.is_null()).then_some(parent)
    }

    fn size(&self) -> ViewRect {
        *self.size.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_size(&self, rect: ViewRect) {
        *self.size.lock().unwrap_or_else(|e| e.into_inner()) = rect;
    }
}

/// Clamps `rect` to at least [`MIN_SIZE`], keeping its origin.
pub fn constrain(rect: ViewRect) -> ViewRect {
    ViewRect {
        right: rect.left + rect.width().max(MIN_SIZE.0),
        bottom: rect.top + rect.height().max(MIN_SIZE.1),
        ..rect
    }
}

unsafe fn supported(kind: FIDString) -> bool {
    PLATFORM_TYPE.is_some_and(|platform| unsafe { fid_eq(kind, platform) })
}

unsafe fn this<'a>(this: *mut c_void) -> &'a View {
    unsafe { &*this.cast::<View>() }
}

static VIEW_VTBL: IPlugViewVtbl = IPlugViewVtbl {
    unknown: FUnknownVtbl {
        query_interface: view_query_interface,
        add_ref: view_add_ref,
        release: view_release,
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

unsafe extern "system" fn view_query_interface(
    this_: *mut c_void,
    iid: *const Tuid,
    obj: *mut *mut c_void,
) -> TResult {
    if obj.is_null() {
        return INVALID_ARGUMENT;
    }
    match unsafe { read_tuid(iid.cast()) } {
        Some(FUNKNOWN_IID | IPLUG_VIEW_IID) => unsafe {
            view_add_ref(this_);
            *obj = this_;
            OK
        },
        _ => {
            unsafe { *obj = ptr::null_mut() };
            NO_INTERFACE
        }
    }
}

unsafe extern "system" fn view_add_ref(this_: *mut c_void) -> u32 {
    unsafe { this(this_) }.refs.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn view_release(this_: *mut c_void) -> u32 {
    let remaining = unsafe { this(this_) }.refs.fetch_sub(1, Ordering::Release) - 1;
    if remaining == 0 {
        fence(Ordering::Acquire);
        drop(unsafe { Box::from_raw(this_.cast::<View>()) });
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
    unsafe { this(this_) }
        .parent
        .store(parent, Ordering::Release);
    OK
}

unsafe extern "system" fn view_removed(this_: *mut c_void) -> TResult {
    unsafe { this(this_) }
        .parent
        .store(ptr::null_mut(), Ordering::Release);
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
    *size = unsafe { this(this_) }.size();
    OK
}

unsafe extern "system" fn view_on_size(this_: *mut c_void, size: *mut ViewRect) -> TResult {
    let Some(size) = (unsafe { size.as_ref() }) else {
        return INVALID_ARGUMENT;
    };
    unsafe { this(this_) }.set_size(*size);
    OK
}

unsafe extern "system" fn view_on_focus(_this: *mut c_void, _state: TBool) -> TResult {
    OK
}

unsafe extern "system" fn view_set_frame(this_: *mut c_void, frame: *mut c_void) -> TResult {
    unsafe { this(this_) }.frame.store(frame, Ordering::Release);
    OK
}

unsafe extern "system" fn view_can_resize(_this: *mut c_void) -> TResult {
    OK
}

unsafe extern "system" fn view_check_size_constraint(
    _this: *mut c_void,
    rect: *mut ViewRect,
) -> TResult {
    let Some(rect) = (unsafe { rect.as_mut() }) else {
        return INVALID_ARGUMENT;
    };
    *rect = constrain(*rect);
    OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    unsafe fn view_vtbl(view: *mut View) -> &'static IPlugViewVtbl {
        unsafe { vtbl::<IPlugViewVtbl>(view.cast()) }
    }

    #[test]
    fn tracks_size_and_parent() {
        let view = View::create();
        unsafe {
            let v = view_vtbl(view);
            let this_ = view.cast::<c_void>();
            let mut rect = ViewRect::default();
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!((rect.width(), rect.height()), DEFAULT_SIZE);
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
                    right: 10 + MIN_SIZE.0,
                    bottom: 20 + MIN_SIZE.1,
                }
            );
            let mut big = ViewRect {
                left: 0,
                top: 0,
                right: 1000,
                bottom: 700,
            };
            assert_eq!((v.on_size)(this_, &mut big), OK);
            assert_eq!((v.get_size)(this_, &mut rect), OK);
            assert_eq!(rect, big);

            let bogus = CString::new("X11EmbedWindowID").unwrap();
            assert_eq!((v.is_platform_type_supported)(this_, bogus.as_ptr()), FALSE);
            let mut parent = 0u8;
            let parent = ptr::from_mut(&mut parent).cast::<c_void>();
            assert_eq!((v.attached)(this_, parent, bogus.as_ptr()), FALSE);
            if let Some(platform) = PLATFORM_TYPE {
                let platform = CString::new(platform).unwrap();
                assert_eq!((v.is_platform_type_supported)(this_, platform.as_ptr()), OK);
                assert_eq!((v.attached)(this_, parent, platform.as_ptr()), OK);
                assert_eq!((*view).parent(), Some(parent));
            }
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
