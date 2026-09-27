//! Workspace tasks, run with `cargo xtask <task>`.
//!
//! - `check`: fails when C/C++/Objective-C++ sources appear under `/daw`, or
//!   when the zvidlib rev drifts from `app/export-bridge`.
//! - `bundle [--release] [--universal] [--installer]`: builds the plugin and
//!   lays it out as `target/bundle/ZVID Capture.vst3`, plus, on macOS,
//!   `target/bundle/ZVID Capture.component`. `--release` stamps the version
//!   with the commit and refuses to embed the placeholder UI; `--universal`
//!   (macOS) builds arm64 and x86_64 and `lipo`s them into one binary. macOS
//!   bundles are ad-hoc signed, or, for a release build with
//!   `ZVID_CODESIGN_IDENTITY` set, signed with that Developer ID identity and
//!   the hardened runtime. The Live companion Remote Script goes to
//!   `target/bundle/live-remote-script/ZVID_Capture`.
//!   `--installer` (with `--release`) also writes an installer to
//!   `target/installer`: a `.pkg` on macOS, signed with
//!   `ZVID_INSTALLER_IDENTITY` and notarized and stapled when notary
//!   credentials are set (see [`notary_args`]), or an Inno Setup `.exe` on
//!   Windows.
//! - `check-live [<Live.app>]` (macOS): checks that Live, by default the
//!   newest `/Applications/Ableton Live 12*.app`, has the camera usage string
//!   and entitlements in-process capture needs.
//! - `install-live-script [--user-library <path>]`: copies the Live companion
//!   Remote Script into `<User Library>/Remote Scripts/ZVID_Capture`,
//!   replacing any older copy. The User Library defaults to Live's own
//!   default location for the OS.
//! - `validate [--strictness-level <1-10>] [--skip-gui-tests] [<bundle>...]`:
//!   runs [pluginval](https://github.com/Tracktion/pluginval) against the
//!   bundles, by default `target/bundle/ZVID Capture.vst3` and, on macOS,
//!   the `.component` installed in `~/Library/Audio/Plug-Ins/Components`
//!   (Audio Units must be installed to load). pluginval is a prebuilt
//!   release, downloaded once to `target/tools` and checked against a
//!   pinned SHA-256; nothing is compiled.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use zvid_au::component;
use zvid_daw_core::{BUILD_VERSION_ENV, PLUGIN_NAME};

/// Name of the plugin cdylib, without platform prefix or suffix.
const LIBRARY: &str = "zvid_capture_plugin";
const BUNDLE_IDENTIFIER: &str = "com.lsegal.zvid.capture.vst3";
/// Targets a universal macOS build combines.
const UNIVERSAL_TARGETS: &[&str] = &["aarch64-apple-darwin", "x86_64-apple-darwin"];
/// Developer ID Application identity that signs release macOS bundles.
const CODESIGN_IDENTITY_ENV: &str = "ZVID_CODESIGN_IDENTITY";
/// Developer ID Installer identity that signs the macOS `.pkg`.
const INSTALLER_IDENTITY_ENV: &str = "ZVID_INSTALLER_IDENTITY";
/// Identifier of the macOS installer package's payload.
const PKG_IDENTIFIER: &str = "com.lsegal.zvid.capture.pkg";
/// Inno Setup script for the Windows installer, relative to `/daw`.
const INNO_SCRIPT: &str = "installer/zvid-capture.iss";
/// Where the installers put the plugin bundles on macOS, relative to `/`.
const MACOS_PLUGIN_DIRS: &[(&str, &str)] = &[
    ("vst3", "Library/Audio/Plug-Ins/VST3"),
    ("component", "Library/Audio/Plug-Ins/Components"),
];
/// Entitlements Live must have for the plugin to capture in its process.
const LIVE_ENTITLEMENTS: &[&str] = &[
    "com.apple.security.device.camera",
    "com.apple.security.cs.disable-library-validation",
];
/// Text only the placeholder page `zvid-daw-ui` embeds when `daw/ui/dist` is
/// missing. Not its `data-zvid-placeholder` marker: `is_placeholder` looks
/// for that, so every build contains it.
const PLACEHOLDER_MARKER: &[u8] = b"The ZVID Capture UI was not built";

/// Extensions of sources the "Rust only" rule forbids under `/daw`.
const FORBIDDEN_EXTENSIONS: &[&str] = &["cpp", "cc", "mm"];
/// Directories that hold build output or third-party packages, not sources.
const SKIPPED_DIRS: &[&str] = &["target", "node_modules", ".git"];

/// pluginval release `cargo xtask validate` downloads.
const PLUGINVAL_VERSION: &str = "v1.0.4";
/// Each OS's pluginval release asset and its SHA-256.
const PLUGINVAL_ASSETS: &[(&str, &str, &str)] = &[
    (
        "macos",
        "pluginval_macOS.zip",
        "3c4c533bda0c5059eea3ddaea752d757ee2025041f0f47e6bcb0e87f6082b29f",
    ),
    (
        "windows",
        "pluginval_Windows.zip",
        "c08e61ce3b96db41636f8ec7e76f4c7e2c13ebdac7fa1b5a1f52b4f32ec715ab",
    ),
    (
        "linux",
        "pluginval_Linux.zip",
        "c01c49d8063965c4c2dea8324468336768f5c9139e0b1caebde14c2400b55352",
    ),
];
/// pluginval strictness `cargo xtask validate` and CI use: the highest
/// level, which adds parameter fuzzing and longer runs to level 5's host
/// compatibility bar. Don't lower it to get a green build.
const PLUGINVAL_STRICTNESS: u8 = 10;
const _: () = assert!(
    PLUGINVAL_STRICTNESS >= 5,
    "5 is pluginval's host compatibility bar"
);

