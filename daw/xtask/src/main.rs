//! Workspace tasks, run with `cargo xtask <task>`.
//!
//! - `check`: fails when C/C++/Objective-C++ sources appear under `/daw`, or
//!   when the zvidlib rev drifts from `app/export-bridge`.
//! - `bundle [--release]`: builds the plugin and lays it out as
//!   `target/bundle/ZVID Capture.vst3`, plus, on macOS, an ad-hoc signed
//!   `target/bundle/ZVID Capture.component` for `auval` and local hosts.
//!   Release signing comes later (#201).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use zvid_au::component;
use zvid_daw_core::PLUGIN_NAME;

/// Name of the plugin cdylib, without platform prefix or suffix.
const LIBRARY: &str = "zvid_capture_plugin";
const BUNDLE_IDENTIFIER: &str = "com.lsegal.zvid.capture.vst3";

/// Extensions of sources the "Rust only" rule forbids under `/daw`.
const FORBIDDEN_EXTENSIONS: &[&str] = &["cpp", "cc", "mm"];
/// Directories that hold build output or third-party packages, not sources.
const SKIPPED_DIRS: &[&str] = &["target", "node_modules", ".git"];

fn main() -> ExitCode {
    let task = std::env::args().nth(1);
    match task.as_deref() {
        Some("check") => match check(&daw_root()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(problems) => {
                for problem in problems {
                    eprintln!("error: {problem}");
                }
                ExitCode::FAILURE
            }
        },
        Some("bundle") => {
            let release = std::env::args().skip(2).any(|arg| arg == "--release");
            match bundle(release) {
                Ok(paths) => {
                    for path in paths {
                        println!("{}", path.display());
                    }
                    ExitCode::SUCCESS
                }
                Err(problem) => {
                    eprintln!("error: {problem}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("usage: cargo xtask check | cargo xtask bundle [--release]");
            ExitCode::FAILURE
        }
    }
}

fn daw_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask lives inside /daw")
        .to_path_buf()
}

fn check(daw: &Path) -> Result<(), Vec<String>> {
    let mut problems: Vec<String> = forbidden_sources(daw)
        .into_iter()
        .map(|path| format!("{} is not allowed: /daw is Rust only", path.display()))
        .collect();
    let bridge = daw.join("../app/export-bridge/Cargo.toml");
    match (zvidlib_rev(&daw.join("Cargo.toml")), zvidlib_rev(&bridge)) {
        (Some(ours), Some(theirs)) if ours == theirs => {}
        (ours, theirs) => problems.push(format!(
            "zvidlib rev in daw/Cargo.toml ({}) must match app/export-bridge ({})",
            ours.as_deref().unwrap_or("missing"),
            theirs.as_deref().unwrap_or("missing"),
        )),
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// Builds the plugin library and writes its `.vst3` bundle and, on macOS,
/// its `.component` bundle.
fn bundle(release: bool) -> Result<Vec<PathBuf>, String> {
    let daw = daw_root();
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let mut build = Command::new(cargo);
    build
        .current_dir(&daw)
        .args(["build", "--package", "zvid-daw-plugin", "--lib"]);
    if release {
        build.arg("--release");
    }
    let status = build
        .status()
        .map_err(|error| format!("could not run cargo: {error}"))?;
    if !status.success() {
        return Err(format!("building the plugin failed ({status})"));
    }
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| daw.join("target"));
    let library = target
        .join(if release { "release" } else { "debug" })
        .join(format!(
            "{}{LIBRARY}{}",
            std::env::consts::DLL_PREFIX,
            std::env::consts::DLL_SUFFIX
        ));
    let bundle = target.join("bundle").join(format!("{PLUGIN_NAME}.vst3"));
    write_bundle(
        &library,
        &bundle,
        std::env::consts::OS,
        std::env::consts::ARCH,
    )?;
    let mut bundles = vec![bundle];
    if cfg!(target_os = "macos") {
        let component = target
            .join("bundle")
            .join(format!("{PLUGIN_NAME}.component"));
        write_component(&library, &component, env!("CARGO_PKG_VERSION"))?;
        // Apple silicon refuses to load code whose signature does not cover
        // the bundle; an ad-hoc signature is enough for `auval`.
        let status = Command::new("codesign")
            .args(["--force", "--sign", "-"])
            .arg(&component)
            .status()
            .map_err(|error| format!("could not run codesign: {error}"))?;
        if !status.success() {
            return Err(format!("signing the component failed ({status})"));
        }
        bundles.push(component);
    }
    Ok(bundles)
}

/// Lays out an AUv2 bundle around `library`, replacing any existing bundle:
///
/// ```text
/// ZVID Capture.component/Contents/
///   MacOS/ZVID Capture, Info.plist, PkgInfo
/// ```
fn write_component(library: &Path, bundle: &Path, version: &str) -> Result<(), String> {
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    if bundle.exists() {
        fs::remove_dir_all(bundle).map_err(|error| io(bundle, error))?;
    }
    let contents = bundle.join("Contents");
    let binary_dir = contents.join("MacOS");
    fs::create_dir_all(&binary_dir).map_err(|error| io(&binary_dir, error))?;
    fs::copy(library, binary_dir.join(component::EXECUTABLE))
        .map_err(|error| io(library, error))?;
    let plist = contents.join("Info.plist");
    fs::write(&plist, component::info_plist(version)).map_err(|error| io(&plist, error))?;
    let pkg_info = contents.join("PkgInfo");
    fs::write(&pkg_info, "BNDL????").map_err(|error| io(&pkg_info, error))?;
    Ok(())
}

/// Lays out a VST3 bundle around `library`, replacing any existing bundle:
///
/// ```text
/// ZVID Capture.vst3/Contents/
///   MacOS/ZVID Capture, Info.plist, PkgInfo   (macOS)
///   x86_64-win/ZVID Capture.vst3              (Windows)
///   x86_64-linux/ZVID Capture.so              (Linux)
///   Resources/moduleinfo.json
/// ```
fn write_bundle(library: &Path, bundle: &Path, os: &str, arch: &str) -> Result<(), String> {
    let contents = bundle.join("Contents");
    let arch = match arch {
        "aarch64" => "arm64",
        other => other,
    };
    let binary = match os {
        "macos" => contents.join("MacOS").join(PLUGIN_NAME),
        "windows" => contents
            .join(format!("{arch}-win"))
            .join(format!("{PLUGIN_NAME}.vst3")),
        "linux" => contents
            .join(format!("{arch}-linux"))
            .join(format!("{PLUGIN_NAME}.so")),
        other => return Err(format!("VST3 bundles are not supported on {other}")),
    };
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    if bundle.exists() {
        fs::remove_dir_all(bundle).map_err(|error| io(bundle, error))?;
    }
    let binary_dir = binary.parent().expect("binary has a parent");
    fs::create_dir_all(binary_dir).map_err(|error| io(binary_dir, error))?;
    fs::copy(library, &binary).map_err(|error| io(library, error))?;
    let resources = contents.join("Resources");
    fs::create_dir_all(&resources).map_err(|error| io(&resources, error))?;
    let module_info = resources.join("moduleinfo.json");
    fs::write(&module_info, zvid_vst3::moduleinfo::module_info())
        .map_err(|error| io(&module_info, error))?;
    if os == "macos" {
        let plist = contents.join("Info.plist");
        fs::write(&plist, info_plist()).map_err(|error| io(&plist, error))?;
        let pkg_info = contents.join("PkgInfo");
        fs::write(&pkg_info, "BNDL????").map_err(|error| io(&pkg_info, error))?;
    }
    Ok(())
}

fn info_plist() -> String {
    let version = zvid_vst3::VERSION;
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>English</string>
	<key>CFBundleExecutable</key>
	<string>{PLUGIN_NAME}</string>
	<key>CFBundleIdentifier</key>
	<string>{BUNDLE_IDENTIFIER}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>{PLUGIN_NAME}</string>
	<key>CFBundlePackageType</key>
	<string>BNDL</string>
	<key>CFBundleShortVersionString</key>
	<string>{version}</string>
	<key>CFBundleSignature</key>
	<string>????</string>
	<key>CFBundleVersion</key>
	<string>{version}</string>
</dict>
</plist>
"#
    )
}

/// Every forbidden source file under `dir`, skipping build output.
fn forbidden_sources(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skipped = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| SKIPPED_DIRS.contains(&name));
            if !skipped {
                found.extend(forbidden_sources(&path));
            }
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| FORBIDDEN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        {
            found.push(path);
        }
    }
    found.sort();
    found
}

