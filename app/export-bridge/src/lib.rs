//! Container bridge for platform-encoded tracks: H.264/HEVC/AV1 with AAC
//! into MP4, and VP8/VP9 with Opus into WebM. Final sample tables, payloads,
//! gapless metadata and the MP4 cover-art thumbnail are written by zvidlib,
//! which also encodes the WebM's Opus audio.
use zvidlib::{
    AudioBuffer, AudioEncoderConfig, AudioEncoderFactory, AudioGapless, Codec, CodecProfile,
    CoverArt, CoverArtFormat, EncodedSample, EncoderConfig, Error, ErrorKind, FrameIndex, Limits,
    Mp4Demuxer, Mp4DemuxerOptions, OPUS_SAMPLE_RATE, Result, SampleRange, TrackKind, WebmDemuxer,
    WebmDemuxerOptions, WebmMuxer, native_opus_audio_encoder_factory,
};
use zvidlib::io::{MemorySink, MemorySource};
use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, message)
}

/// Remuxes the encoder's video (and optional AAC) into the final MP4. `cover`
/// is a JPEG thumbnail that file browsers show without decoding the video.
pub async fn mux(
    video: Vec<u8>,
    audio: Option<Vec<u8>>,
    cover: Option<Vec<u8>>,
) -> Result<Vec<u8>> {
    let sources = if let Some(audio) = audio {
        vec![MemorySource::new(video), MemorySource::new(audio)]
    } else {
        vec![MemorySource::new(video)]
    };
    let mut tracks = Vec::new();
    let mut configs = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        let movie = Mp4Demuxer::open(source, Mp4DemuxerOptions::default()).await?;
        for track in movie.tracks {
            if sources.len() == 2
                && ((source_index == 0 && track.kind != TrackKind::Video)
                    || (source_index == 1 && track.kind != TrackKind::Audio))
            {
                continue;
            }
            let format = match track.kind {
                TrackKind::Video => Mp4TrackFormat::Video(
                    track.dimensions.ok_or_else(|| invalid("missing video dimensions"))?,
                ),
                TrackKind::Audio => Mp4TrackFormat::Audio {
                    channels: track.channels.ok_or_else(|| invalid("missing audio channels"))?,
                },
            };
            configs.push(Mp4TrackConfig {
                encoder: EncoderConfig {
                    codec: track.codec,
                    timescale: track.timescale,
                    decoder_config: track.decoder_config.clone(),
                },
                format,
            });
            tracks.push((source_index, movie.movie_timescale, track));
        }
    }
    if tracks.iter().filter(|(_, _, t)| t.kind == TrackKind::Video).count() != 1
        || tracks.iter().filter(|(_, _, t)| t.kind == TrackKind::Audio).count() > 1
        || (sources.len() == 2 && tracks.len() != 2)
    {
        return Err(invalid("export requires one video track and at most one audio track"));
    }
    let mut output = Mp4Muxer::new(MemorySink::new(), configs, 10_000_000).await?;
    output.set_cover_art(cover.map(|data| CoverArt { format: CoverArtFormat::Jpeg, data }))?;
    for (output_index, (source_index, movie_timescale, track)) in tracks.iter().enumerate() {
        if track.kind == TrackKind::Audio {
            // The muxer's gapless values use the track clock. Reject clocks we
            // cannot preserve rather than introducing a silent A/V offset.
            if track.sample_rate != Some(track.timescale) {
                return Err(invalid("AAC sample and track clocks must match"));
            }
            let timing = track.audio_timing(*movie_timescale)?;
            if timing.track_offset != 0 {
                return Err(invalid("delayed audio tracks are not supported for export"));
            }
            output.set_audio_gapless(output_index, AudioGapless {
                priming: timing.priming,
                padding: timing.padding,
            })?;
        } else if track.edits.iter().any(|edit| edit.media_time != 0) {
            return Err(invalid("video encoder must produce a zero-origin timeline"));
        }
        for (sample_index, sample) in track.samples.iter().enumerate() {
            let mut data = vec![0; sample.size as usize];
            track.read_sample_into(&sources[*source_index], sample_index, &mut data).await?;
            output.write_sample(output_index, EncodedSample {
                data,
                dts: i64::try_from(sample.dts).map_err(|_| invalid("decode timestamp overflow"))?,
                pts: sample.pts,
                duration: sample.duration,
                is_sync: sample.is_sync,
                dependency: sample.dependency,
            }).await?;
        }
    }
    Ok(output.finish().await?.into_inner())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = muxMp4)]
