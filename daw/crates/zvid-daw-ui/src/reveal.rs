//! Reveals a take in Finder or Explorer with the file selected.

use std::io;
use std::path::Path;

/// Opens the folder holding `path` and selects the file.
pub fn reveal(path: &Path) -> io::Result<()> {
    platform::reveal(path)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::io;
    use std::path::Path;

    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};

    pub fn reveal(path: &Path) -> io::Result<()> {
        let path = path
            .to_str()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path is not UTF-8"))?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let urls = NSArray::from_retained_slice(&[url]);
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
        Ok(())
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
}
