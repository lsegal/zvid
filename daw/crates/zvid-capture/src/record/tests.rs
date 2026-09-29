use std::sync::Arc;
use std::time::{Duration, Instant};

use zvid_daw_core::{LocalTime, RecordRoot};
use zvidlib::io::MemorySource;
use zvidlib::{EncoderConfig, Mp4Demuxer, Mp4DemuxerOptions, TrackKind};

use super::fmp4::tests::tempdir;
use super::*;
use crate::frame::{ColorInfo, PixelFormat, Rotation};
use crate::preview::Converter;

const AT: LocalTime = LocalTime {
    month: 6,
    day: 24,
    hour: 18,
    minute: 47,
    second: 30,
};

/// The codec configuration zvidlib's HEVC encoder declares for a size.
pub(crate) fn hevc_config(width: u32, height: u32, fps: u32) -> EncoderConfig {
    use zvidlib::*;
    let limits = Limits::default();
    let config = VideoEncoderConfig {
        codec: Codec::Hevc,
        profile: CodecProfile::HevcMain,
        coded_dimensions: VideoDimensions::new(width, height, &limits).unwrap(),
        input_format: zvidlib::PixelFormat::Rgba8,
        color_range: ColorRange::Limited,
        hardware: HardwarePreference::Avoid,
        timescale: fps,
        frame_duration: 1,
        configuration: vec![30],
    };
    native_hevc_video_encoder_factory()
        .create(&config, &limits)
        .unwrap()
        .config()
        .clone()
}

/// A moving gradient; `index` shifts it so frames differ.
fn frame(width: u32, height: u32, index: u64, pts_ms: f64) -> Arc<Frame> {
    let (w, h) = (width as usize, height as usize);
    let mut data = Vec::with_capacity(Frame::nv12_len(width, height));
    for y in 0..h {
        for x in 0..w {
            data.push(((x + y + index as usize * 3) % 200 + 20) as u8);
        }
    }
    for y in 0..h / 2 {
        for x in 0..w / 2 {
            data.extend_from_slice(&[
                (100 + (x + index as usize) % 50) as u8,
                (120 + y % 40) as u8,
            ]);
        }
    }
    Arc::new(Frame {
        width,
        height,
        format: PixelFormat::Nv12,
        color: ColorInfo::for_height(height),
        rotation: Rotation::None,
        pts: host_ms(pts_ms),
        sequence: index,
        data,
    })
}

fn host_ms(ms: f64) -> HostTime {
    HostTime::from_nanos((10_000_000_000 + (ms * 1e6).round() as i64) as u64)
}

fn config(
    root: &RecordRoot,
    audio: Option<AudioFormat>,
    choice: VideoEncoderChoice,
) -> RecordConfig {
    RecordConfig {
        root: root.clone(),
        counter: 1,
        armed_at: AT,
        fps: Rational::new(30, 1),
        audio,
        video_encoder: choice,
        max_size: FormatPreference::default(),
    }
}

fn root() -> RecordRoot {
    let documents = tempdir();
    RecordRoot::resolve_with(None, Some(&documents)).unwrap()
}

/// Queues a frame, waiting for room rather than dropping it.
fn push(recorder: &Recorder, frame: Arc<Frame>) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !recorder.push_frame(Arc::clone(&frame)) {
        assert!(Instant::now() < deadline, "the encoder stalled");
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn demux(path: &Path) -> (Mp4Demuxer, MemorySource) {
    let source = MemorySource::new(std::fs::read(path).unwrap());
    let movie = block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).unwrap();
    (movie, source)
}