/// Folder name of the Live companion Remote Script, which Live shows as the
/// Control Surface name.
const LIVE_SCRIPT: &str = "ZVID_Capture";
/// Entries of the Remote Script folder that Live does not need.
const LIVE_SCRIPT_SKIPPED: &[&str] = &["tests", "__pycache__"];

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
            let flags: Vec<String> = std::env::args().skip(2).collect();
            let release = flags.iter().any(|arg| arg == "--release");
            let universal = flags.iter().any(|arg| arg == "--universal");
            let installer = flags.iter().any(|arg| arg == "--installer");
            match bundle(release, universal, installer) {
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
        Some("install-live-script") => {
            let flags: Vec<String> = std::env::args().skip(2).collect();
            match install_live_script(&flags) {
                Ok(path) => {
                    println!("{}", path.display());
                    ExitCode::SUCCESS
                }
                Err(problem) => {
                    eprintln!("error: {problem}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("check-live") => match check_live(std::env::args().nth(2).map(PathBuf::from)) {
            Ok(app) => {
                println!("{} can host ZVID Capture's camera capture", app.display());
                ExitCode::SUCCESS
            }
            Err(problem) => {
                eprintln!("error: {problem}");
                ExitCode::FAILURE
            }
        },
        Some("validate") => {
            let flags: Vec<String> = std::env::args().skip(2).collect();
            match validate(&flags) {
                Ok(()) => ExitCode::SUCCESS,
                Err(problem) => {
                    eprintln!("error: {problem}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!(
                "usage: cargo xtask check \
                 | cargo xtask bundle [--release] [--universal] [--installer] \
                 | cargo xtask validate [--strictness-level <1-10>] [--skip-gui-tests] [<bundle>...] \
                 | cargo xtask install-live-script [--user-library <path>] \
                 | cargo xtask check-live [<Live.app>]"
            );
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

fn target_dir(daw: &Path) -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| daw.join("target"))
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
/// its `.component` bundle, then, with `installer`, the installer for them.
fn bundle(release: bool, universal: bool, installer: bool) -> Result<Vec<PathBuf>, String> {
    if universal && !cfg!(target_os = "macos") {
        return Err("--universal is only supported on macOS".into());
    }
    if installer && !release {
        return Err("--installer needs --release".into());
    }
    // Only release builds get a Developer ID signature; debug builds keep
    // the ad-hoc one.
    let identity = std::env::var(CODESIGN_IDENTITY_ENV)
        .ok()
        .filter(|identity| release && !identity.trim().is_empty())
        .unwrap_or_else(|| "-".into());
    let daw = daw_root();
    let version = if release {
        // zvid-daw-ui would silently embed its placeholder page instead.
        if !daw.join("ui/dist/index.html").is_file() {
            return Err(
                "daw/ui/dist is missing; run `pnpm --dir daw/ui build` before a release bundle"
                    .into(),
            );
        }
        stamped_version(env!("CARGO_PKG_VERSION"), &build_commit(&daw))
    } else {
        env!("CARGO_PKG_VERSION").to_string()
    };
    let target = target_dir(&daw);
    let library = if universal {
        let mut slices = Vec::new();
        for triple in UNIVERSAL_TARGETS {
            slices.push(build_library(
                &daw,
                &target,
                release,
                Some(triple),
                &version,
            )?);
        }
        let output = target
            .join("universal")
            .join(profile_dir(release))
            .join(library_name());
        lipo(&slices, &output)?;
        output
    } else {
        build_library(&daw, &target, release, None, &version)?
    };
    if release {
        let binary =
            fs::read(&library).map_err(|error| format!("{}: {error}", library.display()))?;
        if contains(&binary, PLACEHOLDER_MARKER) {
            return Err(format!(
                "{} embeds the placeholder UI; rebuild daw/ui and try again",
                library.display()
            ));
        }
    }
    let bundle = target.join("bundle").join(format!("{PLUGIN_NAME}.vst3"));
    write_bundle(
        &library,
        &bundle,
        std::env::consts::OS,
        std::env::consts::ARCH,
        &version,
    )?;
    let mut bundles = vec![bundle];
    if cfg!(target_os = "macos") {
        let component = target
            .join("bundle")
            .join(format!("{PLUGIN_NAME}.component"));
        write_component(&library, &component, &version)?;
        bundles.push(component);
        // Apple silicon refuses to load code whose signature does not cover
        // the bundle; an ad-hoc signature is enough for `auval` and local
        // hosts.
        for bundle in &bundles {
            codesign(bundle, &identity)?;
        }
    }
    let script = target
        .join("bundle")
        .join("live-remote-script")
        .join(LIVE_SCRIPT);
    copy_live_script(&live_script_source(&daw), &script)?;
    if installer {
        let output = target.join("installer");
        let package = if cfg!(target_os = "macos") {
            package_macos(&target, &bundles, &output, &version)?
        } else if cfg!(target_os = "windows") {
            package_windows(&daw, &target.join("bundle"), &output, &version)?
        } else {
            return Err(format!(
                "installers are not supported on {}",
                std::env::consts::OS
            ));
        };
        bundles.push(package);
    }
    bundles.push(script);
    Ok(bundles)
}

/// `codesign` arguments that sign with `identity`: ad-hoc for `-`, otherwise
/// a Developer ID signature with the hardened runtime and a secure
/// timestamp, which notarization requires.
fn codesign_args(identity: &str) -> Vec<&str> {
    if identity == "-" {
        vec!["--force", "--sign", "-"]
    } else {
        vec![
            "--force",
            "--options",
            "runtime",
            "--timestamp",
            "--sign",
            identity,
        ]
    }
}

fn codesign(bundle: &Path, identity: &str) -> Result<(), String> {
    run(
        Command::new("codesign")
            .args(codesign_args(identity))
            .arg(bundle),
        &format!("signing {}", bundle.display()),
    )?;
    run(
        Command::new("codesign")
            .args(["--verify", "--strict", "--verbose=2"])
            .arg(bundle),
        &format!("verifying the signature of {}", bundle.display()),
    )
}

/// What `cargo xtask validate` runs pluginval on, and how.
#[derive(Debug, PartialEq)]
struct Validation {
    strictness: u8,
    skip_gui_tests: bool,
    bundles: Vec<PathBuf>,
}

fn validation_options(flags: &[String]) -> Result<Validation, String> {
    let mut options = Validation {
        strictness: PLUGINVAL_STRICTNESS,
        skip_gui_tests: false,
        bundles: Vec::new(),
    };
    let mut flags = flags.iter();
    while let Some(flag) = flags.next() {
        match flag.as_str() {
            "--strictness-level" => {
                options.strictness = flags
                    .next()
                    .and_then(|level| level.parse().ok())
                    .filter(|level| (1..=10).contains(level))
                    .ok_or("--strictness-level takes a level from 1 to 10")?;
            }
            "--skip-gui-tests" => options.skip_gui_tests = true,
            flag if flag.starts_with("--") => return Err(format!("unknown flag {flag}")),
            bundle => options.bundles.push(PathBuf::from(bundle)),
        }
    }
    Ok(options)
}

/// The bundles `cargo xtask validate` checks when none are named.
fn default_validation_bundles(target: &Path, home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut bundles = vec![target.join("bundle").join(format!("{PLUGIN_NAME}.vst3"))];
    if cfg!(target_os = "macos")
        && let Some(home) = home
    {
        bundles.push(
            home.join("Library/Audio/Plug-Ins/Components")
                .join(format!("{PLUGIN_NAME}.component")),
        );
    }
    bundles
}

/// Runs pluginval against each bundle, and fails if any fails.
fn validate(flags: &[String]) -> Result<(), String> {
    let mut options = validation_options(flags)?;
    let target = target_dir(&daw_root());
    if options.bundles.is_empty() {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        options.bundles = default_validation_bundles(&target, home);
    }
    for bundle in &options.bundles {
        if !bundle.exists() {
            let hint = if bundle.extension().is_some_and(|ext| ext == "component") {
                "run `cargo xtask bundle` and copy target/bundle/ZVID Capture.component there"
            } else {
                "run `cargo xtask bundle` first"
            };
            return Err(format!("{} is missing; {hint}", bundle.display()));
        }
    }
    let pluginval = fetch_pluginval(&target)?;
    let mut failed = Vec::new();
    for bundle in &options.bundles {
        println!(
            "validating {} at strictness level {}",
            bundle.display(),
            options.strictness
        );
        let args = pluginval_args(options.strictness, options.skip_gui_tests, bundle);
        let what = format!("pluginval on {}", bundle.display());
        if let Err(problem) = run(Command::new(&pluginval).args(args), &what) {
            eprintln!("error: {problem}");
            failed.push(bundle.display().to_string());
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(format!("pluginval failed on {}", failed.join(", ")))
    }
}

fn pluginval_args(strictness: u8, skip_gui_tests: bool, bundle: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["--strictness-level".into(), strictness.to_string().into()];
    if skip_gui_tests {
        args.push("--skip-gui-tests".into());
    }
    args.push("--validate".into());
    args.push(bundle.into());
    args
}

/// The pluginval release asset for `os` and its SHA-256.
fn pluginval_asset(os: &str) -> Result<(&'static str, &'static str), String> {
    PLUGINVAL_ASSETS
        .iter()
        .find(|(asset_os, _, _)| *asset_os == os)
        .map(|&(_, asset, sha256)| (asset, sha256))
        .ok_or_else(|| format!("pluginval has no release for {os}"))
}

/// The pluginval executable inside its unpacked release in `dir`.
fn pluginval_executable(dir: &Path, os: &str) -> PathBuf {
    match os {
        "macos" => dir.join("pluginval.app/Contents/MacOS/pluginval"),
        "windows" => dir.join("pluginval.exe"),
        _ => dir.join("pluginval"),
    }
}

/// Returns pluginval, downloading, checking and unpacking its release into
/// `target/tools` the first time.
fn fetch_pluginval(target: &Path) -> Result<PathBuf, String> {
    let os = std::env::consts::OS;
    let (asset, sha256) = pluginval_asset(os)?;
    let tools = target.join("tools");
    let dir = tools.join(format!("pluginval-{PLUGINVAL_VERSION}"));
    let executable = pluginval_executable(&dir, os);
    if executable.is_file() {
        return Ok(executable);
    }
    // Unpacked beside `dir` and renamed into place, so an interrupted fetch
    // never leaves a partial release that looks complete.
    let partial = tools.join(format!("pluginval-{PLUGINVAL_VERSION}.partial"));
    let _ = fs::remove_dir_all(&partial);
    fs::create_dir_all(&partial)
        .map_err(|error| format!("could not create {}: {error}", partial.display()))?;
    let archive = partial.join(asset);
    let url = format!(
        "https://github.com/Tracktion/pluginval/releases/download/{PLUGINVAL_VERSION}/{asset}"
    );
    println!("downloading {url}");
    run(
        Command::new("curl")
            .args(["--fail", "--silent", "--show-error", "--location"])
            .args(["--retry", "3", "--output"])
            .arg(&archive)
            .arg(&url),
        "downloading pluginval",
    )?;
    let bytes = fs::read(&archive)
        .map_err(|error| format!("could not read {}: {error}", archive.display()))?;
    let actual = sha256_hex(&bytes);
    if actual != sha256 {
        let _ = fs::remove_dir_all(&partial);
        return Err(format!(
            "{asset} has SHA-256 {actual}, expected {sha256}; not running it"
        ));
    }
    let mut unpack = match os {
        "macos" => {
            let mut ditto = Command::new("ditto");
            ditto.args(["-x", "-k"]).arg(&archive).arg(&partial);
            ditto
        }
        // Windows' own bsdtar reads zips; Git's GNU tar, often first on
        // PATH, doesn't.
        "windows" => {
            let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
            let mut tar = Command::new(Path::new(&root).join(r"System32\tar.exe"));
            tar.arg("-xf").arg(&archive).arg("-C").arg(&partial);
            tar
        }
        _ => {
            let mut unzip = Command::new("unzip");
            unzip.arg("-q").arg(&archive).arg("-d").arg(&partial);
            unzip
        }
    };
    run(&mut unpack, "unpacking pluginval")?;
    let _ = fs::remove_file(&archive);
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&partial, &dir)
        .map_err(|error| format!("could not move pluginval to {}: {error}", dir.display()))?;
    if executable.is_file() {
        Ok(executable)
    } else {
        Err(format!("{asset} has no {}", executable.display()))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Runs `command`, failing with `what` when it can't start or exits
/// unsuccessfully.
fn run(command: &mut Command, what: &str) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let status = command
        .status()
        .map_err(|error| format!("{what}: could not run {program}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{what} failed ({status})"))
    }
}

/// Base name of the installer for `version`, without its extension.
fn installer_name(version: &str) -> String {
    format!("zvid-capture-{version}")
}

/// Builds the macOS installer package for the signed `bundles`, which
/// installs them into `/Library/Audio/Plug-Ins`, then signs, notarizes and
/// staples it when those are configured. Returns the package's path.
fn package_macos(
    target: &Path,
    bundles: &[PathBuf],
    output: &Path,
    version: &str,
) -> Result<PathBuf, String> {
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    let work = target.join("package");
    if work.exists() {
        fs::remove_dir_all(&work).map_err(|error| io(&work, error))?;
    }
    let root = work.join("root");
    let mut relative = Vec::new();
    for bundle in bundles {
        let name = bundle.file_name().expect("bundles have names");
        let extension = bundle.extension().and_then(|ext| ext.to_str());
        let (_, dir) = MACOS_PLUGIN_DIRS
            .iter()
            .find(|(ext, _)| Some(*ext) == extension)
            .ok_or_else(|| format!("{} is not a plugin bundle", bundle.display()))?;
        let path = Path::new(dir).join(name);
        // ditto keeps the bundles' symlinks and signatures intact.
        run(
            Command::new("ditto").arg(bundle).arg(root.join(&path)),
            &format!("staging {}", bundle.display()),
        )?;
        relative.push(path.to_string_lossy().into_owned());
    }
    let components = work.join("components.plist");
    fs::write(&components, component_plist(&relative)).map_err(|error| io(&components, error))?;
    let payload_dir = work.join("packages");
    fs::create_dir_all(&payload_dir).map_err(|error| io(&payload_dir, error))?;
    run(
        Command::new("pkgbuild")
            .arg("--root")
            .arg(&root)
            .arg("--component-plist")
            .arg(&components)
            .args(["--identifier", PKG_IDENTIFIER, "--version", version])
            .args(["--install-location", "/"])
            .arg(payload_dir.join("zvid-capture.pkg")),
        "building the installer payload",
    )?;
    let distribution = work.join("distribution.xml");
    fs::write(&distribution, distribution_xml(version))
        .map_err(|error| io(&distribution, error))?;
    fs::create_dir_all(output).map_err(|error| io(output, error))?;
    let package = output.join(format!("{}.pkg", installer_name(version)));
    let installer_identity = std::env::var(INSTALLER_IDENTITY_ENV)
        .ok()
        .filter(|identity| !identity.trim().is_empty());
    let notary = notary_args(|name| std::env::var(name).ok())?;
    if notary.is_some() && installer_identity.is_none() {
        return Err(format!(
            "notarizing needs a signed installer; set {INSTALLER_IDENTITY_ENV}"
        ));
    }
    let mut productbuild = Command::new("productbuild");
    productbuild
        .arg("--distribution")
        .arg(&distribution)
        .arg("--package-path")
        .arg(&payload_dir);
    if let Some(identity) = &installer_identity {
        productbuild.args(["--sign", identity, "--timestamp"]);
    }
    run(productbuild.arg(&package), "building the installer")?;
    if installer_identity.is_none() {
        println!("warning: {INSTALLER_IDENTITY_ENV} is not set; the installer is unsigned");
        return Ok(package);
    }
    run(
        Command::new("pkgutil")
            .arg("--check-signature")
            .arg(&package),
        "checking the installer signature",
    )?;
    match notary {
        Some(credentials) => notarize(&package, &credentials)?,
        None => println!("warning: notary credentials are not set; the installer is not notarized"),
    }
    Ok(package)
}

/// `pkgbuild` component list for bundles at the root-relative `paths`. It
/// installs them exactly there: without it, the installer "upgrades" a copy
/// the user moved elsewhere instead.
fn component_plist(paths: &[String]) -> String {
    let entries: String = paths
        .iter()
        .map(|path| {
            format!(
                "\t<dict>
\t\t<key>BundleHasStrictIdentifier</key>
\t\t<true/>
\t\t<key>BundleIsRelocatable</key>
\t\t<false/>
\t\t<key>BundleIsVersionChecked</key>
\t\t<false/>
\t\t<key>BundleOverwriteAction</key>
\t\t<string>upgrade</string>
\t\t<key>RootRelativeBundlePath</key>
\t\t<string>{path}</string>
\t</dict>
"
            )
        })
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
{entries}</array>
</plist>
"#
    )
}

/// `productbuild` distribution for the payload package: runs natively on
/// both architectures, installs only to the system volume and needs macOS
/// 13, the plugin's minimum.
fn distribution_xml(version: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>{PLUGIN_NAME}</title>
    <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="13.0"/>
        </allowed-os-versions>
    </volume-check>
    <choices-outline>
        <line choice="default">
            <line choice="{PKG_IDENTIFIER}"/>
        </line>
    </choices-outline>
    <choice id="default"/>
    <choice id="{PKG_IDENTIFIER}" visible="false">
        <pkg-ref id="{PKG_IDENTIFIER}"/>
    </choice>
    <pkg-ref id="{PKG_IDENTIFIER}" version="{version}" onConclusion="none">zvid-capture.pkg</pkg-ref>
</installer-gui-script>
"#
    )
}

/// `notarytool` credential arguments from the environment, looked up
/// through `var`: a keychain profile in `ZVID_NOTARY_PROFILE`, or an Apple
/// ID, team ID and app-specific password in `ZVID_NOTARY_APPLE_ID`,
/// `ZVID_NOTARY_TEAM_ID` and `ZVID_NOTARY_PASSWORD`. `None` when none are
/// set; an error when only some of the Apple ID ones are.
fn notary_args(var: impl Fn(&str) -> Option<String>) -> Result<Option<Vec<String>>, String> {
    let var = |name: &str| var(name).filter(|value| !value.trim().is_empty());
    if let Some(profile) = var("ZVID_NOTARY_PROFILE") {
        return Ok(Some(vec!["--keychain-profile".into(), profile]));
    }
    let names = [
        ("--apple-id", "ZVID_NOTARY_APPLE_ID"),
        ("--team-id", "ZVID_NOTARY_TEAM_ID"),
        ("--password", "ZVID_NOTARY_PASSWORD"),
    ];
    let values: Vec<Option<String>> = names.iter().map(|(_, name)| var(name)).collect();
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    let mut args = Vec::new();
    for ((flag, name), value) in names.iter().zip(values) {
        let value = value.ok_or_else(|| {
            format!(
                "{name} is not set; notarizing with an Apple ID needs ZVID_NOTARY_APPLE_ID, \
                 ZVID_NOTARY_TEAM_ID and ZVID_NOTARY_PASSWORD"
            )
        })?;
        args.push(flag.to_string());
        args.push(value);
    }
    Ok(Some(args))
}

/// Submits `package` to Apple's notary service, waits for the verdict and
/// staples the ticket to it.
fn notarize(package: &Path, credentials: &[String]) -> Result<(), String> {
    let output = Command::new("xcrun")
        .args(["notarytool", "submit"])
        .arg(package)
        .args(["--wait", "--output-format", "json"])
        .args(credentials)
        .output()
        .map_err(|error| format!("could not run notarytool: {error}"))?;
    let report = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || !notarization_accepted(&report) {
        return Err(format!(
            "notarizing {} failed ({}): {} {}\nrun `xcrun notarytool log <id>` for details",
            package.display(),
            output.status,
            report.trim(),
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    run(
        Command::new("xcrun")
            .args(["stapler", "staple"])
            .arg(package),
        "stapling the notarization ticket",
    )?;
    run(
        Command::new("xcrun")
            .args(["stapler", "validate"])
            .arg(package),
        "validating the stapled ticket",
    )
}

/// Whether `notarytool submit --wait --output-format json` reported the
/// submission as accepted.
fn notarization_accepted(report: &str) -> bool {
    let compact: String = report.chars().filter(|c| !c.is_whitespace()).collect();
    compact.contains(r#""status":"Accepted""#)
}

/// Compiles the Windows installer for the bundles in `bundle_dir` with Inno
/// Setup and returns its path.
fn package_windows(
    daw: &Path,
    bundle_dir: &Path,
    output: &Path,
    version: &str,
) -> Result<PathBuf, String> {
    let iscc = find_iscc()
        .ok_or("Inno Setup 6 was not found; install it or set ISCC to the path of ISCC.exe")?;
    let name = format!("{}-setup", installer_name(version));
    run(
        Command::new(&iscc)
            .args(iscc_args(version, bundle_dir, output, &name))
            .arg(daw.join(INNO_SCRIPT)),
        "building the installer",
    )?;
    Ok(output.join(format!("{name}.exe")))
}

/// Inno Setup compiler defines for `zvid-capture.iss`.
fn iscc_args(version: &str, bundle_dir: &Path, output: &Path, name: &str) -> Vec<String> {
    // VERSIONINFO only takes numbers, so the build metadata is dropped there.
    let numeric = version.split(['+', '-']).next().unwrap_or(version);
    vec![
        "/Q".into(),
        format!("/DAppVersion={version}"),
        format!("/DNumericVersion={numeric}"),
        format!("/DSourceDir={}", bundle_dir.display()),
        format!("/DOutputDir={}", output.display()),
        format!("/DOutputBaseFilename={name}"),
    ]
}

/// `ISCC.exe`: `ISCC` from the environment, else Inno Setup 6's default
/// install location, else the one on `PATH`.
fn find_iscc() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ISCC").filter(|path| !path.is_empty()) {
        return Some(PathBuf::from(path));
    }
    ["ProgramFiles(x86)", "ProgramFiles"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|dir| PathBuf::from(dir).join("Inno Setup 6").join("ISCC.exe"))
        .find(|path| path.is_file())
        .or_else(|| {
            Command::new("iscc")
                .arg("/?")
                .output()
                .is_ok()
                .then(|| "iscc".into())
        })
}

/// Checks that Live at `app`, or the newest Live 12 in `/Applications`, has
/// what the plugin's in-process camera capture relies on, and returns the
/// app it checked.
fn check_live(app: Option<PathBuf>) -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("check-live only applies to macOS; Windows has no entitlements".into());
    }
    let app = match app {
        Some(app) => app,
        None => {
            let mut apps: Vec<PathBuf> = fs::read_dir("/Applications")
                .map_err(|error| format!("/Applications: {error}"))?
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            name.starts_with("Ableton Live 12") && name.ends_with(".app")
                        })
                })
                .collect();
            apps.sort();
            apps.pop()
                .ok_or("no Ableton Live 12 in /Applications; pass the app's path")?
        }
    };
    let entitlements = Command::new("codesign")
        .args(["--display", "--entitlements", "-", "--xml"])
        .arg(&app)
        .output()
        .map_err(|error| format!("could not run codesign: {error}"))?;
    if !entitlements.status.success() {
        return Err(format!(
            "reading the entitlements of {} failed: {}",
            app.display(),
            String::from_utf8_lossy(&entitlements.stderr).trim()
        ));
    }
    // Live's Info.plist may be binary; plutil prints it as XML either way.
    let info_plist = Command::new("plutil")
        .args(["-convert", "xml1", "-o", "-"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|error| format!("could not run plutil: {error}"))?;
    let problems = live_host_problems(
        &String::from_utf8_lossy(&entitlements.stdout),
        &String::from_utf8_lossy(&info_plist.stdout),
    );
    if problems.is_empty() {
        Ok(app)
    } else {
        Err(format!(
            "{} {}; in-process capture needs the helper-app path from #196",
            app.display(),
            problems.join(", ")
        ))
    }
}

/// What Live lacks for in-process capture, given its entitlements and
/// `Info.plist` as XML property lists.
fn live_host_problems(entitlements: &str, info_plist: &str) -> Vec<String> {
    let mut problems: Vec<String> = LIVE_ENTITLEMENTS
        .iter()
        .filter(|key| !plist_key_is_true(entitlements, key))
        .map(|key| format!("lacks the {key} entitlement"))
        .collect();
    if !info_plist.contains("<key>NSCameraUsageDescription</key>") {
        problems.push("has no NSCameraUsageDescription".into());
    }
    problems
}

/// Whether the XML property list `plist` sets `key` to `true`.
fn plist_key_is_true(plist: &str, key: &str) -> bool {
    let marker = format!("<key>{key}</key>");
    plist
        .split_once(&marker)
        .is_some_and(|(_, rest)| rest.trim_start().starts_with("<true/>"))
}

/// Installs the Live companion Remote Script into the User Library named by
/// `--user-library`, or Live's default one, and returns where it went.
fn install_live_script(flags: &[String]) -> Result<PathBuf, String> {
    let user_library = match flags {
        [] => default_user_library(std::env::consts::OS, |name| std::env::var_os(name))?,
        [flag, path] if flag == "--user-library" => PathBuf::from(path),
        _ => return Err("usage: cargo xtask install-live-script [--user-library <path>]".into()),
    };
    if !user_library.is_dir() {
        return Err(format!(
            "{} is not a directory; pass the Live User Library with --user-library <path>",
            user_library.display()
        ));
    }
    let destination = user_library.join("Remote Scripts").join(LIVE_SCRIPT);
    copy_live_script(&live_script_source(&daw_root()), &destination)?;
    Ok(destination)
}

fn live_script_source(daw: &Path) -> PathBuf {
    daw.join("live-remote-script").join(LIVE_SCRIPT)
}

/// Live's default User Library for `os`, with the home directory looked up
/// through `var`.
fn default_user_library(
    os: &str,
    var: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Result<PathBuf, String> {
    let (home, rest): (&str, &[&str]) = match os {
        "macos" => ("HOME", &["Music", "Ableton", "User Library"]),
        "windows" => ("USERPROFILE", &["Documents", "Ableton", "User Library"]),
        other => {
            return Err(format!(
                "Live does not run on {other}; pass the User Library with --user-library <path>"
            ));
        }
    };
    let mut path = var(home)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!("{home} is not set; pass the User Library with --user-library <path>")
        })?;
    path.extend(rest);
    Ok(path)
}

