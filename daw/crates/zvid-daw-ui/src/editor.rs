//! The plugin editor: a wry child webview inside the host's plugin window.
//!
//! The plugin-format layers create an [`Editor`] when the host attaches the
//! view (`IPlugView::attached`, or the AU view factory) and drop it when the
//! host removes it. Each plugin instance owns its own editor; the webview
//! data directory and the poster cache are shared by every editor in the
//! process and freed with the last one.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::num::NonZeroIsize;
use std::path::PathBuf;
use std::ptr::NonNull;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use raw_window_handle::{
    AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, Win32WindowHandle,
    WindowHandle,
};
use wry::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use wry::{Rect, WebContext, WebView, WebViewBuilder};

use crate::backend::Backend;
use crate::desktop::SystemDesktop;
use crate::protocol::{PosterCache, Protocol, SCHEME, origin};

/// Default editor size in points, from the design spec.
pub const DEFAULT_SIZE: LogicalSize<f64> = LogicalSize::new(680.0, 760.0);
/// Smallest size the editor can be resized to, in points.
pub const MIN_SIZE: LogicalSize<f64> = LogicalSize::new(560.0, 620.0);
/// Window background, matching `--bg`, shown before the page paints.
const BACKGROUND: (u8, u8, u8, u8) = (0x26, 0x28, 0x39, 0xFF);

/// Clamps a requested size to [`MIN_SIZE`].
pub fn constrain(size: LogicalSize<f64>) -> LogicalSize<f64> {
    LogicalSize::new(
        size.width.max(MIN_SIZE.width),
        size.height.max(MIN_SIZE.height),
    )
}

/// The host-provided parent view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParentWindow {
    /// An `HWND` (VST3 `kPlatformTypeHWND`).
    Win32(NonZeroIsize),
    /// An `NSView*` (VST3 `kPlatformTypeNSView`, or the AU view).
    AppKit(NonNull<c_void>),
}

impl HasWindowHandle for ParentWindow {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw = match *self {
            Self::Win32(hwnd) => RawWindowHandle::Win32(Win32WindowHandle::new(hwnd)),
            Self::AppKit(view) => RawWindowHandle::AppKit(AppKitWindowHandle::new(view)),
        };
        // SAFETY: `Editor::attach`'s contract keeps the parent alive while
        // the editor exists.
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

/// How an editor is set up.
#[derive(Clone, Debug)]
pub struct EditorOptions {
    /// Load the UI from a dev server (Vite HMR) instead of `zvid://app/`.
    pub dev_url: Option<String>,
    /// Allow the web inspector.
    pub devtools: bool,
    /// Version string shown in the footer.
    pub version: String,
}

impl Default for EditorOptions {
    fn default() -> Self {
        Self {
            dev_url: None,
            devtools: cfg!(debug_assertions),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// Process-wide resources shared by every open editor.
struct Shared {
    web_context: RefCell<WebContext>,
    posters: Arc<PosterCache>,
}

thread_local! {
    // Editors are created and dropped on the host's UI thread.
    static SHARED: RefCell<Weak<Shared>> = const { RefCell::new(Weak::new()) };
}

impl Shared {
    fn acquire() -> Rc<Self> {
        SHARED.with(|slot| {
            if let Some(shared) = slot.borrow().upgrade() {
                return shared;
            }
            let shared = Rc::new(Self {
                web_context: RefCell::new(WebContext::new(webview_data_dir())),
                posters: Arc::default(),
            });
            *slot.borrow_mut() = Rc::downgrade(&shared);
            shared
        })
    }
}

/// WebView2 needs a writable user data folder; the plugin's install folder
/// often isn't. Other platforms keep the webview's default.
fn webview_data_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        dirs::data_local_dir().map(|dir| dir.join("ZVID").join("WebView2"))
    } else {
        None
    }
}

/// The script run before the page loads; it tells the frontend where the
/// `zvid://` routes are on this platform.
pub fn bootstrap_script(options: &EditorOptions) -> String {
    let origins: serde_json::Map<String, serde_json::Value> =
        ["app", "ipc", "preview", "take", "thumb"]
            .into_iter()
            .map(|host| (host.to_string(), origin(host).into()))
            .collect();
    let config = serde_json::json!({
        "origins": origins,
        "version": options.version,
        "platform": std::env::consts::OS,
    });
    format!("window.__ZVID__ = Object.freeze({config});")
}

/// The webview's bounds for a size in points at a display scale factor.
/// Windows child windows are positioned in physical pixels, AppKit views in
/// points.
pub fn child_bounds(size: LogicalSize<f64>, scale: f64) -> Rect {
    if cfg!(windows) {
        let physical: PhysicalSize<u32> = size.to_physical(scale);
        Rect {
            position: PhysicalPosition::new(0, 0).into(),
            size: physical.into(),
        }
    } else {
        Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: size.into(),
        }
    }
}

/// One open plugin editor.
pub struct Editor {
    /// Shut down in `drop`, before the webview goes, so open long-polls are
    /// answered while it still exists.
    protocol: Arc<Protocol>,
    webview: WebView,
    size: Cell<LogicalSize<f64>>,
    scale: Cell<f64>,
    _shared: Rc<Shared>,
}

impl Editor {
    /// Creates the webview as a child of `parent`, sized to `size` points at
    /// display scale `scale`.
    ///
    /// # Safety
    ///
    /// `parent` must be a valid view that outlives the editor, and this
    /// must be called on the thread that owns it (the host's UI thread).
    pub unsafe fn attach(
        parent: ParentWindow,
        size: LogicalSize<f64>,
        scale: f64,
        backend: Arc<dyn Backend>,
        options: EditorOptions,
    ) -> wry::Result<Self> {
        let shared = Shared::acquire();
        let protocol = Arc::new(Protocol::new(
            backend,
            shared.posters.clone(),
            Arc::new(SystemDesktop),
        ));
        let size = constrain(size);
        let scale = if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        };

