//! Workspace tasks, run with `cargo xtask <task>`.
//!
//! - `check`: fails when C/C++/Objective-C++ sources appear under `/daw`, or
//!   when the zvidlib rev drifts from `app/export-bridge`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

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
        _ => {
            eprintln!("usage: cargo xtask check");
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
    fn repository_passes_checks() {
        assert_eq!(check(&daw_root()), Ok(()));
    }
}