#[test]
fn records_a_playable_mp4_named_by_the_core_generator() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    assert_eq!(recorder.filename(), "video-01-6-24-18-47-30-0.mp4");
    assert!(
        recorder.path().starts_with(&root.dir),
        "directories are created"
    );
    let frame_ms = 1000.0 / 30.0;
    let mut times: Vec<f64> = (0..40).map(|index| index as f64 * frame_ms + 2.0).collect();
    // A late frame, a duplicate for one slot, and a skipped slot.
    times[10] += 12.0;
    times.insert(20, times[19] + 3.0);
    times.remove(30);
    for (index, &ms) in times.iter().enumerate() {
        push(&recorder, frame(64, 48, index as u64, ms));
    }
    let recorded = recorder.stop().unwrap();

    assert_eq!(recorded.filename, "video-01-6-24-18-47-30-0.mp4");
    assert_eq!(recorded.dimensions, (64, 48));
    assert_eq!(recorded.fps, Rational::new(30, 1));
    assert_eq!(recorded.codec, "hevc");
    assert!(!recorded.has_audio);
    assert_eq!(recorded.zero, host_ms(2.0));
    assert_eq!(recorded.stats.frames_written, 39);
    assert_eq!(recorded.stats.frames_skipped, 1);
    assert_eq!(
        recorded.stats.video_encoder,
        Some(EncoderInfo {
            codec: "hevc",
            backend: "zvidlib".to_string(),
            hardware: false,
        })
    );
    assert!((recorded.duration_sec - 40.0 / 30.0).abs() < 1e-9);
    let clock = recorded.stats.frame_clock.unwrap();
    assert_eq!(clock.host_time, host_ms(times[times.len() - 1]));
    assert!((clock.file_sec - 39.0 / 30.0).abs() < 1e-9);

    let path = root.path_of(&recorded.filename);
    let (movie, _) = demux(&path);
    assert_eq!(movie.tracks.len(), 1);
    let video = &movie.tracks[0];
    assert_eq!(video.kind, TrackKind::Video);
    assert_eq!(video.timescale, 30);
    assert_eq!(video.samples.len(), 39);
    // Constant frame rate: every sample sits on the grid, and the skipped
    // slot is covered by the frame before it.
    assert_eq!(video.samples[28].dts, 28);
    assert_eq!(video.samples[28].duration, 2);
    assert_eq!(video.samples[29].dts, 30);
    assert_eq!(video.duration, 40);

    let jpeg = poster_jpeg(&path, 0.5, 32).unwrap();
    assert_eq!(&jpeg[..2], &[0xff, 0xd8]);
}

#[test]
fn records_rotated_captures_upright() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    // A landscape 64x48 sensor frame, dark on the left and bright on the
    // right, from a camera held in portrait.
    let (width, height) = (64u32, 48u32);
    let mut data = vec![128; Frame::nv12_len(width, height)];
    for row in data[..(width * height) as usize].chunks_mut(width as usize) {
        row[..32].fill(16);
        row[32..].fill(235);
    }
    for index in 0..10 {
        push(
            &recorder,
            Arc::new(Frame {
                width,
                height,
                format: PixelFormat::Nv12,
                color: ColorInfo::for_height(height),
                rotation: Rotation::Cw90,
                pts: host_ms(index as f64 * 1000.0 / 30.0),
                sequence: index,
                data: data.clone(),
            }),
        );
    }
    let recorded = recorder.stop().unwrap();
    assert_eq!(recorded.dimensions, (48, 64));

    let path = root.path_of(&recorded.filename);
    let (movie, _) = demux(&path);
    assert_eq!(
        movie.tracks[0].dimensions.map(|d| (d.width, d.height)),
        Some((48, 64))
    );
    // Turned clockwise, the bright right half is now the bottom half.
    let (w, h, rgb) = poster::poster_rgb(&path, 0.1, 64).unwrap();
    assert_eq!((w, h), (48, 64));
    let luma = |x: u32, y: u32| rgb[((y * w + x) * 3) as usize];
    for x in [4, 24, 44] {
        assert!(luma(x, 8) < 40, "top at x={x} is {}", luma(x, 8));
        assert!(luma(x, 56) > 215, "bottom at x={x} is {}", luma(x, 56));
    }
    let jpeg = poster_jpeg(&path, 0.1, 64).unwrap();
    assert_eq!(jpeg_size(&jpeg), Some((48, 64)));
}