pub async fn mux_mp4(
    video: Vec<u8>,
    cover: Option<Vec<u8>>,
) -> std::result::Result<Vec<u8>, wasm_bindgen::JsValue> {
    mux(video, None, cover).await.map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

/// Opus input handed to the encoder at a time, in frames: one second.
const OPUS_CHUNK_FRAMES: usize = OPUS_SAMPLE_RATE as usize;

/// Encodes interleaved 48 kHz `pcm` of `channels` channels to Opus at
/// `bitrate` bits a second with zvidlib's encoder, returning the track's
/// configuration, its packets and its gapless trim.
async fn encode_opus(
    pcm: &[f32],
    channels: u16,
    bitrate: u32,
) -> Result<(Mp4TrackConfig, Vec<EncodedSample>, AudioGapless)> {
    let config = AudioEncoderConfig {
        codec: Codec::Opus,
        profile: CodecProfile::Opus,
        sample_rate: OPUS_SAMPLE_RATE,
        channels,
        timescale: OPUS_SAMPLE_RATE,
        configuration: bitrate.to_be_bytes().to_vec(),
    };
    let limits = Limits::default();
    let mut encoder = native_opus_audio_encoder_factory().create(&config, &limits)?;
    let channel_count = usize::from(channels);
    if pcm.is_empty() || !pcm.len().is_multiple_of(channel_count) {
        return Err(invalid("Opus input must be whole frames of interleaved PCM"));
    }
    let mut samples = Vec::new();
    let mut position = 0_u64;
    for chunk in pcm.chunks(OPUS_CHUNK_FRAMES * channel_count) {
        let frames = (chunk.len() / channel_count) as u64;
        let range = SampleRange::new(position, position + frames)?;
        position += frames;
        let buffer = AudioBuffer::new(range, OPUS_SAMPLE_RATE, channels, chunk.to_vec(), &limits)?;
        samples.extend(encoder.encode(FrameIndex(0), buffer).await?);
    }
    let drain = encoder.finish().await?;
    samples.extend(drain.samples);
    let track = Mp4TrackConfig {
        encoder: encoder.config().clone(),
        format: Mp4TrackFormat::Audio { channels },
    };
    Ok((track, samples, drain.gapless))
}

/// Muxes the encoder's VP8 or VP9 video-only WebM, with `pcm` (interleaved
/// 48 kHz audio of `channels` channels) encoded to Opus at `audio_bitrate`,
/// into the final WebM.
pub async fn mux_webm(
    video: Vec<u8>,
    pcm: Option<Vec<f32>>,
    channels: u16,
    audio_bitrate: u32,
) -> Result<Vec<u8>> {
    let source = MemorySource::new(video);
    let movie = WebmDemuxer::open(&source, WebmDemuxerOptions::default()).await?;
    let [track] = movie.tracks.as_slice() else {
        return Err(invalid("WebM export requires exactly one video track"));
    };
    if track.kind != TrackKind::Video || !matches!(track.codec, Codec::Vp8 | Codec::Vp9) {
        return Err(invalid("WebM export requires VP8 or VP9 video"));
    }
    if track.samples.first().is_some_and(|sample| sample.pts != 0) {
        return Err(invalid("video encoder must produce a zero-origin timeline"));
    }
    let mut configs = vec![Mp4TrackConfig {
        encoder: EncoderConfig {
            codec: track.codec,
            timescale: track.timescale,
            decoder_config: track.decoder_config.clone(),
        },
        format: Mp4TrackFormat::Video(
            track.dimensions.ok_or_else(|| invalid("missing video dimensions"))?,
        ),
    }];
    let (audio_samples, gapless) = match pcm {
        Some(pcm) => {
            let (config, samples, gapless) = encode_opus(&pcm, channels, audio_bitrate).await?;
            configs.push(config);
            (samples, Some(gapless))
        }
        None => (Vec::new(), None),
    };
    let mut output = WebmMuxer::new(MemorySink::new(), configs, 10_000_000).await?;

    // A WebM interleaves its tracks in presentation order, so video and
    // audio are written by time, each compared on its own clock exactly.
    let mut audio_samples = audio_samples.into_iter().peekable();
    let mut previous_duration = 0;
    for (index, sample) in track.samples.iter().enumerate() {
        let video_time = i128::from(sample.pts) * i128::from(OPUS_SAMPLE_RATE);
        while let Some(next) = audio_samples
            .next_if(|audio| i128::from(audio.pts) * i128::from(track.timescale) <= video_time)
        {
            write_audio(&mut output, next, audio_samples.peek().is_none(), gapless).await?;
        }
        let mut data = vec![0; sample.size as usize];
        track.read_sample_into(&source, index, &mut data).await?;
        // A WebM's last block may carry no duration; it lasts as long as the
        // frame before it.
        let duration = if sample.duration == 0 { previous_duration } else { sample.duration };
        previous_duration = duration;
        output.write_sample(0, EncodedSample {
            data,
            dts: i64::try_from(sample.dts).map_err(|_| invalid("decode timestamp overflow"))?,
            pts: sample.pts,
            duration,
            is_sync: sample.is_sync,
            dependency: sample.dependency,
        }).await?;
    }
    while let Some(next) = audio_samples.next() {
        write_audio(&mut output, next, audio_samples.peek().is_none(), gapless).await?;
    }
    Ok(output.finish().await?.into_inner())
}

/// Writes one Opus packet to the WebM's audio track, ending the track with
/// its gapless trim after the `last` packet.
async fn write_audio(
    output: &mut WebmMuxer<MemorySink>,
    sample: EncodedSample,
    last: bool,
    gapless: Option<AudioGapless>,
) -> Result<()> {
    output.write_sample(1, sample).await?;
    if let (true, Some(gapless)) = (last, gapless) {
        output.set_audio_gapless(1, gapless)?;
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = muxWebm)]
pub async fn mux_webm_js(
    video: Vec<u8>,
    pcm: Option<Vec<f32>>,
    channels: u16,
    audio_bitrate: u32,
) -> std::result::Result<Vec<u8>, wasm_bindgen::JsValue> {
    mux_webm(video, pcm, channels, audio_bitrate)
        .await
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use futures::executor::block_on;
    use zvidlib::io::{MemorySink, MemorySource};
    use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};
    use zvidlib::{
        Codec, CoverArt, CoverArtFormat, EncodedSample, EncoderConfig, Mp4Demuxer,
        Mp4DemuxerOptions, SampleDependency, TrackKind, VideoDimensions, WebmDemuxer,
        WebmDemuxerOptions,
    };

    /// A tiny AV1 video-only MP4 like the browser encoder's output.
    fn encoder_video() -> Vec<u8> {
        encoder_video_with(Codec::Av1, vec![0, 0, 0, 12, b'a', b'v', b'1', b'C', 0x81, 0, 0, 0])
    }

    /// A tiny video-only MP4 in `codec`. The samples are filler: muxing
    /// never decodes them.
    fn encoder_video_with(codec: Codec, decoder_config: Vec<u8>) -> Vec<u8> {
        block_on(async {
            let track = Mp4TrackConfig {
                encoder: EncoderConfig {
                    codec,
                    timescale: 24,
                    decoder_config,
                },
                format: Mp4TrackFormat::Video(VideoDimensions { width: 32, height: 18 }),
            };
            let mut muxer = Mp4Muxer::new(MemorySink::new(), vec![track], 64).await.unwrap();
            for index in 0..24_u8 {
                muxer.write_sample(0, EncodedSample {
                    data: vec![index + 1; 16],
                    dts: i64::from(index),
                    pts: i64::from(index),
                    duration: 1,
                    is_sync: index == 0,
                    dependency: if index == 0 {
                        SampleDependency::INDEPENDENT
                    } else {
                        SampleDependency::DEPENDENT
                    },
                }).await.unwrap();
            }
            muxer.finish().await.unwrap().into_inner()
        })
    }

    fn cover_art(mp4: Vec<u8>) -> Option<CoverArt> {
        let source = MemorySource::new(mp4);
        block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).unwrap().cover_art
    }

    #[test]
    fn rejects_invalid_container() {
        assert!(block_on(super::mux(vec![0; 16], None, None)).is_err());
    }

    #[test]
    fn embeds_the_jpeg_cover() {
        let jpeg = vec![0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];
        let output = block_on(super::mux(encoder_video(), None, Some(jpeg.clone()))).unwrap();
        assert_eq!(cover_art(output), Some(CoverArt { format: CoverArtFormat::Jpeg, data: jpeg }));
    }

    #[test]
    fn writes_no_cover_without_one() {
        let output = block_on(super::mux(encoder_video(), None, None)).unwrap();
        assert_eq!(cover_art(output), None);
    }

    #[test]
    fn remuxes_h264_video() {
        // An avcC box as WebCodecs writes it: High profile, one SPS and PPS.
        let avcc = vec![
            0, 0, 0, 27, b'a', b'v', b'c', b'C', 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64,
            0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80,
        ];
        let output = block_on(super::mux(encoder_video_with(Codec::H264, avcc.clone()), None, None))
            .unwrap();
        let source = MemorySource::new(output);
        let movie = block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).unwrap();
        assert_eq!(movie.tracks.len(), 1);
        assert_eq!(movie.tracks[0].codec, Codec::H264);
        assert_eq!(movie.tracks[0].decoder_config, avcc);
    }

    /// A second of a stereo 440 Hz tone at 48 kHz, interleaved.
    fn tone() -> Vec<f32> {
        (0..48_000)
            .flat_map(|index| {
                let value = (2.0 * std::f32::consts::PI * 440.0 * index as f32 / 48_000.0).sin();
                [value * 0.3, value * 0.3]
            })
            .collect()
    }

    fn open_webm(bytes: Vec<u8>) -> (MemorySource, WebmDemuxer) {
        let source = MemorySource::new(bytes);
        let movie = block_on(WebmDemuxer::open(&source, WebmDemuxerOptions::default())).unwrap();
        (source, movie)
    }

    /// Muxes a 320×180 second of `codec` video from the browser's encoder
    /// with the tone, and checks the WebM has both tracks and every input
    /// sample of the audio.
    fn muxes_video_with_opus(fixture: &[u8], codec: Codec) {
        let input = open_webm(fixture.to_vec()).1;
        let output = block_on(super::mux_webm(fixture.to_vec(), Some(tone()), 2, 128_000)).unwrap();
        let (_, movie) = open_webm(output);
        assert_eq!(movie.doc_type, "webm");
        assert_eq!(movie.tracks.len(), 2);
        let video = &movie.tracks[0];
        assert_eq!((video.kind, video.codec), (TrackKind::Video, codec));
        assert_eq!(video.samples.len(), input.tracks[0].samples.len());
        let dimensions = video.dimensions.unwrap();
        assert_eq!((dimensions.width, dimensions.height), (320, 180));

        let audio = &movie.tracks[1];
        assert_eq!((audio.kind, audio.codec, audio.channels), (TrackKind::Audio, Codec::Opus, Some(2)));
        let timing = movie.audio_timing(audio.id).unwrap();
        assert_eq!(timing.priming, u32::from(audio.opus_config().unwrap().pre_skip));
        // zvidlib codes 20 ms packets, 960 samples at 48 kHz.
        let encoded = audio.samples.len() as u32 * 960;
        assert_eq!(encoded - timing.priming - timing.padding, 48_000);
    }

    #[test]
    fn muxes_vp8_video_with_opus() {
        muxes_video_with_opus(include_bytes!("../tests/fixtures/vp8-video.webm"), Codec::Vp8);
    }

    #[test]
    fn muxes_vp9_video_with_opus() {
        muxes_video_with_opus(include_bytes!("../tests/fixtures/vp9-video.webm"), Codec::Vp9);
    }

    #[test]
    fn muxes_silent_webm_without_audio() {
        let fixture = include_bytes!("../tests/fixtures/vp9-video.webm").to_vec();
        let output = block_on(super::mux_webm(fixture, None, 2, 128_000)).unwrap();
        let (_, movie) = open_webm(output);
        assert_eq!(movie.tracks.len(), 1);
        assert_eq!(movie.tracks[0].codec, Codec::Vp9);
    }

    #[test]
    fn webm_export_rejects_mp4_video() {
        assert!(block_on(super::mux_webm(encoder_video(), Some(tone()), 2, 128_000)).is_err());
    }
}
