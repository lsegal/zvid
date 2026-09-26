//! Where captures are written. Recordings store filenames relative to the
//! record root so a set stays portable across machines.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Which directory captures were recorded into, persisted as `recordRoot`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordRootKind {
    /// `<set dir>/Recorded/ZVID`.
    Project,
    /// `<Documents>/ZVID/Recorded`.
    #[default]
    Documents,
}

/// The resolved directory captures are written into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordRoot {
    pub kind: RecordRootKind,
    pub dir: PathBuf,
}

impl RecordRoot {
    /// Resolves the record root: `<set dir>/Recorded/ZVID` when the Live
    /// set's directory is known, else `<Documents>/ZVID/Recorded`.
    pub fn resolve(set_dir: Option<&Path>) -> Option<Self> {
        let documents =
            dirs::document_dir().or_else(|| dirs::home_dir().map(|home| home.join("Documents")));
        Self::resolve_with(set_dir, documents.as_deref())
    }

    /// [`RecordRoot::resolve`], falling back to `<temp>/ZVID/Recorded` when
    /// the OS has no Documents directory.
    pub fn resolve_or_temp(set_dir: Option<&Path>) -> Self {
        Self::resolve(set_dir).unwrap_or_else(|| Self {
            kind: RecordRootKind::Documents,
            dir: std::env::temp_dir().join("ZVID").join("Recorded"),
        })
    }

    /// The root a capture armed now records into: `<set dir>/Recorded/ZVID`
    /// when the Live set's directory is known (see
    /// [`crate::LiveStatus::set_dir`]), else `documents`, the instance's
    /// Documents root. It is chosen once per capture, so a set saved or
    /// moved mid-capture doesn't move the file.
    pub fn for_capture(set_dir: Option<&Path>, documents: &RecordRoot) -> Self {
        match set_dir {
            Some(set_dir) => Self::project(set_dir),
            None => documents.clone(),
        }
    }

    /// `<set dir>/Recorded/ZVID`.
    pub fn project(set_dir: &Path) -> Self {
        Self {
            kind: RecordRootKind::Project,
            dir: set_dir.join("Recorded").join("ZVID"),
        }
    }

    /// [`RecordRoot::resolve`] with an explicit Documents directory.
    pub fn resolve_with(set_dir: Option<&Path>, documents: Option<&Path>) -> Option<Self> {
        match (set_dir, documents) {
            (Some(set_dir), _) => Some(Self::project(set_dir)),
            (None, Some(documents)) => Some(Self {
                kind: RecordRootKind::Documents,
                dir: documents.join("ZVID").join("Recorded"),
            }),
            (None, None) => None,
        }
    }

    /// Absolute path of a stored relative filename.
    pub fn path_of(&self, filename: &str) -> PathBuf {
        self.dir.join(filename)
    }

    /// The `/`-separated filename to store for `path`, or `None` when
    /// `path` is not inside the record root.
    pub fn relative_filename(&self, path: &Path) -> Option<String> {
        let relative = path.strip_prefix(&self.dir).ok()?;
        let parts: Option<Vec<&str>> = relative
            .components()
            .map(|component| match component {
                Component::Normal(part) => part.to_str(),
                _ => None,
            })
            .collect();
        let parts = parts?;
        (!parts.is_empty()).then(|| parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_set_directory() {
        let root = RecordRoot::resolve_with(
            Some(Path::new("/music/Song Project")),
            Some(Path::new("/home/me/Documents")),
        )
        .unwrap();
        assert_eq!(root.kind, RecordRootKind::Project);
        assert_eq!(
            root.dir,
            Path::new("/music/Song Project")
                .join("Recorded")
                .join("ZVID")
        );
    }

    #[test]
    fn falls_back_to_documents() {
        let root = RecordRoot::resolve_with(None, Some(Path::new("/home/me/Documents"))).unwrap();
        assert_eq!(root.kind, RecordRootKind::Documents);
        assert_eq!(
            root.dir,
            Path::new("/home/me/Documents")
                .join("ZVID")
                .join("Recorded")
        );
        assert_eq!(RecordRoot::resolve_with(None, None), None);
    }

    #[test]
    fn resolves_documents_from_the_os() {
        let root = RecordRoot::resolve(None).expect("a Documents directory");
        assert_eq!(root.kind, RecordRootKind::Documents);
        assert!(root.dir.ends_with(Path::new("ZVID").join("Recorded")));
    }

    #[test]
    fn stores_filenames_relative_to_the_root() {
        let root = RecordRoot::resolve_with(None, Some(Path::new("/docs"))).unwrap();
        let file = root.path_of("video-01-6-24-18-47-30-0.mp4");
        assert_eq!(
            file,
            Path::new("/docs/ZVID/Recorded/video-01-6-24-18-47-30-0.mp4")
        );
        assert_eq!(
            root.relative_filename(&file).as_deref(),
            Some("video-01-6-24-18-47-30-0.mp4")
        );
        assert_eq!(
            root.relative_filename(&root.dir.join("takes").join("a.mp4"))
                .as_deref(),
            Some("takes/a.mp4")
        );
        assert_eq!(root.relative_filename(Path::new("/elsewhere/a.mp4")), None);
        assert_eq!(root.relative_filename(&root.dir), None);
    }

    #[test]
    fn serializes_kind_in_lowercase() {
        assert_eq!(
            serde_json::to_string(&RecordRootKind::Project).unwrap(),
            "\"project\""
        );
        assert_eq!(
            serde_json::to_string(&RecordRootKind::Documents).unwrap(),
            "\"documents\""
        );
    }
}
