//! The embedded frontend served at `zvid://app/*`. Everything the page needs,
//! fonts included, is compiled into the plugin; nothing loads from the
//! network.

use include_dir::{Dir, include_dir};

static UI: Dir<'static> = include_dir!("$OUT_DIR/ui");

/// An embedded file and its `Content-Type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Asset {
    pub bytes: &'static [u8],
    pub mime: &'static str,
}

/// Looks up an asset by URL path. The root and extension-less paths fall
/// back to `index.html`.
pub fn asset(path: &str) -> Option<Asset> {
    let path = path.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if path.split('/').any(|part| part == "..") {
        return None;
    }
    match UI.get_file(path) {
        Some(file) => Some(Asset {
            bytes: file.contents(),
            mime: mime_for(path),
        }),
        None if !path.rsplit('/').next().unwrap_or("").contains('.') => asset("index.html"),
        None => None,
    }
}

/// True when the frontend was not built and a placeholder page is embedded.
pub fn is_placeholder() -> bool {
    asset("index.html").is_some_and(|index| {
        std::str::from_utf8(index.bytes).is_ok_and(|html| html.contains("data-zvid-placeholder"))
    })
}

pub fn mime_for(path: &str) -> &'static str {
    let extension = path.rsplit_once('.').map_or("", |(_, ext)| ext);
    match extension.to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_index_for_the_root_and_routes() {
        let index = asset("/").unwrap();
        assert_eq!(index.mime, "text/html; charset=utf-8");
        assert_eq!(asset("index.html"), Some(index));
        assert_eq!(asset("/takes"), Some(index));
        assert_eq!(asset("/missing.js"), None);
        assert_eq!(asset("/../Cargo.toml"), None);
    }

    #[test]
    fn maps_mime_types() {
        assert_eq!(
            mime_for("assets/app-1.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_for("a.CSS"), "text/css; charset=utf-8");
        assert_eq!(mime_for("fonts/x.woff2"), "font/woff2");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }

    #[test]
    fn built_ui_bundles_its_assets_locally() {
        if is_placeholder() {
            return;
        }
        let html = std::str::from_utf8(asset("index.html").unwrap().bytes).unwrap();
        assert!(!html.contains("http://") && !html.contains("https://"));
        let mut files = Vec::new();
        collect(&UI, &mut files);
        assert!(files.iter().any(|path| path.ends_with(".woff2")));
        for path in files.iter().filter(|path| path.ends_with(".css")) {
            let css = std::str::from_utf8(asset(path).unwrap().bytes).unwrap();
            assert!(!css.contains("url(http"), "{path} loads from the network");
        }
    }

    fn collect(dir: &Dir<'static>, files: &mut Vec<String>) {
        for file in dir.files() {
            files.push(file.path().to_string_lossy().replace('\\', "/"));
        }
        for sub in dir.dirs() {
            collect(sub, files);
        }
    }
}
