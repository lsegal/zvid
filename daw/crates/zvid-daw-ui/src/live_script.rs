//! Installs the Live companion Remote Script from the plugin bundle, for the
//! editor's *Install Live companion* button.
//!
//! `cargo xtask bundle` copies `live-remote-script/ZVID_Capture` into each
//! bundle's `Contents/Resources`, so an installed plugin always carries the
//! script that matches it. Installing copies that folder into
//! `<User Library>/Remote Scripts/ZVID_Capture`, the same place
//! `cargo xtask install-live-script` uses, replacing any older copy. The
//! User Library is the one Live's newest `Library.cfg` names, or Live's
//! default location when there is none.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Folder name of the Remote Script, which Live shows as the Control
/// Surface name.
pub const SCRIPT_NAME: &str = "ZVID_Capture";
/// Entries of the Remote Script folder that Live does not need.
const SKIPPED: &[&str] = &["tests", "__pycache__"];

/// Copies the script bundled with the running plugin into Live's User
/// Library and returns where it went.
pub fn install_bundled() -> io::Result<PathBuf> {
    let source = plugin_module()
        .and_then(|module| bundled_script(&module))
        .filter(|script| script.join("__init__.py").is_file())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "this copy of ZVID Capture doesn't include the Live companion script",
            )
        })?;
    let os = std::env::consts::OS;
    let var = |name: &str| std::env::var_os(name);
    let user_library = live_preferences(os, var)
        .and_then(|preferences| configured_user_library(&preferences))
        .map_or_else(|| default_user_library(os, var), Ok)?;
    if !user_library.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Live's User Library isn't at {}; open Live once, then try again",
                user_library.display()
            ),
        ));
    }
    install(&source, &user_library)
}

/// The Remote Script inside the bundle holding the plugin binary `module`.
/// Both layouts keep the binary one folder below `Contents`:
/// `Contents/MacOS/<binary>` on macOS and `Contents/x86_64-win/<binary>` on
/// Windows.
pub fn bundled_script(module: &Path) -> Option<PathBuf> {
    let contents = module.parent()?.parent()?;
    Some(contents.join("Resources").join(SCRIPT_NAME))
}

/// Copies the Remote Script folder `source` into
/// `<user_library>/Remote Scripts`, replacing any older copy and leaving out
/// tests and Python caches, and returns the installed folder.
pub fn install(source: &Path, user_library: &Path) -> io::Result<PathBuf> {
    let scripts = user_library.join("Remote Scripts");
    let destination = scripts.join(SCRIPT_NAME);
    // Copy next to the old script first, so a failed copy leaves it alone.
    let staging = scripts.join(format!(".{SCRIPT_NAME}.installing"));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    if let Err(error) = copy_tree(source, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if destination.exists() {
        fs::remove_dir_all(&destination)?;
    }
    fs::rename(&staging, &destination)?;
    Ok(destination)
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let skipped = name
            .to_str()
            .is_some_and(|name| SKIPPED.contains(&name) || name.ends_with(".pyc"));
        if skipped {
            continue;
        }
        let path = entry.path();
        let target = destination.join(&name);
        if path.is_dir() {
            copy_tree(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// The folder holding Live's per-version preference folders
/// (`Live 12.0.25/Preferences`) on `os`, with the home directory looked up
/// through `var`.
pub fn live_preferences(
    os: &str,
    var: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    let (base, rest): (&str, &[&str]) = match os {
        "macos" => ("HOME", &["Library", "Preferences", "Ableton"]),
        "windows" => ("APPDATA", &["Ableton"]),
        _ => return None,
    };
    let mut path = PathBuf::from(var(base).filter(|value| !value.is_empty())?);
    path.extend(rest);
    Some(path)
}

/// The User Library named by the most recently written `Library.cfg` under
/// `preferences`: the newest Live that ran knows where the user keeps it.
pub fn configured_user_library(preferences: &Path) -> Option<PathBuf> {
    let newest = fs::read_dir(preferences)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("Live "))
        .filter_map(|entry| {
            let config = entry.path().join("Preferences").join("Library.cfg");
            let modified = fs::metadata(&config).and_then(|m| m.modified()).ok()?;
            Some((modified, config))
        })
        .max_by_key(|(modified, _): &(SystemTime, PathBuf)| *modified)?;
    user_library_from_config(&fs::read_to_string(newest.1).ok()?)
}

/// The User Library a `Library.cfg` names: its `UserLibrary` project's
/// `ProjectPath` joined with its `ProjectName`.
pub fn user_library_from_config(xml: &str) -> Option<PathBuf> {
    let start = xml.find("<UserLibrary>")?;
    let end = start + xml[start..].find("</UserLibrary>")?;
    let section = &xml[start..end];
    let path = element_value(section, "ProjectPath")?;
    let name = element_value(section, "ProjectName")?;
    if path.is_empty() || name.is_empty() {
        return None;
    }
    Some(PathBuf::from(path).join(name))
}

/// The unescaped `Value` attribute of the first `<tag Value="…" />`.
fn element_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag} Value=\"");
    let start = xml.find(&open)? + open.len();
    let end = start + xml[start..].find('"')?;
    Some(unescape(&xml[start..end]))
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Live's default User Library on `os`, with the home directory looked up
/// through `var`.
pub fn default_user_library(
    os: &str,
    var: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> io::Result<PathBuf> {
    let (home, rest): (&str, &[&str]) = match os {
        "macos" => ("HOME", &["Music", "Ableton", "User Library"]),
        "windows" => ("USERPROFILE", &["Documents", "Ableton", "User Library"]),
        other => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("Live does not run on {other}"),
            ));
        }
    };
    let mut path = var(home)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("{home} is not set")))?;
    path.extend(rest);
    Ok(path)
}