/// Copies the Remote Script folder `source` to `destination`, replacing any
/// existing copy and leaving out tests and Python caches.
fn copy_live_script(source: &Path, destination: &Path) -> Result<(), String> {
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| io(destination, error))?;
    }
    copy_tree(source, destination).map_err(|(path, error)| io(&path, error))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), (PathBuf, std::io::Error)> {
    fs::create_dir_all(destination).map_err(|error| (destination.to_path_buf(), error))?;
    let entries = fs::read_dir(source).map_err(|error| (source.to_path_buf(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| (source.to_path_buf(), error))?;
        let path = entry.path();
        let name = entry.file_name();
        let skipped = name
            .to_str()
            .is_some_and(|name| LIVE_SCRIPT_SKIPPED.contains(&name) || name.ends_with(".pyc"));
        if skipped {
            continue;
        }
        let target = destination.join(&name);
        if path.is_dir() {
            copy_tree(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|error| (path.clone(), error))?;
        }
    }
    Ok(())
}

/// Builds the plugin cdylib, for `triple` when given, and returns its path.
/// Release builds bake the stamped `version` in through [`BUILD_VERSION_ENV`].
fn build_library(
    daw: &Path,
    target: &Path,
    release: bool,
    triple: Option<&str>,
    version: &str,
) -> Result<PathBuf, String> {
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let mut build = Command::new(cargo);
    build
        .current_dir(daw)
        .args(["build", "--package", "zvid-daw-plugin", "--lib"]);
    if release {
        build.arg("--release").env(BUILD_VERSION_ENV, version);
    }
    if let Some(triple) = triple {
        build.args(["--target", triple]);
    }
    let status = build
        .status()
        .map_err(|error| format!("could not run cargo: {error}"))?;
    if !status.success() {
        return Err(format!("building the plugin failed ({status})"));
    }
    let mut dir = target.to_path_buf();
    if let Some(triple) = triple {
        dir.push(triple);
    }
    Ok(dir.join(profile_dir(release)).join(library_name()))
}

fn profile_dir(release: bool) -> &'static str {
    if release { "release" } else { "debug" }
}

