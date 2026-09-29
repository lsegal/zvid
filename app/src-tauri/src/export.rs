//! macOS AAC adapter using Apple's AudioToolbox command-line frontend.
//! The temporary M4A is only an encoder transport; zvidlib writes the final MP4.
#[tauri::command]
pub async fn mux_export(
    video: Vec<u8>,
    pcm: Option<Vec<Vec<f32>>>,
    sample_rate: u32,
    cover: Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut video = video;
        normalize_video_tail_duration(&mut video)?;
        let audio = pcm.map(|samples| encode_aac(samples, sample_rate)).transpose()?;
        tauri::async_runtime::block_on(zvid_export_bridge::mux(video, audio, cover))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn normalize_video_tail_duration(video: &mut [u8]) -> Result<(), String> {
    let moov = find_box(video, 0, video.len(), b"moov")?;
    let trak = find_box(video, moov.0, moov.1, b"trak")?;
    let mdia = find_box(video, trak.0, trak.1, b"mdia")?;
    let minf = find_box(video, mdia.0, mdia.1, b"minf")?;
    let stbl = find_box(video, minf.0, minf.1, b"stbl")?;
    let stts = find_box(video, stbl.0, stbl.1, b"stts")?;
    if stts.1 - stts.0 < 8 {
        return Err("Invalid video stts box".into());
    }
    let count = u32::from_be_bytes(video[stts.0 + 4..stts.0 + 8].try_into().unwrap()) as usize;
    let expected_end = count.checked_mul(8).and_then(|size| stts.0.checked_add(8 + size))
        .ok_or("Invalid video stts entry count")?;
    if count == 0 || expected_end != stts.1 {
        return Err("Invalid video stts entries".into());
    }
    if count < 2 {
        return Ok(());
    }
    let last = stts.1 - 8;
    let last_count = u32::from_be_bytes(video[last..last + 4].try_into().unwrap());
    let last_duration = u32::from_be_bytes(video[last + 4..last + 8].try_into().unwrap());
    if last_count == 1 && last_duration == 0 {
        let previous_duration = u32::from_be_bytes(video[last - 4..last].try_into().unwrap());
        if previous_duration == 0 {
            return Err("Video has no positive final sample duration".into());
        }
        // macOS WebView's HEVC encoder writes a zero-duration final sample.
        // Use the previous sample's duration for the final frame.
        video[last + 4..last + 8].copy_from_slice(&previous_duration.to_be_bytes());
    }
    Ok(())
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
    let mut m4a = std::fs::read(output).map_err(|e| e.to_string())?;
    // afconvert writes 2 in mp4a for mono AAC even though its AudioSpecificConfig
    // declares one channel. Align the sample entry so zvidlib can validate it.
    if pcm.len() == 1 {
        let moov = find_box(&m4a, 0, m4a.len(), b"moov")?;
        let trak = find_box(&m4a, moov.0, moov.1, b"trak")?;
        let mdia = find_box(&m4a, trak.0, trak.1, b"mdia")?;
        let minf = find_box(&m4a, mdia.0, mdia.1, b"minf")?;
        let stbl = find_box(&m4a, minf.0, minf.1, b"stbl")?;
        let stsd = find_box(&m4a, stbl.0, stbl.1, b"stsd")?;
        let entries = stsd.0.checked_add(8).filter(|start| *start <= stsd.1)
            .ok_or("Invalid AudioToolbox stsd box")?;
        let mp4a = find_box(&m4a, entries, stsd.1, b"mp4a")?;
        let offset = mp4a.0.checked_add(16).filter(|start| start + 2 <= mp4a.1)
            .ok_or("Invalid AudioToolbox mp4a box")?;
        match u16::from_be_bytes([m4a[offset], m4a[offset + 1]]) {
            1 => {}
            2 => m4a[offset..offset + 2].copy_from_slice(&1u16.to_be_bytes()),
            _ => return Err("Unexpected AudioToolbox mp4a channel count".into()),
        }
    }
    Ok(m4a)
}

fn find_box(data: &[u8], mut start: usize, end: usize, kind: &[u8; 4]) -> Result<(usize, usize), String> {
    while start.checked_add(8).is_some_and(|next| next <= end) {
        let size32 = u32::from_be_bytes(data[start..start + 4].try_into().unwrap());
        let (size, header_size) = match size32 {
            0 => (end - start, 8), // box extends to the end of its parent
            1 => {
                let header_end = start.checked_add(16).filter(|header_end| *header_end <= end)
                    .ok_or("Invalid AudioToolbox extended MP4 box header")?;
                let size64 = u64::from_be_bytes(data[start + 8..header_end].try_into().unwrap());
                (usize::try_from(size64).map_err(|_| "AudioToolbox MP4 box exceeds addressable size")?, 16)
            }
            size => (size as usize, 8),
        };
        let next = start.checked_add(size).filter(|next| size >= header_size && *next <= end)
            .ok_or("Invalid AudioToolbox MP4 box size")?;
        if &data[start + 4..start + 8] == kind {
            return Ok((start + header_size, next));
        }
        start = next;
    }
    Err(format!("Missing AudioToolbox {} box", String::from_utf8_lossy(kind)))
}

#[cfg(test)]
mod box_tests {
    use super::find_box;

    #[test]
    fn finds_regular_extended_and_parent_sized_boxes() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&12u32.to_be_bytes());
        bytes.extend_from_slice(b"free");
        bytes.extend_from_slice(&[1, 2, 3, 4]);
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(b"wide");
        bytes.extend_from_slice(&20u64.to_be_bytes());
        bytes.extend_from_slice(&[5, 6, 7, 8]);
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(b"tail");
        bytes.extend_from_slice(&[9, 10, 11, 12]);

        assert_eq!(find_box(&bytes, 0, bytes.len(), b"free").unwrap(), (8, 12));
        assert_eq!(find_box(&bytes, 12, bytes.len(), b"wide").unwrap(), (28, 32));
        assert_eq!(find_box(&bytes, 32, bytes.len(), b"tail").unwrap(), (40, 44));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::mux_export;
    use std::process::Command;

    #[test]
    fn native_aac_fallback_produces_playable_mp4() {
        tauri::async_runtime::block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let video_path = directory.path().join("encoder-video.mp4");
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2", "-c:v", "libx265", "-preset", "ultrafast", "-bf", "0", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-use_editlist", "0", "-y"])
            .arg(&video_path)
            .status()
            .expect("ffmpeg must be installed for the macOS smoke test");
        assert!(status.success(), "failed to create the HEVC video fixture");

        let cover_path = directory.path().join("cover.jpg");
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180", "-frames:v", "1", "-y"])
            .arg(&cover_path)
            .status()
            .expect("ffmpeg must be installed for the macOS smoke test");
        assert!(status.success(), "failed to create the JPEG cover fixture");
        let cover = std::fs::read(&cover_path).unwrap();

        let video = std::fs::read(&video_path).unwrap();
        let video_only = mux_export(video.clone(), None, 48_000, Some(cover.clone()))
            .await
            .expect("video-only export must mux");
        let video_only_path = directory.path().join("smoke-video-only.mp4");
        std::fs::write(&video_only_path, video_only).unwrap();

        let pcm: Vec<f32> = (0..96_000)
            .map(|index| ((2.0 * std::f32::consts::PI * 440.0 * index as f32) / 48_000.0).sin() * 0.36)
            .collect();
        let output = mux_export(video, Some(vec![pcm]), 48_000, Some(cover))
            .await
            .expect("macOS AudioToolbox fallback must mux AAC with video");
        let output_path = directory.path().join("smoke-native-aac.mp4");
        std::fs::write(&output_path, output).unwrap();

        let status = Command::new("node")
            .arg("../scripts/verify-export.mjs")
            .arg(&video_only_path)
            .arg(&output_path)
            .status()
            .expect("node must be installed for the macOS smoke test");
        assert!(status.success(), "native AAC export failed media validation");
        });
    }
}
