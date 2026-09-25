//! Stages the built frontend (`daw/ui/dist`) into `OUT_DIR/ui`, where
//! `include_dir!` embeds it. Without a build, a placeholder page is embedded
//! instead so the workspace still compiles; run `pnpm --dir daw/ui build`
//! first for the real UI.

use std::fs;
use std::path::{Path, PathBuf};

const PLACEHOLDER: &str = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>ZVID Capture</title></head>\n<body style=\"background:#262839;color:#eef2ff;font:14px system-ui;padding:24px\" data-zvid-placeholder>\n<p>The ZVID Capture UI was not built. Run <code>pnpm --dir daw/ui build</code> and rebuild the plugin.</p>\n</body></html>\n";

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../../ui/dist");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("ui");
    println!("cargo:rerun-if-changed={}", dist.display());

    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).unwrap();
    if dist.join("index.html").is_file() {
        copy_dir(&dist, &out);
    } else {
        println!(
            "cargo:warning=daw/ui/dist is missing; embedding a placeholder page (run `pnpm --dir daw/ui build`)"
        );
        fs::write(out.join("index.html"), PLACEHOLDER).unwrap();
    }
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}
