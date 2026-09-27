//! Operating-system actions the editor triggers: revealing a take in Finder
//! or Explorer, opening the camera privacy settings, and installing the Live
//! companion script.

use std::io;
use std::path::{Path, PathBuf};

/// Desktop integration, swappable so tests don't open real windows.
pub trait Desktop: Send + Sync + 'static {
    /// Opens the folder holding `path` with the file selected.
    fn reveal(&self, path: &Path) -> io::Result<()>;
    /// Opens the system's camera privacy settings.
    fn open_camera_privacy_settings(&self) -> io::Result<()>;
    /// Copies the Live companion script bundled with the plugin into Live's
    /// User Library and returns where it went.
    fn install_live_script(&self) -> io::Result<PathBuf>;
}

/// The real [`Desktop`] for the running platform.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemDesktop;

impl Desktop for SystemDesktop {
    fn reveal(&self, path: &Path) -> io::Result<()> {
        platform::reveal(path)
    }

    fn open_camera_privacy_settings(&self) -> io::Result<()> {
        platform::open_camera_privacy_settings()
    }

    fn install_live_script(&self) -> io::Result<PathBuf> {
        crate::live_script::install_bundled()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::io;
    use std::path::Path;

    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};

    const CAMERA_PRIVACY: &str =
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";

    pub fn reveal(path: &Path) -> io::Result<()> {
        let path = path
            .to_str()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path is not UTF-8"))?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let urls = NSArray::from_retained_slice(&[url]);
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
        Ok(())
    }

    pub fn open_camera_privacy_settings() -> io::Result<()> {
        let url = NSURL::URLWithString(&NSString::from_str(CAMERA_PRIVACY))
            .ok_or_else(|| io::Error::other("invalid settings URL"))?;
        if NSWorkspace::sharedWorkspace().openURL(&url) {
            Ok(())
        } else {
            Err(io::Error::other("System Settings didn't open"))
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};
    use windows::core::PCWSTR;

    pub fn reveal(path: &Path) -> io::Result<()> {
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: `wide` is a NUL-terminated path that outlives the calls;
        // the item list is freed exactly once, and COM is uninitialized only
        // when this call initialized it.
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let item = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
            let result = if item.is_null() {
                Err(io::Error::new(io::ErrorKind::NotFound, "no such file"))
            } else {
                let opened = SHOpenFolderAndSelectItems(item, None, 0)
                    .map_err(|error| io::Error::other(error.message()));
                ILFree(Some(item));
                opened
            };
            if initialized {
                CoUninitialize();
            }
            result
        }
    }

    pub fn open_camera_privacy_settings() -> io::Result<()> {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:privacy-webcam")
            .spawn()
            .map(drop)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use std::io;
    use std::path::Path;

    pub fn reveal(path: &Path) -> io::Result<()> {
        let folder = path.parent().unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map(drop)
    }

    pub fn open_camera_privacy_settings() -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "no camera privacy settings on this platform",
        ))
    }
}