fn library_name() -> String {
    format!(
        "{}{LIBRARY}{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    )
}

/// Combines single-architecture `slices` into one universal binary.
fn lipo(slices: &[PathBuf], output: &Path) -> Result<(), String> {
    let dir = output.parent().expect("output has a parent");
    fs::create_dir_all(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    let status = Command::new("lipo")
        .arg("-create")
        .args(slices)
        .arg("-output")
        .arg(output)
        .status()
        .map_err(|error| format!("could not run lipo: {error}"))?;
    if !status.success() {
        return Err(format!("combining the universal binary failed ({status})"));
    }
    Ok(())
}

/// The commit being built: `GITHUB_SHA` in CI, otherwise `git rev-parse
/// HEAD` with a `-dirty` suffix for uncommitted changes, or `dev` without
/// git. Mirrors `resolveAppCommit` in `app/src/build-info.ts`.
fn build_commit(daw: &Path) -> String {
    if let Ok(sha) = std::env::var("GITHUB_SHA")
        && !sha.trim().is_empty()
    {
        return sha.trim().to_string();
    }
    let git = |args: &[&str]| {
        Command::new("git")
            .current_dir(daw)
            .args(args)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    };
    match git(&["rev-parse", "HEAD"]) {
        Some(head) if !head.is_empty() => {
            let dirty = git(&["status", "--porcelain"]).is_some_and(|status| !status.is_empty());
            if dirty { format!("{head}-dirty") } else { head }
        }
        _ => "dev".into(),
    }
}

/// `0.1.0` + `c94f40e9151d…` -> `0.1.0+c94f40e`, keeping any `-dirty` marker;
/// a build without a real commit gets the bare version. Matches
/// `formatAppVersion` in `app/src/build-info.ts`.
fn stamped_version(version: &str, commit: &str) -> String {
    let (sha, dirty) = match commit.strip_suffix("-dirty") {
        Some(sha) => (sha, "-dirty"),
        None => (commit, ""),
    };
    let is_sha = (7..=40).contains(&sha.len()) && sha.bytes().all(|b| b.is_ascii_hexdigit());
    if is_sha {
        format!("{version}+{}{dirty}", &sha[..7])
    } else {
        version.to_string()
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
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
fn write_bundle(
    library: &Path,
    bundle: &Path,
    os: &str,
    arch: &str,
    version: &str,
) -> Result<(), String> {
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
    fs::write(&module_info, zvid_vst3::moduleinfo::module_info(version))
        .map_err(|error| io(&module_info, error))?;
    if os == "macos" {
        let plist = contents.join("Info.plist");
        fs::write(&plist, info_plist(version)).map_err(|error| io(&plist, error))?;
        let pkg_info = contents.join("PkgInfo");
        fs::write(&pkg_info, "BNDL????").map_err(|error| io(&pkg_info, error))?;
    }
    Ok(())
}

fn info_plist(version: &str) -> String {
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

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn parses_validation_flags() {
        assert_eq!(
            validation_options(&[]).unwrap(),
            Validation {
                strictness: PLUGINVAL_STRICTNESS,
                skip_gui_tests: false,
                bundles: Vec::new(),
            }
        );
        assert_eq!(
            validation_options(&strings(&[
                "--strictness-level",
                "7",
                "--skip-gui-tests",
                "a.vst3",
                "b.component",
            ]))
            .unwrap(),
            Validation {
                strictness: 7,
                skip_gui_tests: true,
                bundles: vec!["a.vst3".into(), "b.component".into()],
            }
        );
        for bad in [
            &["--strictness-level"][..],
            &["--strictness-level", "0"],
            &["--strictness-level", "11"],
            &["--release"],
        ] {
            assert!(validation_options(&strings(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn validates_at_least_at_the_host_compatibility_level() {
        let args = pluginval_args(PLUGINVAL_STRICTNESS, false, Path::new("x.vst3"));
        assert_eq!(args, ["--strictness-level", "10", "--validate", "x.vst3"]);
        let args = pluginval_args(5, true, Path::new("x.vst3"));
        assert_eq!(
            args,
            [
                "--strictness-level",
                "5",
                "--skip-gui-tests",
                "--validate",
                "x.vst3"
            ]
        );
    }

    #[test]
    fn validates_the_vst3_and_the_installed_component_by_default() {
        let bundles = default_validation_bundles(Path::new("/t"), Some("/home/me".into()));
        assert_eq!(bundles[0], Path::new("/t/bundle/ZVID Capture.vst3"));
        if cfg!(target_os = "macos") {
            assert_eq!(
                bundles[1],
                Path::new("/home/me/Library/Audio/Plug-Ins/Components/ZVID Capture.component")
            );
        } else {
            assert_eq!(bundles.len(), 1);
        }
    }

    #[test]
    fn pins_a_pluginval_release_for_each_ci_os() {
        for os in ["macos", "windows"] {
            let (asset, sha256) = pluginval_asset(os).unwrap();
            assert!(asset.ends_with(".zip"));
            assert_eq!(sha256.len(), 64);
            assert!(sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
        assert!(pluginval_asset("plan9").is_err());
        assert_eq!(
            pluginval_executable(Path::new("p"), "macos"),
            Path::new("p/pluginval.app/Contents/MacOS/pluginval")
        );
        assert_eq!(
            pluginval_executable(Path::new("p"), "windows"),
            Path::new("p/pluginval.exe")
        );
    }

    #[test]
    fn hashes_with_sha256() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

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

        write_bundle(&library, &bundle("windows"), "windows", "x86_64", "0.1.0").unwrap();
        let windows = bundle("windows").join("Contents");
        assert_eq!(
            fs::read_to_string(windows.join("x86_64-win/ZVID Capture.vst3")).unwrap(),
            "binary"
        );
        assert!(!windows.join("Info.plist").exists());

        write_bundle(&library, &bundle("windows"), "windows", "aarch64", "0.1.0").unwrap();
        assert!(windows.join("arm64-win/ZVID Capture.vst3").exists());
        assert!(
            !windows.join("x86_64-win").exists(),
            "rebundling replaces the old bundle"
        );

        write_bundle(
            &library,
            &bundle("macos"),
            "macos",
            "aarch64",
            "0.1.0+c94f40e",
        )
        .unwrap();
        let macos = bundle("macos").join("Contents");
        assert!(macos.join("MacOS/ZVID Capture").exists());
        assert_eq!(
            fs::read_to_string(macos.join("PkgInfo")).unwrap(),
            "BNDL????"
        );
        let plist = fs::read_to_string(macos.join("Info.plist")).unwrap();
        assert!(plist.contains("<string>ZVID Capture</string>"));
        assert!(plist.contains(BUNDLE_IDENTIFIER));
        assert!(plist.contains("<key>CFBundleVersion</key>\n\t<string>0.1.0+c94f40e</string>"));
        assert!(
            plist.contains(
                "<key>CFBundleShortVersionString</key>\n\t<string>0.1.0+c94f40e</string>"
            )
        );
        let module_info = fs::read_to_string(macos.join("Resources/moduleinfo.json")).unwrap();
        assert_eq!(
            module_info,
            zvid_vst3::moduleinfo::module_info("0.1.0+c94f40e")
        );

        assert!(write_bundle(&library, &bundle("haiku"), "haiku", "x86_64", "0.1.0").is_err());
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
    fn stamps_version_with_short_commit() {
        let sha = "c94f40e9151d0b6a1f0c7c4a2b1d3e5f6a7b8c9d";
        assert_eq!(stamped_version("0.1.0", sha), "0.1.0+c94f40e");
        assert_eq!(
            stamped_version("0.1.0", &format!("{sha}-dirty")),
            "0.1.0+c94f40e-dirty"
        );
        assert_eq!(stamped_version("0.1.0", "dev"), "0.1.0");
        assert_eq!(stamped_version("0.1.0", "not-a-sha"), "0.1.0");
        // The AudioComponents version ignores the build metadata.
        assert_eq!(component::version_number("0.1.0+c94f40e"), 0x0000_0100);
    }

    #[test]
    fn detects_the_placeholder_ui() {
        // Only the page build.rs falls back to carries the marker, not the
        // runtime code that ends up in every binary.
        let build_script = include_bytes!("../../crates/zvid-daw-ui/build.rs");
        assert!(contains(build_script, PLACEHOLDER_MARKER));
        let assets = include_bytes!("../../crates/zvid-daw-ui/src/assets.rs");
        assert!(!contains(assets, PLACEHOLDER_MARKER));
    }

    #[test]
    fn installs_the_live_script() {
        let dir = scratch("live-script");
        let source = dir.join("source");
        fs::create_dir_all(source.join("tests")).unwrap();
        fs::create_dir_all(source.join("__pycache__")).unwrap();
        fs::write(source.join("__init__.py"), "init").unwrap();
        fs::write(source.join("companion.py"), "new").unwrap();
        fs::write(source.join("stray.pyc"), "").unwrap();
        fs::write(source.join("tests/test_companion.py"), "").unwrap();
        fs::write(source.join("__pycache__/companion.cpython-311.pyc"), "").unwrap();
        let installed = dir.join("User Library/Remote Scripts/ZVID_Capture");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("companion.py"), "old").unwrap();
        fs::write(installed.join("removed.py"), "old").unwrap();

        copy_live_script(&source, &installed).unwrap();

        assert_eq!(
            fs::read_to_string(installed.join("__init__.py")).unwrap(),
            "init"
        );
        assert_eq!(
            fs::read_to_string(installed.join("companion.py")).unwrap(),
            "new",
            "reinstalling replaces the old copy"
        );
        let mut names: Vec<String> = fs::read_dir(&installed)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["__init__.py", "companion.py"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn installs_the_repository_live_script_into_a_user_library() {
        let dir = scratch("user-library");
        let flags = ["--user-library".to_string(), dir.display().to_string()];

        let installed = install_live_script(&flags).unwrap();

        assert_eq!(installed, dir.join("Remote Scripts").join(LIVE_SCRIPT));
        assert!(installed.join("__init__.py").is_file());
        assert!(installed.join("companion.py").is_file());
        assert!(install_live_script(&["--user-library".into()]).is_err());
        let missing = [
            "--user-library".to_string(),
            dir.join("missing").display().to_string(),
        ];
        assert!(install_live_script(&missing).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn defaults_the_user_library_per_os() {
        let env = |name: &str| (name == "HOME" || name == "USERPROFILE").then(|| "/home/me".into());
        assert_eq!(
            default_user_library("macos", env).unwrap(),
            Path::new("/home/me/Music/Ableton/User Library")
        );
        assert_eq!(
            default_user_library("windows", env).unwrap(),
            Path::new("/home/me/Documents/Ableton/User Library")
        );
        assert!(default_user_library("linux", env).is_err());
        assert!(default_user_library("macos", |_| None).is_err());
    }

    #[test]
    fn installers_need_a_release_build() {
        let error = bundle(false, false, true).unwrap_err();
        assert!(error.contains("--release"), "{error}");
    }

    #[test]
    fn signs_ad_hoc_or_with_the_hardened_runtime() {
        assert_eq!(codesign_args("-"), ["--force", "--sign", "-"]);
        let identity = "Developer ID Application: ZVID (TEAM123456)";
        assert_eq!(
            codesign_args(identity),
            [
                "--force",
                "--options",
                "runtime",
                "--timestamp",
                "--sign",
                identity
            ]
        );
    }

    #[test]
    fn pins_macos_bundles_to_the_system_plugin_folders() {
        let plist = component_plist(&[
            "Library/Audio/Plug-Ins/VST3/ZVID Capture.vst3".into(),
            "Library/Audio/Plug-Ins/Components/ZVID Capture.component".into(),
        ]);
        assert_eq!(plist.matches("<dict>").count(), 2);
        assert_eq!(
            plist
                .matches("<key>BundleIsRelocatable</key>\n\t\t<false/>")
                .count(),
            2
        );
        assert!(
            plist.contains(
                "<string>Library/Audio/Plug-Ins/Components/ZVID Capture.component</string>"
            )
        );
        let dirs: Vec<&str> = MACOS_PLUGIN_DIRS.iter().map(|(_, dir)| *dir).collect();
        assert_eq!(
            dirs,
            [
                "Library/Audio/Plug-Ins/VST3",
                "Library/Audio/Plug-Ins/Components"
            ]
        );
    }

    #[test]
    fn describes_the_macos_installer() {
        let xml = distribution_xml("0.1.0+c94f40e");
        assert!(xml.contains("<title>ZVID Capture</title>"));
        assert!(xml.contains(r#"<os-version min="13.0"/>"#));
        assert!(xml.contains(r#"hostArchitectures="arm64,x86_64""#));
        assert!(xml.contains(&format!(
            r#"<pkg-ref id="{PKG_IDENTIFIER}" version="0.1.0+c94f40e" onConclusion="none">zvid-capture.pkg</pkg-ref>"#
        )));
        assert!(xml.contains(r#"enable_localSystem="true""#));
        assert!(xml.contains(r#"enable_currentUserHome="false""#));
    }

    #[test]
    fn reads_notary_credentials() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| value.to_string())
            }
        };
        assert_eq!(notary_args(env(&[])), Ok(None));
        assert_eq!(
            notary_args(env(&[("ZVID_NOTARY_PROFILE", "zvid")])),
            Ok(Some(vec!["--keychain-profile".into(), "zvid".into()]))
        );
        assert_eq!(
            notary_args(env(&[
                ("ZVID_NOTARY_APPLE_ID", "me@example.com"),
                ("ZVID_NOTARY_TEAM_ID", "TEAM123456"),
                ("ZVID_NOTARY_PASSWORD", "abcd-efgh"),
            ])),
            Ok(Some(
                [
                    "--apple-id",
                    "me@example.com",
                    "--team-id",
                    "TEAM123456",
                    "--password",
                    "abcd-efgh"
                ]
                .map(String::from)
                .to_vec()
            ))
        );
        let partial = notary_args(env(&[
            ("ZVID_NOTARY_APPLE_ID", "me@example.com"),
            ("ZVID_NOTARY_PASSWORD", ""),
        ]))
        .unwrap_err();
        assert!(partial.starts_with("ZVID_NOTARY_TEAM_ID"), "{partial}");
    }

    #[test]
    fn recognizes_accepted_notarizations() {
        assert!(notarization_accepted(
            r#"{"id":"2efe2717","message":"Processing complete","status":"Accepted"}"#
        ));
        assert!(notarization_accepted("{\n  \"status\" : \"Accepted\"\n}"));
        assert!(!notarization_accepted(
            r#"{"id":"2efe2717","message":"Processing complete","status":"Invalid"}"#
        ));
        assert!(!notarization_accepted(""));
    }

    #[test]
    fn passes_every_define_the_inno_script_uses() {
        let args = iscc_args(
            "0.1.0+c94f40e-dirty",
            Path::new("target/bundle"),
            Path::new("target/installer"),
            "zvid-capture-0.1.0+c94f40e-dirty-setup",
        );
        assert!(args.contains(&"/DAppVersion=0.1.0+c94f40e-dirty".into()));
        assert!(args.contains(&"/DNumericVersion=0.1.0".into()));
        let script = fs::read_to_string(daw_root().join(INNO_SCRIPT)).unwrap();
        for arg in &args[1..] {
            let (define, _) = arg.trim_start_matches("/D").split_once('=').unwrap();
            assert!(
                script.contains(&format!("{{#{define}}}")),
                "{INNO_SCRIPT} does not use {define}"
            );
        }
        assert!(script.contains(r#"DestDir: "{commoncf64}\VST3\ZVID Capture.vst3""#));
    }

    #[test]
    fn checks_live_for_camera_entitlements() {
        let entitlements = |camera: &str| {
            format!(
                "<plist><dict>\n\t<key>com.apple.security.cs.disable-library-validation</key>\n\t<true/>\n\t<key>com.apple.security.device.camera</key>\n\t{camera}\n</dict></plist>"
            )
        };
        let info = "<dict><key>NSCameraUsageDescription</key><string>Video</string></dict>";
        assert!(live_host_problems(&entitlements("<true/>"), info).is_empty());
        assert_eq!(
            live_host_problems(&entitlements("<false/>"), "<dict/>"),
            [
                "lacks the com.apple.security.device.camera entitlement",
                "has no NSCameraUsageDescription"
            ]
        );
        assert_eq!(live_host_problems("", info).len(), 2);
    }

    #[test]
    fn repository_passes_checks() {
        assert_eq!(check(&daw_root()), Ok(()));
    }
}