/// The file the running plugin's code was loaded from: the plugin binary
/// inside the host, or the test executable under `cargo test`.
pub fn plugin_module() -> Option<PathBuf> {
    platform::module_of(plugin_module as *const ())
}

#[cfg(windows)]
mod platform {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;

    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        GetModuleFileNameW, GetModuleHandleExW,
    };
    use windows::core::PCWSTR;

    pub fn module_of(address: *const ()) -> Option<PathBuf> {
        let mut module = HMODULE::default();
        let mut buffer = vec![0u16; 32_768];
        // SAFETY: with FROM_ADDRESS the name argument is an address inside
        // the module, not a string; UNCHANGED_REFCOUNT means there is no
        // handle to release. The buffer outlives the call.
        let len = unsafe {
            GetModuleHandleExW(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                    | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                PCWSTR(address.cast()),
                &mut module,
            )
            .ok()?;
            GetModuleFileNameW(Some(module), &mut buffer)
        } as usize;
        if len == 0 || len >= buffer.len() {
            return None;
        }
        Some(PathBuf::from(OsString::from_wide(&buffer[..len])))
    }
}

#[cfg(unix)]
mod platform {
    use std::ffi::{CStr, OsStr};
    use std::os::unix::ffi::OsStrExt;
    use std::path::PathBuf;

    pub fn module_of(address: *const ()) -> Option<PathBuf> {
        // SAFETY: `dladdr` only reads the address and fills `info`, whose
        // file name points into the loader's own storage for the module.
        unsafe {
            let mut info: libc::Dl_info = std::mem::zeroed();
            if libc::dladdr(address.cast(), &mut info) == 0 || info.dli_fname.is_null() {
                return None;
            }
            let name = CStr::from_ptr(info.dli_fname).to_bytes();
            Some(PathBuf::from(OsStr::from_bytes(name)))
        }
    }
}

#[cfg(not(any(windows, unix)))]
mod platform {
    use std::path::PathBuf;

    pub fn module_of(_address: *const ()) -> Option<PathBuf> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "zvid-daw-ui-live-script-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const LIBRARY_CFG: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0.25">
	<ContentLibrary>
		<UserLibrary>
			<LibraryProject Id="0">
				<ProjectLocation />
				<ProjectName Value="User Library" />
				<ProjectPath Value="D:/Music &amp; Sets/Ableton" />
			</LibraryProject>
		</UserLibrary>
		<DefaultTemplateSet Value="C:/Users/me/Documents/Ableton/User Library/Templates/Untitled.als" />
	</ContentLibrary>
</Ableton>
"#;

    #[test]
    fn finds_the_script_in_either_bundle_layout() {
        assert_eq!(
            bundled_script(Path::new(
                "/Library/Audio/Plug-Ins/VST3/ZVID Capture.vst3/Contents/MacOS/ZVID Capture"
            )),
            Some(PathBuf::from(
                "/Library/Audio/Plug-Ins/VST3/ZVID Capture.vst3/Contents/Resources/ZVID_Capture"
            ))
        );
        let windows = Path::new("VST3")
            .join("ZVID Capture.vst3")
            .join("Contents")
            .join("x86_64-win")
            .join("ZVID Capture.vst3");
        assert_eq!(
            bundled_script(&windows),
            Some(
                Path::new("VST3")
                    .join("ZVID Capture.vst3")
                    .join("Contents")
                    .join("Resources")
                    .join(SCRIPT_NAME)
            )
        );
        assert_eq!(bundled_script(Path::new("plugin")), None);
    }