/// File browsers thumbnail a recording from its cover art, so they need no
/// HEVC or AV1 decoder: a JPEG of the upright frame about a second in.
#[test]
fn embeds_an_upright_cover_thumbnail() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    // Three seconds of a 64x48 sensor frame, dark on the left and bright on
    // the right, from a camera held in portrait.
    let (width, height) = (64u32, 48u32);
    for index in 0..90 {
        let mut frame = Arc::unwrap_or_clone(frame(
            width,
            height,
            index,
            index as f64 * 1000.0 / 30.0,
        ));
        for row in frame.data[..(width * height) as usize].chunks_mut(width as usize) {
            row[..32].fill(16);
            row[32..].fill(235);
        }
        frame.rotation = Rotation::Cw90;
        push(&recorder, Arc::new(frame));
    }
    let recorded = recorder.stop().unwrap();
    assert_eq!(recorded.dimensions, (48, 64));
    assert!(recorded.stats.warnings.is_empty(), "{:?}", recorded.stats);

    let path = root.path_of(&recorded.filename);
    let (movie, _) = demux(&path);
    let cover = movie.cover_art.expect("the file has cover art");
    assert_eq!(cover.format, zvidlib::CoverArtFormat::Jpeg);
    // Upright: portrait, and the picture the poster decodes a second in,
    // whose upright orientation `records_rotated_captures_upright` checks.
    assert_eq!(jpeg_size(&cover.data), Some((48, 64)));
    assert_eq!(cover.data, poster_jpeg(&path, 1.0, COVER_EDGE).unwrap());
    let (_, _, rgb) = poster::poster_rgb(&path, 1.0, COVER_EDGE).unwrap();
    let luma = |x: u32, y: u32| rgb[((y * 48 + x) * 3) as usize];
    assert!(luma(24, 8) < 40 && luma(24, 56) > 215);
}

#[test]
fn sizes_the_cover_for_a_thumbnail() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    for index in 0..6 {
        push(
            &recorder,
            frame(1280, 720, index, index as f64 * 1000.0 / 30.0),
        );
    }
    let recorded = recorder.stop().unwrap();
    let path = root.path_of(&recorded.filename);
    let (movie, _) = demux(&path);
    let cover = movie.cover_art.expect("the file has cover art");
    assert_eq!(jpeg_size(&cover.data), Some((640, 360)));
    // Shorter than two seconds: the middle frame.
    assert_eq!(cover.data, poster_jpeg(&path, 0.1, COVER_EDGE).unwrap());
}

#[test]
fn picks_the_cover_a_second_in_or_mid_way() {
    assert_eq!(cover_sec(60.0), 1.0);
    assert_eq!(cover_sec(2.0), 1.0);
    assert_eq!(cover_sec(1.0), 0.5);
    assert_eq!(cover_sec(0.2), 0.1);
}

/// Finder and Quick Look make a thumbnail of a finished recording.
#[cfg(target_os = "macos")]
#[test]
fn quick_look_thumbnails_recordings() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    for index in 0..45 {
        push(
            &recorder,
            frame(64, 48, index, index as f64 * 1000.0 / 30.0),
        );
    }
    let recorded = recorder.stop().unwrap();
    let path = root.path_of(&recorded.filename);
    let out = tempdir();
    let status = std::process::Command::new("qlmanage")
        .args(["-t", "-s", "128", "-o"])
        .arg(&out)
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    let mut thumbnail = out.join(&recorded.filename).into_os_string();
    thumbnail.push(".png");
    let png = std::fs::read(&thumbnail).expect("Quick Look wrote a thumbnail");
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
}