        let app_origin = origin("app");
        let start_url = options
            .dev_url
            .clone()
            .unwrap_or_else(|| format!("{app_origin}/"));
        let dev_origin = options.dev_url.clone();
        let handler = protocol.clone();

        let mut context = shared.web_context.borrow_mut();
        let builder = WebViewBuilder::new_with_web_context(&mut context)
            .with_bounds(child_bounds(size, scale))
            .with_background_color(BACKGROUND)
            .with_devtools(options.devtools)
            .with_accept_first_mouse(true)
            .with_initialization_script(bootstrap_script(&options))
            .with_asynchronous_custom_protocol(SCHEME.into(), move |_id, request, responder| {
                handler.handle(
                    request,
                    Box::new(move |response| responder.respond(response)),
                );
            })
            .with_navigation_handler(move |url| {
                url.starts_with(&app_origin)
                    || dev_origin
                        .as_deref()
                        .is_some_and(|dev| url.starts_with(dev))
            })
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
            .with_url(start_url);
        #[cfg(windows)]
        let builder = {
            use wry::WebViewBuilderExtWindows;
            builder.with_https_scheme(true)
        };
        let webview = builder.build_as_child(&parent)?;
        drop(context);

        Ok(Self {
            protocol,
            webview,
            size: Cell::new(size),
            scale: Cell::new(scale),
            _shared: shared,
        })
    }

    /// The current size in points.
    pub fn size(&self) -> LogicalSize<f64> {
        self.size.get()
    }

    /// Resizes the webview to fill a parent of `size` points. Sizes below
    /// [`MIN_SIZE`] are clamped; the returned size is what was applied.
    pub fn set_size(&self, size: LogicalSize<f64>) -> wry::Result<LogicalSize<f64>> {
        let size = constrain(size);
        self.size.set(size);
        self.webview
            .set_bounds(child_bounds(size, self.scale.get()))?;
        Ok(size)
    }

    /// Applies a new display scale factor (a DPI change, or VST3
    /// `setContentScaleFactor`).
    pub fn set_scale_factor(&self, scale: f64) -> wry::Result<()> {
        if !scale.is_finite() || scale <= 0.0 {
            return Ok(());
        }
        self.scale.set(scale);
        self.webview
            .set_bounds(child_bounds(self.size.get(), scale))
    }

    pub fn focus(&self) -> wry::Result<()> {
        self.webview.focus()
    }

    /// The underlying webview, for platform-specific tweaks.
    pub fn webview(&self) -> &WebView {
        &self.webview
    }
}

impl Drop for Editor {
    fn drop(&mut self) {
        self.protocol.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wry::dpi::{Position, Size};

    #[test]
    fn clamps_to_the_minimum_size() {
        assert_eq!(
            constrain(LogicalSize::new(100.0, 900.0)),
            LogicalSize::new(560.0, 900.0)
        );
        assert_eq!(constrain(DEFAULT_SIZE), DEFAULT_SIZE);
    }

    #[test]
    fn sizes_the_child_for_the_platform() {
        let rect = child_bounds(DEFAULT_SIZE, 1.5);
        if cfg!(windows) {
            assert_eq!(rect.size, Size::Physical(PhysicalSize::new(1020, 1140)));
            assert_eq!(
                rect.position,
                Position::Physical(PhysicalPosition::new(0, 0))
            );
        } else {
            assert_eq!(rect.size, Size::Logical(DEFAULT_SIZE));
        }
    }

    #[test]
    fn bootstraps_the_frontend() {
        let script = bootstrap_script(&EditorOptions {
            version: "9.9.9".into(),
            ..EditorOptions::default()
        });
        let json = script
            .strip_prefix("window.__ZVID__ = Object.freeze(")
            .and_then(|rest| rest.strip_suffix(");"))
            .unwrap();
        let config: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(config["version"], "9.9.9");
        assert_eq!(config["origins"]["thumb"], origin("thumb"));
        assert_eq!(config["platform"], std::env::consts::OS);
    }

    #[test]
    fn shares_resources_between_editors() {
        let first = Shared::acquire();
        let second = Shared::acquire();
        assert!(Rc::ptr_eq(&first, &second));
        assert!(Arc::ptr_eq(&first.posters, &second.posters));
        drop((first, second));
        SHARED.with(|slot| assert!(slot.borrow().upgrade().is_none()));
    }
}