    #[test]
    fn reads_the_user_library_from_library_cfg() {
        assert_eq!(
            user_library_from_config(LIBRARY_CFG),
            Some(PathBuf::from("D:/Music & Sets/Ableton").join("User Library"))
        );
        assert_eq!(user_library_from_config("<Ableton />"), None);
        assert_eq!(
            user_library_from_config(
                "<UserLibrary><ProjectName Value=\"\" /><ProjectPath Value=\"/x\" /></UserLibrary>"
            ),
            None
        );
    }

    #[test]
    fn prefers_the_newest_live_library_cfg() {
        let dir = scratch("preferences");
        let write = |version: &str, path: &str| {
            let preferences = dir.join(format!("Live {version}")).join("Preferences");
            fs::create_dir_all(&preferences).unwrap();
            let config = LIBRARY_CFG.replace("D:/Music &amp; Sets/Ableton", path);
            fs::write(preferences.join("Library.cfg"), config).unwrap();
        };
        write("11.3.42", "/old");
        std::thread::sleep(std::time::Duration::from_millis(50));
        write("12.0.25", "/new");
        fs::create_dir_all(dir.join("Live Reports")).unwrap();
        assert_eq!(
            configured_user_library(&dir),
            Some(Path::new("/new").join("User Library"))
        );
        assert_eq!(configured_user_library(&dir.join("missing")), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn locates_live_folders_per_os() {
        let var = |name: &str| match name {
            "HOME" => Some("/Users/me".into()),
            "APPDATA" => Some(r"C:\Users\me\AppData\Roaming".into()),
            "USERPROFILE" => Some(r"C:\Users\me".into()),
            _ => None,
        };
        assert_eq!(
            live_preferences("macos", var),
            Some(Path::new("/Users/me").join("Library/Preferences/Ableton"))
        );
        assert_eq!(
            live_preferences("windows", var),
            Some(Path::new(r"C:\Users\me\AppData\Roaming").join("Ableton"))
        );
        assert_eq!(live_preferences("linux", var), None);
        assert_eq!(
            default_user_library("macos", var).unwrap(),
            Path::new("/Users/me").join("Music/Ableton/User Library")
        );
        assert_eq!(
            default_user_library("windows", var).unwrap(),
            Path::new(r"C:\Users\me").join("Documents/Ableton/User Library")
        );
        assert!(default_user_library("linux", var).is_err());
        assert!(default_user_library("macos", |_| None).is_err());
    }

    #[test]
    fn installs_and_replaces_the_script() {
        let dir = scratch("install");
        let source = dir.join("bundle").join(SCRIPT_NAME);
        fs::create_dir_all(source.join("tests")).unwrap();
        fs::create_dir_all(source.join("__pycache__")).unwrap();
        fs::write(source.join("__init__.py"), "# new").unwrap();
        fs::write(source.join("companion.py"), "# companion").unwrap();
        fs::write(source.join("companion.pyc"), "").unwrap();
        fs::write(source.join("tests").join("test_companion.py"), "").unwrap();
        let library = dir.join("User Library");
        let old = library.join("Remote Scripts").join(SCRIPT_NAME);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("__init__.py"), "# old").unwrap();
        fs::write(old.join("stale.py"), "").unwrap();

        let installed = install(&source, &library).unwrap();

        assert_eq!(installed, old);
        assert_eq!(
            fs::read_to_string(installed.join("__init__.py")).unwrap(),
            "# new"
        );
        assert!(installed.join("companion.py").is_file());
        assert!(!installed.join("stale.py").exists());
        assert!(!installed.join("companion.pyc").exists());
        assert!(!installed.join("tests").exists());
        assert!(!installed.join("__pycache__").exists());
        let entries: Vec<_> = fs::read_dir(library.join("Remote Scripts"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, [SCRIPT_NAME]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_install_keeps_the_old_script() {
        let dir = scratch("failed");
        let library = dir.join("User Library");
        let old = library.join("Remote Scripts").join(SCRIPT_NAME);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("__init__.py"), "# old").unwrap();

        assert!(install(&dir.join("missing"), &library).is_err());

        assert_eq!(fs::read_to_string(old.join("__init__.py")).unwrap(), "# old");
        assert!(!library.join("Remote Scripts").join(".ZVID_Capture.installing").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finds_the_module_holding_this_code() {
        let module = plugin_module().expect("the test binary is a module");
        assert!(module.is_file(), "{}", module.display());
    }
}
