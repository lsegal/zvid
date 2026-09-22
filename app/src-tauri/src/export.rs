//! macOS AAC adapter using Apple's AudioToolbox command-line frontend.
//! The temporary M4A is only an encoder transport; zvidlib writes the final MP4.
#[tauri::command]
pub async fn mux_export(
    video: Vec<u8>,
    pcm: Option<Vec<Vec<f32>>>,
    sample_rate: u32,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let audio = pcm.map(|samples| encode_aac(samples, sample_rate)).transpose()?;
        tauri::async_runtime::block_on(zvid_export_bridge::mux(video, audio))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
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
        .arg("-c")
        .arg(pcm.len().to_string())
        .arg(input).arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!("AAC encoding failed: {}", String::from_utf8_lossy(&result.stderr)));
    }
    std::fs::read(output).map_err(|e| e.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{encode_aac, mux_export};
    use std::process::Command;

    #[test]
    fn native_aac_fallback_produces_playable_mp4() {
        tauri::async_runtime::block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let video_path = directory.path().join("smoke-video-only.mp4");
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2", "-c:v", "libx265", "-preset", "ultrafast", "-bf", "0", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-use_editlist", "0", "-y"])
            .arg(&video_path)
            .status()
            .expect("ffmpeg must be installed for the macOS smoke test");
        assert!(status.success(), "failed to create the HEVC video fixture");

        let pcm: Vec<f32> = (0..96_000)
            .map(|index| ((2.0 * std::f32::consts::PI * 440.0 * index as f32) / 48_000.0).sin() * 0.36)
            .collect();
        let m4a = encode_aac(vec![pcm.clone()], 48_000).unwrap();
        let mp4a = m4a.windows(4).position(|bytes| bytes == b"mp4a").unwrap();
        eprintln!("AudioToolbox mp4a channels: {}", u16::from_be_bytes([m4a[mp4a + 20], m4a[mp4a + 21]]));
        let m4a_path = directory.path().join("audio.m4a");
        std::fs::write(&m4a_path, m4a).unwrap();
        let probe = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=channels,channel_layout,extradata", "-show_data", "-of", "json"])
            .arg(&m4a_path)
            .output()
            .unwrap();
        eprintln!("AudioToolbox M4A: {}", String::from_utf8_lossy(&probe.stdout));
        let output = mux_export(std::fs::read(&video_path).unwrap(), Some(vec![pcm]), 48_000)
            .await
            .expect("macOS AudioToolbox fallback must mux AAC with video");
        let output_path = directory.path().join("smoke-native-aac.mp4");
        std::fs::write(&output_path, output).unwrap();

        let status = Command::new("node")
            .arg("../scripts/verify-export.mjs")
            .arg(&video_path)
            .arg(&output_path)
            .status()
            .expect("node must be installed for the macOS smoke test");
        assert!(status.success(), "native AAC export failed media validation");
        });
    }
}
