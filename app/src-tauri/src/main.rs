#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;

use serde::Serialize;
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisteredMedia {
  id: String,
  path: String,
  name: String,
  exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionOpenPayload {
  session_name: String,
  session_path: String,
  session: serde_json::Value,
  media_refs: Vec<RegisteredMedia>,
}

fn create_media_id(file_path: &str) -> String {
  let mut hasher = Sha1::new();
  hasher.update(file_path.as_bytes());
  format!("{:x}", hasher.finalize())[..16].to_string()
}

fn normalize_media_path(file_path: &str) -> String {
  PathBuf::from(file_path.trim()).to_string_lossy().to_string()
}

fn collect_session_media(session: &serde_json::Value) -> Vec<RegisteredMedia> {
  let mut media_paths: Vec<String> = Vec::new();

  if let Some(clips) = session.get("clips").and_then(serde_json::Value::as_array) {
    for clip in clips {
      if let Some(path) = clip.get("filePath").and_then(serde_json::Value::as_str) {
        let normalized = normalize_media_path(path);
        if !normalized.is_empty() && !media_paths.iter().any(|value| value == &normalized) {
          media_paths.push(normalized);
        }
      }
    }
  }

  if let Some(path) = session.get("audioFilename").and_then(serde_json::Value::as_str) {
    let normalized = normalize_media_path(path);
    if !normalized.is_empty() && !media_paths.iter().any(|value| value == &normalized) {
      media_paths.push(normalized);
    }
  }

  media_paths
    .into_iter()
    .map(|path| RegisteredMedia {
      id: create_media_id(&path),
      name: Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone()),
      exists: Path::new(&path).exists(),
      path,
    })
    .collect()
}

#[tauri::command]
fn open_session(session_path: String) -> Result<SessionOpenPayload, String> {
  let raw = fs::read_to_string(&session_path)
    .map_err(|error| format!("Failed to read session file: {error}"))?;
  let session: serde_json::Value =
    serde_json::from_str(&raw).map_err(|error| format!("Failed to parse session JSON: {error}"))?;

  Ok(SessionOpenPayload {
    session_name: Path::new(&session_path)
      .file_name()
      .map(|value| value.to_string_lossy().to_string())
      .unwrap_or_else(|| session_path.clone()),
    media_refs: collect_session_media(&session),
    session,
    session_path,
  })
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
  fs::read(&path).map_err(|error| format!("Failed to read file bytes: {error}"))
}

// Enough of a file to sniff its format without reading all of it.
#[tauri::command]
fn read_file_prefix(path: String, length: usize) -> Result<Vec<u8>, String> {
  use std::io::Read;

  let file = fs::File::open(&path).map_err(|error| format!("Failed to read file: {error}"))?;
  let mut prefix = Vec::with_capacity(length);
  file
    .take(length as u64)
    .read_to_end(&mut prefix)
    .map_err(|error| format!("Failed to read file: {error}"))?;
  Ok(prefix)
}

#[tauri::command]
fn files_exist(paths: Vec<String>) -> Vec<bool> {
  paths.iter().map(|path| Path::new(path).is_file()).collect()
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
  fs::write(&path, bytes).map_err(|error| format!("Failed to write file: {error}"))
}

const MAX_LISTED_MEDIA_FILES: usize = 10_000;

fn is_hidden(path: &Path) -> bool {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .is_some_and(|name| name.starts_with('.'))
}

fn collect_media_files(root: &Path, extensions: &[String], limit: usize) -> Vec<String> {
  let mut found = Vec::new();
  let mut pending = vec![root.to_path_buf()];
  while let Some(dir) = pending.pop() {
    let Ok(entries) = fs::read_dir(&dir) else {
      continue;
    };
    // Symlinked folders are not followed so link cycles can't loop the walk.
    let mut entries: Vec<(PathBuf, bool)> = entries
      .flatten()
      .map(|entry| {
        let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
        (entry.path(), is_dir)
      })
      .collect();
    entries.sort();
    for (path, is_dir) in entries {
      if is_hidden(&path) {
        continue;
      }
      if is_dir {
        pending.push(path);
        continue;
      }
      let matches = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
          extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(extension))
        });
      if matches {
        found.push(path.to_string_lossy().into_owned());
        if found.len() >= limit {
          return found;
        }
      }
    }
  }
  found
}

#[tauri::command]
fn list_media_files(root: String, extensions: Vec<String>) -> Result<Vec<String>, String> {
  let root = PathBuf::from(root);
  if !root.is_dir() {
    return Err(format!("Not a folder: {}", root.display()));
  }
  Ok(collect_media_files(&root, &extensions, MAX_LISTED_MEDIA_FILES))
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      open_session,
      list_media_files,
      read_file_bytes,
      read_file_prefix,
      files_exist,
      write_file_bytes,
      export::mux_export
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  fn touch(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"").unwrap();
  }

  fn names(paths: &[String]) -> Vec<String> {
    let mut names: Vec<String> = paths
      .iter()
      .map(|path| Path::new(path).file_name().unwrap().to_string_lossy().into_owned())
      .collect();
    names.sort();
    names
  }

  #[test]
  fn lists_nested_media_and_skips_hidden_folders() {
    let root = tempfile::tempdir().unwrap();
    touch(&root.path().join("a.mp4"));
    touch(&root.path().join("notes.txt"));
    touch(&root.path().join("day1/cam/b.MOV"));
    touch(&root.path().join("day1/audio/c.wav"));
    touch(&root.path().join(".cache/hidden.mp4"));
    let extensions = vec!["mp4".to_string(), "mov".to_string(), "wav".to_string()];

    let found = collect_media_files(root.path(), &extensions, 100);

    assert_eq!(names(&found), vec!["a.mp4", "b.MOV", "c.wav"]);
    assert!(found.iter().all(|path| Path::new(path).is_absolute()));
  }

  #[test]
  fn reads_file_prefix_and_checks_files() {
    let root = tempfile::tempdir().unwrap();
    let set = root.path().join("set.als");
    fs::write(&set, [0x1f, 0x8b, 0x08, 0x00]).unwrap();
    let set_path = set.to_string_lossy().into_owned();

    assert_eq!(read_file_prefix(set_path.clone(), 2).unwrap(), vec![0x1f, 0x8b]);
    assert_eq!(read_file_prefix(set_path.clone(), 16).unwrap().len(), 4);
    assert_eq!(
      files_exist(vec![
        set_path,
        root.path().join("missing.mp4").to_string_lossy().into_owned(),
        root.path().to_string_lossy().into_owned(),
      ]),
      vec![true, false, false]
    );
  }

  #[test]
  fn caps_listed_media_files() {
    let root = tempfile::tempdir().unwrap();
    for index in 0..5 {
      touch(&root.path().join(format!("clip{index}.mp4")));
    }

    let found = collect_media_files(root.path(), &["mp4".to_string()], 3);

    assert_eq!(found.len(), 3);
  }
}