#[test]
fn scales_frames_above_the_size_limit_down_to_fit() {
    // A camera that only offers modes above the limit: 128x96 frames, dark
    // on the left and bright on the right, recorded with a 64x48 limit that
    // stands in for 1080p.
    let (width, height) = (128u32, 96u32);
    let mut data = vec![128; Frame::nv12_len(width, height)];
    for row in data[..(width * height) as usize].chunks_mut(width as usize) {
        row[..64].fill(16);
        row[64..].fill(235);
    }
    let max_size = FormatPreference {
        max_long_edge: 64,
        max_short_edge: 48,
        ..FormatPreference::default()
    };
    for (choice, codec) in [
        (VideoEncoderChoice::Software, "hevc"),
        (VideoEncoderChoice::Av1, "av1"),
    ] {
        let root = root();
        let recorder = Recorder::start(RecordConfig {
            max_size,
            ..config(&root, None, choice)
        })
        .unwrap();
        for index in 0..10 {
            push(
                &recorder,
                Arc::new(Frame {
                    width,
                    height,
                    format: PixelFormat::Nv12,
                    color: ColorInfo::for_height(height),
                    rotation: Rotation::None,
                    pts: host_ms(index as f64 * 1000.0 / 30.0),
                    sequence: index,
                    data: data.clone(),
                }),
            );
        }
        let recorded = recorder.stop().unwrap();
        assert_eq!(recorded.codec, codec);
        assert_eq!(recorded.dimensions, (64, 48), "{codec}");
        assert_eq!(recorded.stats.frames_written, 10);

        // The whole picture is kept, not cropped: dark left, bright right.
        let path = root.path_of(&recorded.filename);
        let (w, h, rgb) = poster::poster_rgb(&path, 0.1, 64).unwrap();
        assert_eq!((w, h), (64, 48));
        let luma = |x: u32, y: u32| rgb[((y * w + x) * 3) as usize];
        for y in [4, 24, 44] {
            assert!(luma(4, y) < 40, "{codec} left at y={y} is {}", luma(4, y));
            assert!(
                luma(60, y) > 215,
                "{codec} right at y={y} is {}",
                luma(60, y)
            );
        }
    }
}

/// Width and height from a baseline JPEG's frame header.
fn jpeg_size(jpeg: &[u8]) -> Option<(u16, u16)> {
    let at = jpeg.windows(2).position(|pair| pair == [0xff, 0xc0])?;
    let field = |offset: usize| u16::from_be_bytes([jpeg[at + offset], jpeg[at + offset + 1]]);
    Some((field(7), field(5)))
}

#[test]
fn counts_collisions_and_never_overwrites() {
    let root = root();
    std::fs::create_dir_all(&root.dir).unwrap();
    std::fs::write(root.path_of("video-01-6-24-18-47-30-0.mp4"), b"keep").unwrap();
    let first = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    let second = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    assert_eq!(first.filename(), "video-01-6-24-18-47-30-1.mp4");
    assert_eq!(second.filename(), "video-01-6-24-18-47-30-2.mp4");
    assert_eq!(
        std::fs::read(root.path_of("video-01-6-24-18-47-30-0.mp4")).unwrap(),
        b"keep"
    );
}

#[test]
fn removes_the_file_when_no_frame_arrives() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    let path = recorder.path().to_path_buf();
    assert!(path.exists());
    assert!(matches!(recorder.stop(), Err(RecordError::NoFrames)));
    assert!(!path.exists());
}

#[test]
fn leaves_a_playable_file_if_the_host_dies_mid_capture() {
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Software)).unwrap();
    let path = recorder.path().to_path_buf();
    for index in 0..75 {
        push(
            &recorder,
            frame(64, 48, index, index as f64 * 1000.0 / 30.0),
        );
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    while recorder.stats().frames_written < 74 {
        assert!(Instant::now() < deadline, "the encoder stalled");
        std::thread::sleep(Duration::from_millis(5));
    }
    // Simulate a crash: the recorder never finalizes.
    std::mem::forget(recorder);
    let (movie, source) = demux(&path);
    // The cover is only added on finalize.
    assert_eq!(movie.cover_art, None);
    let video = &movie.tracks[0];
    // Two whole one-second fragments made it to disk.
    assert_eq!(video.samples.len(), 60);
    let mut data = vec![0; video.samples[59].size as usize];
    block_on(video.read_sample_into(&source, 59, &mut data)).unwrap();
    assert_eq!(
        poster_jpeg(&path, 1.9, 16)
            .map(|jpeg| jpeg[..2].to_vec())
            .unwrap(),
        [0xff, 0xd8]
    );
}

#[test]
fn records_aac_audio_in_sync_with_video() {
    records_a_click_in_sync(48_000);
}

#[test]
fn records_aac_audio_in_sync_with_video_at_96_khz() {
    records_a_click_in_sync(96_000);
}

#[test]
fn records_aac_audio_in_sync_with_video_at_88_2_khz() {
    records_a_click_in_sync(88_200);
}

