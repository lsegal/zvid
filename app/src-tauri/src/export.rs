//! macOS AAC adapter using Apple's AudioToolbox command-line frontend.
//! The temporary M4A is only an encoder transport; zvidlib writes the final MP4.
#[tauri::command]
pub async fn mux_export(
    video: Vec<u8>,
    pcm: Option<Vec<Vec<f32>>>,
    sample_rate: u32,
) -> Result<Vec<u8>, String> {
    let audio = if let Some(pcm) = pcm {
        Some(tauri::async_runtime::spawn_blocking(move || encode_aac(pcm, sample_rate))
            .await.map_err(|e| e.to_string())??)
    } else { None };
    zvid_export_bridge::mux(video, audio).await.map_err(|e| e.to_string())
}

fn encode_aac(pcm: Vec<Vec<f32>>, sample_rate: u32) -> Result<Vec<u8>, String> {
    if !cfg!(target_os = "macos") {
        return Err("Native AAC export currently requires macOS AudioToolbox.".into());
    }
    if pcm.is_empty() || pcm.len() > 2 || ![44100, 48000].contains(&sample_rate) {
        return Err("Native AAC export requires mono/stereo PCM at 44.1 or 48 kHz.".into());
    }
    let frames = pcm[0].len();
    if frames == 0 || pcm.iter().any(|c| c.len() != frames || c.iter().any(|v| !v.is_finite())) {
        return Err("Invalid PCM audio.".into());
    }
    let size = frames.checked_mul(pcm.len()).and_then(|v| v.checked_mul(2))
        .and_then(|v| u32::try_from(v).ok()).filter(|v| *v <= u32::MAX - 36)
        .ok_or("Audio exceeds WAV size limit")?;
    let mut wav = Vec::with_capacity(size as usize + 44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(size + 36).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&(pcm.len() as u16).to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * pcm.len() as u32 * 2).to_le_bytes());
    wav.extend_from_slice(&(pcm.len() as u16 * 2).to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&size.to_le_bytes());
    for index in 0..frames {
        for channel in &pcm {
            wav.extend_from_slice(&((channel[index].clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
    }
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input = directory.path().join("input.wav");
    let output = directory.path().join("audio.m4a");
    std::fs::write(&input, wav).map_err(|e| e.to_string())?;
    let result = std::process::Command::new("/usr/bin/afconvert")
        .args(["-f", "m4af", "-d", "aac", "-b", "192000"])
        .arg(input).arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!("AAC encoding failed: {}", String::from_utf8_lossy(&result.stderr)));
    }
    std::fs::read(output).map_err(|e| e.to_string())
}
