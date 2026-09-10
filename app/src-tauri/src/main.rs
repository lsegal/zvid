#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct AppState {
  render_sessions: Mutex<HashMap<String, RenderSessionState>>,
}

#[derive(Clone)]
struct RenderSessionState {
  temp_dir: PathBuf,
  frame_rate: f64,
  audio_path: Option<String>,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaAnalysis {
  path: String,
  duration_seconds: f64,
  width: Option<u32>,
  height: Option<u32>,
  fps: Option<f64>,
  sample_rate: Option<u32>,
  channels: Option<u32>,
  has_audio: bool,
  has_video: bool,
  thumbnail_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderSession {
  session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderCompletion {
  bytes: u64,
}

#[derive(Deserialize)]
struct FfprobeOutput {
  streams: Vec<FfprobeStream>,
  format: Option<FfprobeFormat>,
}

#[derive(Deserialize)]
struct FfprobeStream {
  codec_type: Option<String>,
  width: Option<u32>,
  height: Option<u32>,
  r_frame_rate: Option<String>,
  sample_rate: Option<String>,
  channels: Option<u32>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
  duration: Option<String>,
}

fn create_media_id(file_path: &str) -> String {
  let mut hasher = Sha1::new();
  hasher.update(file_path.as_bytes());
  format!("{:x}", hasher.finalize())[..16].to_string()
}

fn normalize_media_path(file_path: &str) -> String {
  PathBuf::from(file_path.trim()).to_string_lossy().to_string()
}

fn create_temp_id(prefix: &str) -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or_default();
  format!("{prefix}-{nanos:x}")
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

fn run_command(program: &str, args: &[&OsStr]) -> Result<Vec<u8>, String> {
  let output = Command::new(program)
    .args(args)
    .output()
    .map_err(|error| format!("Failed to start {program}: {error}"))?;

  if output.status.success() {
    Ok(output.stdout)
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
      Err(format!("{program} exited with status {}", output.status))
    } else {
      Err(format!("{program} failed: {stderr}"))
    }
  }
}

fn parse_frame_rate(value: Option<&str>) -> Option<f64> {
  let raw = value?.trim();
  if raw.is_empty() {
    return None;
  }

  if let Some((numerator, denominator)) = raw.split_once('/') {
    let num = numerator.parse::<f64>().ok()?;
    let den = denominator.parse::<f64>().ok()?;
    if den.abs() < f64::EPSILON {
      return None;
    }
    return Some(num / den);
  }

  raw.parse::<f64>().ok()
}

fn generate_thumbnail_at_timestamp(path: &str, timestamp_seconds: f64) -> Option<String> {
  let mut hasher = Sha1::new();
  hasher.update(path.as_bytes());
  hasher.update(format!(":{timestamp_seconds:.3}").as_bytes());
  let thumb_name = format!("{:x}.jpg", hasher.finalize());
  let thumb_dir = std::env::temp_dir().join("zvid").join("thumbs");
  if fs::create_dir_all(&thumb_dir).is_err() {
    return None;
  }

  let output_path = thumb_dir.join(thumb_name);
  let timestamp = f64::max(timestamp_seconds, 0.0);
  let timestamp_string = format!("{timestamp:.3}");
  let filter = "scale=240:420:force_original_aspect_ratio=increase,crop=240:420";

  let args: [&OsStr; 10] = [
    OsStr::new("-y"),
    OsStr::new("-ss"),
    OsStr::new(timestamp_string.as_str()),
    OsStr::new("-i"),
    OsStr::new(path),
    OsStr::new("-frames:v"),
    OsStr::new("1"),
    OsStr::new("-vf"),
    OsStr::new(filter),
    output_path.as_os_str(),
  ];

  if run_command("ffmpeg", &args).is_ok() && output_path.exists() {
    Some(output_path.to_string_lossy().to_string())
  } else {
    None
  }
}

fn generate_thumbnail_for_media(path: &str, duration_seconds: f64) -> Option<String> {
  let timestamp = f64::min(
    f64::max(duration_seconds * 0.18, 0.1),
    f64::max(duration_seconds - 0.05, 0.1),
  );
  generate_thumbnail_at_timestamp(path, timestamp)
}

fn analyze_one_media(path: &str) -> Result<MediaAnalysis, String> {
  let probe_args: [&OsStr; 8] = [
    OsStr::new("-v"),
    OsStr::new("error"),
    OsStr::new("-show_entries"),
    OsStr::new("format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels"),
    OsStr::new("-of"),
    OsStr::new("json"),
    OsStr::new(path),
    OsStr::new(""),
  ];
  let stdout = run_command("ffprobe", &probe_args[..7])?;
  let payload: FfprobeOutput =
    serde_json::from_slice(&stdout).map_err(|error| format!("Failed to parse ffprobe output: {error}"))?;

  let duration_seconds = payload
    .format
    .and_then(|format| format.duration)
    .and_then(|value| value.parse::<f64>().ok())
    .unwrap_or(0.0);

  let video_stream = payload
    .streams
    .iter()
    .find(|stream| matches!(stream.codec_type.as_deref(), Some("video")));
  let audio_stream = payload
    .streams
    .iter()
    .find(|stream| matches!(stream.codec_type.as_deref(), Some("audio")));

  Ok(MediaAnalysis {
    path: path.to_string(),
    duration_seconds,
    width: video_stream.and_then(|stream| stream.width),
    height: video_stream.and_then(|stream| stream.height),
    fps: parse_frame_rate(video_stream.and_then(|stream| stream.r_frame_rate.as_deref())),
    sample_rate: audio_stream
      .and_then(|stream| stream.sample_rate.as_deref())
      .and_then(|value| value.parse::<u32>().ok()),
    channels: audio_stream.and_then(|stream| stream.channels),
    has_audio: audio_stream.is_some(),
    has_video: video_stream.is_some(),
    thumbnail_path: if video_stream.is_some() {
      generate_thumbnail_for_media(path, duration_seconds)
    } else {
      None
    },
  })
}

fn cleanup_temp_dir(temp_dir: &Path) {
  let _ = fs::remove_dir_all(temp_dir);
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
fn analyze_media(paths: Vec<String>) -> Result<Vec<MediaAnalysis>, String> {
  paths
    .iter()
    .map(|path| analyze_one_media(path))
    .collect::<Result<Vec<_>, _>>()
}

#[tauri::command]
fn generate_thumbnail_at_time(path: String, time_seconds: f64) -> Result<Option<String>, String> {
  if path.trim().is_empty() {
    return Ok(None);
  }

  if !Path::new(&path).exists() {
    return Err(format!("Media path does not exist: {path}"));
  }

  Ok(generate_thumbnail_at_timestamp(&path, time_seconds))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
  fs::read(&path).map_err(|error| format!("Failed to read file bytes: {error}"))
}

#[tauri::command]
fn start_render_session(
  state: tauri::State<AppState>,
  frame_rate: f64,
  audio_path: Option<String>,
) -> Result<RenderSession, String> {
  let session_id = create_temp_id("render");
  let temp_dir = std::env::temp_dir().join("zvid").join(&session_id);
  fs::create_dir_all(&temp_dir).map_err(|error| format!("Failed to create temp render dir: {error}"))?;

  let session_state = RenderSessionState {
    temp_dir,
    frame_rate,
    audio_path,
  };

  state
    .render_sessions
    .lock()
    .map_err(|_| "Failed to lock render session state".to_string())?
    .insert(session_id.clone(), session_state);

  Ok(RenderSession { session_id })
}

#[tauri::command]
fn write_render_frame(
  state: tauri::State<AppState>,
  session_id: String,
  frame_index: u32,
  bytes: Vec<u8>,
) -> Result<(), String> {
  let temp_dir = state
    .render_sessions
    .lock()
    .map_err(|_| "Failed to lock render session state".to_string())?
    .get(&session_id)
    .map(|session| session.temp_dir.clone())
    .ok_or_else(|| format!("Unknown render session: {session_id}"))?;

  let frame_path = temp_dir.join(format!("frame_{frame_index:06}.jpg"));
  fs::write(&frame_path, bytes).map_err(|error| format!("Failed to write render frame: {error}"))
}

#[tauri::command]
fn finish_render_session(
  state: tauri::State<AppState>,
  session_id: String,
  output_path: String,
) -> Result<RenderCompletion, String> {
  let session = state
    .render_sessions
    .lock()
    .map_err(|_| "Failed to lock render session state".to_string())?
    .remove(&session_id)
    .ok_or_else(|| format!("Unknown render session: {session_id}"))?;

  let pattern = session.temp_dir.join("frame_%06d.jpg");
  let frame_rate = format!("{}", session.frame_rate);

  let mut args: Vec<&OsStr> = vec![
    OsStr::new("-y"),
    OsStr::new("-framerate"),
    OsStr::new(frame_rate.as_str()),
    OsStr::new("-i"),
    pattern.as_os_str(),
  ];

  if let Some(audio_path) = session.audio_path.as_deref() {
    if !audio_path.trim().is_empty() {
      args.push(OsStr::new("-i"));
      args.push(OsStr::new(audio_path));
    }
  }

  args.extend([
    OsStr::new("-c:v"),
    OsStr::new("libx264"),
    OsStr::new("-pix_fmt"),
    OsStr::new("yuv420p"),
  ]);

  if session.audio_path.as_deref().is_some_and(|value| !value.trim().is_empty()) {
    args.extend([
      OsStr::new("-c:a"),
      OsStr::new("aac"),
      OsStr::new("-shortest"),
    ]);
  }

  args.push(OsStr::new(&output_path));

  let result = run_command("ffmpeg", &args).map(|_| {
    let bytes = fs::metadata(&output_path).map(|metadata| metadata.len()).unwrap_or(0);
    RenderCompletion { bytes }
  });
  cleanup_temp_dir(&session.temp_dir);
  result
}

#[tauri::command]
fn cleanup_render_session(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
  let session = state
    .render_sessions
    .lock()
    .map_err(|_| "Failed to lock render session state".to_string())?
    .remove(&session_id);
  if let Some(session) = session {
    cleanup_temp_dir(&session.temp_dir);
  }
  Ok(())
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
  fs::write(&path, bytes).map_err(|error| format!("Failed to write file: {error}"))
}

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      open_session,
      analyze_media,
      generate_thumbnail_at_time,
      read_file_bytes,
      start_render_session,
      write_render_frame,
      finish_render_session,
      cleanup_render_session,
      write_file_bytes
      , export::mux_export
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