/// Records a click heard 1 s after the first frame from `sample_rate` input
/// and checks it plays back 1 s into the file.
fn records_a_click_in_sync(sample_rate: u32) {
    let root = root();
    let format = AudioFormat {
        sample_rate,
        channels: 2,
    };
    // The rate the encoder writes, which may differ from the input's.
    let rate = match AudioStream::open(format.sample_rate, format.channels) {
        Ok(stream) => stream.sample_rate(),
        Err(error) => {
            // Input is resampled for the encoder, so every rate works where
            // 48 kHz does.
            assert!(
                AudioStream::open(48_000, 2).is_err(),
                "no AAC encoder for {sample_rate} Hz: {error}"
            );
            eprintln!("no AAC encoder on this machine ({error}); skipping");
            return;
        }
    };
    #[cfg(windows)]
    assert!(matches!(rate, 44_100 | 48_000), "encodes at {rate} Hz");
    let recorder =
        Recorder::start(config(&root, Some(format), VideoEncoderChoice::Software)).unwrap();
    // 10 ms blocks from 100 ms before the first frame to 2.1 s after it,
    // silent except for a 2 ms click heard exactly 1 s after the first frame.
    let block = sample_rate as usize / 100;
    for index in 0..220 {
        let start_ms = index as f64 * 10.0 - 100.0;
        let mut samples = vec![0.0; block * 2];
        if index == 110 {
            samples[..block / 5 * 2].fill(0.8);
        }
        if index == 10 {
            for frame_index in 0..60 {
                push(
                    &recorder,
                    frame(64, 48, frame_index, frame_index as f64 * 1000.0 / 30.0),
                );
            }
        }
        // This feeds audio faster than real time, so wait for room.
        let block = AudioBlock {
            host_time: Some(host_ms(start_ms)),
            samples,
        };
        while !recorder.push_audio(block.clone()) {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    let recorded = recorder.stop().unwrap();
    assert!(recorded.has_audio);
    assert_eq!(recorded.stats.audio_frames_inserted, 0);
    // The 100 ms before the first frame is cut.
    assert_eq!(
        recorded.stats.audio_frames_skipped,
        u64::from(sample_rate / 10)
    );

    let (movie, source) = demux(&root.path_of(&recorded.filename));
    assert_eq!(movie.tracks.len(), 2);
    let track = &movie.tracks[1];
    assert_eq!(track.kind, TrackKind::Audio);
    assert_eq!(track.sample_rate, Some(rate));
    let limits = zvidlib::Limits::default();
    let timing = track.audio_timing(movie.movie_timescale).unwrap();
    let packets = block_on(track.to_encoded_audio_samples(&source, &limits)).unwrap();
    let decoder = zvidlib::NativeAacDecoder::new(&track.aac_config().unwrap(), limits).unwrap();
    let mut reader =
        zvidlib::AacSampleReader::new(decoder, packets, rate, 2, timing, 2, limits).unwrap();
    // 2.1 s of audio from file time zero; the edit list rounds to 1 ms.
    let length = reader.presentation_length();
    let expected = u64::from(rate) * 21 / 10;
    assert!(
        length.abs_diff(expected) <= u64::from(rate / 1000),
        "{length} frames"
    );
    let pcm = reader
        .get_range(
            zvidlib::SampleRange::new(0, length).unwrap(),
            &zvidlib::CancellationToken::new(),
        )
        .unwrap()
        .samples;
    // The click lands at file time 1 s, give or take the codec's ringing.
    let click = pcm
        .chunks(2)
        .position(|frame| frame[0].abs() > 0.3)
        .unwrap();
    assert!(
        click.abs_diff(rate as usize) <= 16,
        "click at frame {click}"
    );
}

#[test]
fn records_with_the_platform_encoder_when_available() {
    // A small 3 s clip keeps this fast when a machine only has a software
    // encoder (CI runners have no GPU); the size is 16-aligned so every
    // encoder takes it as is.
    let (width, height) = (576, 320);
    let fps = Rational::new(30, 1);
    let (encoder, skipped) = encoder::open_video(
        width,
        height,
        fps,
        VideoEncoderChoice::Auto,
        FormatPreference::default(),
    )
    .unwrap();
    let info = encoder.info();
    eprintln!("zvidlib chose {info}");
    // VideoToolbox is always there on macOS.
    assert!(
        !cfg!(target_os = "macos") || info.hardware,
        "VideoToolbox failed: {skipped:?}"
    );
    let hardware = info.hardware;
    drop(encoder);
    let root = root();
    let recorder = Recorder::start(config(&root, None, VideoEncoderChoice::Auto)).unwrap();
    let started = Instant::now();
    for index in 0..90 {
        push(
            &recorder,
            frame(width, height, index, index as f64 * 1000.0 / 30.0),
        );
    }
    let encoded = started.elapsed();
    let recorded = recorder.stop().unwrap();
    assert_eq!(recorded.dimensions, (width, height));
    assert_eq!(recorded.stats.video_encoder, Some(info));
    assert_eq!(recorded.stats.frames_written, 90);
    // Three seconds of video must encode in well under three seconds.
    assert!(
        !hardware || encoded < Duration::from_secs(2),
        "90 frames took {encoded:?}; not real time"
    );

    let path = root.path_of(&recorded.filename);
    let (movie, _) = demux(&path);
    let video = &movie.tracks[0];
    assert_eq!(
        video.dimensions.map(|d| (d.width, d.height)),
        Some((width, height))
    );
    assert_eq!(video.samples.len(), 90);
    assert!(video.samples[0].is_sync);
    assert!(
        video.samples.iter().filter(|s| s.is_sync).count() >= 3,
        "a keyframe each second"
    );
    let jpeg = poster_jpeg(&path, 2.0, 320).unwrap();
    assert_eq!(&jpeg[..2], &[0xff, 0xd8]);

    // AVFoundation (what QuickTime plays with) must decode the file too:
    // Quick Look renders a thumbnail from a decoded frame.
    #[cfg(target_os = "macos")]
    {
        let out = tempdir();
        let status = std::process::Command::new("qlmanage")
            .args(["-t", "-s", "320", "-o"])
            .arg(&out)
            .arg(&path)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let thumbnails = std::fs::read_dir(&out).unwrap().count();
        assert_eq!(thumbnails, 1, "Quick Look could not render the recording");
    }
}

#[test]
fn maps_encoder_output_to_grid_slots_and_counts_drops() {
    // Frames 0-3 were submitted for slots 0, 1, 3 and 4.
    let mut in_flight: VecDeque<_> = [(0, 0), (1, 1), (2, 3), (3, 4)].into();
    assert_eq!(take_slot(&mut in_flight, 0), Ok((0, 0)));
    // The encoder dropped frame 1.
    assert_eq!(take_slot(&mut in_flight, 2), Ok((3, 1)));
    assert!(take_slot(&mut in_flight, 2).is_err(), "already returned");
    assert_eq!(in_flight, [(3, 4)]);
    assert_eq!(take_slot(&mut in_flight, 3), Ok((4, 0)));
    assert!(in_flight.is_empty());
}

#[test]
fn converts_nv12_to_rgba_and_bgra_with_the_frames_colour() {
    let source = frame(64, 48, 0, 0.0);
    let convert = Converter::new(source.color.bt709, source.color.full_range);
    let rgba = encoder::to_rgb32(&source, 2, 4, 60, 40, false);
    let bgra = encoder::to_rgb32(&source, 2, 4, 60, 40, true);
    assert_eq!(rgba.len(), 60 * 40 * 4);
    for (x, y) in [(0, 0), (1, 0), (59, 39), (30, 17)] {
        let (sx, sy) = (x + 2, y + 4);
        let c = (sy / 2) * 64 + (sx & !1);
        let expected = convert.rgb(
            u32::from(source.luma()[sy * 64 + sx]),
            u32::from(source.chroma()[c]),
            u32::from(source.chroma()[c + 1]),
        );
        let at = (y * 60 + x) * 4;
        // Fixed point rounds to within one of the float conversion.
        for channel in 0..3 {
            let (value, want) = (rgba[at + channel], expected[channel]);
            assert!(
                value.abs_diff(want) <= 1,
                "pixel {x},{y}: {value} vs {want}"
            );
            assert_eq!(bgra[at + 2 - channel], value);
        }
        assert_eq!((rgba[at + 3], bgra[at + 3]), (255, 255));
    }
}