/// The `rev` of the `zvidlib` dependency declared in a Cargo manifest.
fn zvidlib_rev(manifest: &Path) -> Option<String> {
    let text = fs::read_to_string(manifest).ok()?;
    let line = text
        .lines()
        .find(|line| line.trim_start().starts_with("zvidlib ="))?;
    let (_, rest) = line.split_once("rev = \"")?;
    let (rev, _) = rest.split_once('"')?;
    Some(rev.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zvid-xtask-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_cpp_sources_but_skips_build_output() {
        let dir = scratch("sources");
        fs::create_dir_all(dir.join("crates/a/src")).unwrap();
        fs::create_dir_all(dir.join("target/debug")).unwrap();
        fs::write(dir.join("crates/a/src/lib.rs"), "").unwrap();
        fs::write(dir.join("crates/a/src/shim.CPP"), "").unwrap();
        fs::write(dir.join("crates/a/view.mm"), "").unwrap();
        fs::write(dir.join("crates/a/x.cc"), "").unwrap();
        fs::write(dir.join("target/debug/gen.cpp"), "").unwrap();

        let names: Vec<String> = forbidden_sources(&dir)
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["shim.CPP", "view.mm", "x.cc"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_zvidlib_rev() {
        let dir = scratch("rev");
        let manifest = dir.join("Cargo.toml");
        fs::write(
            &manifest,
            "[dependencies]\nzvidlib = { git = \"https://example.com/zvidlib\", rev = \"abc123\" }\n",
        )
        .unwrap();
        assert_eq!(zvidlib_rev(&manifest).as_deref(), Some("abc123"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lays_out_vst3_bundles() {
        let dir = scratch("bundle");
        let library = dir.join("plugin.bin");
        fs::write(&library, "binary").unwrap();
        let bundle = |os: &str| dir.join(os).join("ZVID Capture.vst3");

        write_bundle(&library, &bundle("windows"), "windows", "x86_64").unwrap();
        let windows = bundle("windows").join("Contents");
        assert_eq!(
            fs::read_to_string(windows.join("x86_64-win/ZVID Capture.vst3")).unwrap(),
            "binary"
        );
        assert!(!windows.join("Info.plist").exists());

        write_bundle(&library, &bundle("windows"), "windows", "aarch64").unwrap();
        assert!(windows.join("arm64-win/ZVID Capture.vst3").exists());
        assert!(
            !windows.join("x86_64-win").exists(),
            "rebundling replaces the old bundle"
        );

        write_bundle(&library, &bundle("macos"), "macos", "aarch64").unwrap();
        let macos = bundle("macos").join("Contents");
        assert!(macos.join("MacOS/ZVID Capture").exists());
        assert_eq!(
            fs::read_to_string(macos.join("PkgInfo")).unwrap(),
            "BNDL????"
        );
        let plist = fs::read_to_string(macos.join("Info.plist")).unwrap();
        assert!(plist.contains("<string>ZVID Capture</string>"));
        assert!(plist.contains(BUNDLE_IDENTIFIER));
        let module_info = fs::read_to_string(macos.join("Resources/moduleinfo.json")).unwrap();
        assert_eq!(module_info, zvid_vst3::moduleinfo::module_info());

        assert!(write_bundle(&library, &bundle("haiku"), "haiku", "x86_64").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lays_out_component_bundles() {
        let dir = scratch("component");
        let library = dir.join("plugin.bin");
        fs::write(&library, "binary").unwrap();
        let bundle = dir.join("ZVID Capture.component");
        fs::create_dir_all(bundle.join("Contents/Stale")).unwrap();

        write_component(&library, &bundle, "1.2.3").unwrap();

        let contents = bundle.join("Contents");
        assert!(
            !contents.join("Stale").exists(),
            "rebundling replaces the old bundle"
        );
        assert_eq!(
            fs::read_to_string(contents.join("MacOS/ZVID Capture")).unwrap(),
            "binary"
        );
        assert_eq!(
            fs::read_to_string(contents.join("PkgInfo")).unwrap(),
            "BNDL????"
        );
        let plist = fs::read_to_string(contents.join("Info.plist")).unwrap();
        assert!(plist.contains("<string>ZVIDCaptureAUFactory</string>"));
        assert!(plist.contains("<string>1.2.3</string>"));
        assert!(plist.contains("<integer>66051</integer>"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn repository_passes_checks() {
        assert_eq!(check(&daw_root()), Ok(()));
    }
}
