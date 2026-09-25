//! Diagnostic log for the control thread. Never called from `process()`.
//!
//! Lines go to stderr and, when [`LOG_ENV`] names a file, are appended to
//! that file too, since hosts such as Live don't show a plugin's stderr.

use std::fs::OpenOptions;
use std::io::Write;

pub use zvid_daw_core::LOG_ENV;

pub fn log(line: &str) {
    let line = format!("[zvid-vst3] {line}\n");
    let _ = std::io::stderr().write_all(line.as_bytes());
    if let Some(path) = std::env::var_os(LOG_ENV)
        && let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}
