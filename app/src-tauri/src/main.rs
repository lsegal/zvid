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

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
  fs::write(&path, bytes).map_err(|error| format!("Failed to write file: {error}"))
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      open_session,
      read_file_bytes,
      write_file_bytes,
      export::mux_export
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
