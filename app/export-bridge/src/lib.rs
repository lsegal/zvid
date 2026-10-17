//! zvid's export encoder: canvas frames encoded to H.264/HEVC/AV1 with AAC
//! into MP4, or to VP8/VP9 with Opus into WebM. Video and AAC go through the
//! browser's `WebCodecs` encoders, driven from here; zvidlib encodes the
//! WebM's Opus audio and writes the final sample tables, payloads, gapless
//! metadata and the MP4 cover-art thumbnail.
use zvidlib::io::MemorySink;
use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};
use zvidlib::{
    AudioBuffer, AudioEncoderConfig, AudioEncoderFactory, AudioGapless, Codec, CodecProfile,
    CoverArt, CoverArtFormat, EncodedSample, Error, ErrorKind, FrameIndex, Limits,
    OPUS_SAMPLE_RATE, Result, SampleRange, WebmMuxer, native_opus_audio_encoder_factory,
};

pub mod codec;
#[cfg(target_arch = "wasm32")]
mod webcodecs;

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, message)
}

/// An encoded track: its sample entry and its samples in decode order.
pub struct EncodedTrack {
    pub config: Mp4TrackConfig,
    pub samples: Vec<EncodedSample>,
}

/// Writes the encoded video, with optional AAC audio and its gapless trim,
/// into the final MP4. `cover` is a JPEG thumbnail that file browsers show
/// without decoding the video.
pub async fn mux_mp4(
    video: EncodedTrack,
    audio: Option<(EncodedTrack, AudioGapless)>,
    cover: Option<Vec<u8>>,
) -> Result<Vec<u8>> {
    if !matches!(video.config.encoder.codec, Codec::H264 | Codec::Hevc | Codec::Av1) {
        return Err(invalid("MP4 export requires H.264, HEVC or AV1 video"));
    }
    if audio.as_ref().is_some_and(|(track, _)| track.config.encoder.codec != Codec::Aac) {
        return Err(invalid("MP4 export requires AAC audio"));
    }
    let mut configs = vec![video.config];
    if let Some((track, _)) = &audio {
        configs.push(track.config.clone());
    }
    let mut output = Mp4Muxer::new(MemorySink::new(), configs, 10_000_000).await?;
    output.set_cover_art(cover.map(|data| CoverArt { format: CoverArtFormat::Jpeg, data }))?;
    for sample in video.samples {
        output.write_sample(0, sample).await?;
    }
    if let Some((track, gapless)) = audio {
        output.set_audio_gapless(1, gapless)?;
        for sample in track.samples {
            output.write_sample(1, sample).await?;
        }
    }
    Ok(output.finish().await?.into_inner())
}

/// Opus input handed to the encoder at a time, in frames: one second.
const OPUS_CHUNK_FRAMES: usize = OPUS_SAMPLE_RATE as usize;

/// Encodes interleaved 48 kHz `pcm` of `channels` channels to Opus at
/// `bitrate` bits a second with zvidlib's encoder, returning the track and
/// its gapless trim.
async fn encode_opus(pcm: &[f32], channels: u16, bitrate: u32) -> Result<(EncodedTrack, AudioGapless)> {
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
    let config = Mp4TrackConfig {
        encoder: encoder.config().clone(),
        format: Mp4TrackFormat::Audio { channels },
    };
    Ok((EncodedTrack { config, samples }, drain.gapless))
}

/// Writes the encoded VP8 or VP9 video, with `pcm` (interleaved 48 kHz audio
/// of `channels` channels) encoded to Opus at `audio_bitrate`, into the final
/// WebM.
pub async fn mux_webm(
    video: EncodedTrack,
    pcm: Option<Vec<f32>>,
    channels: u16,
    audio_bitrate: u32,
) -> Result<Vec<u8>> {
    if !matches!(video.config.encoder.codec, Codec::Vp8 | Codec::Vp9) {
        return Err(invalid("WebM export requires VP8 or VP9 video"));
    }
    let video_timescale = video.config.encoder.timescale;
    let mut configs = vec![video.config];
    let (audio_samples, gapless) = match pcm {
        Some(pcm) => {
            let (track, gapless) = encode_opus(&pcm, channels, audio_bitrate).await?;
            configs.push(track.config);
            (track.samples, Some(gapless))
        }
        None => (Vec::new(), None),
    };
    let mut output = WebmMuxer::new(MemorySink::new(), configs, 10_000_000).await?;

    // A WebM interleaves its tracks in presentation order, so video and
    // audio are written by time, each compared on its own clock exactly.
    let mut audio_samples = audio_samples.into_iter().peekable();
    for sample in video.samples {
        let video_time = i128::from(sample.pts) * i128::from(OPUS_SAMPLE_RATE);
        while let Some(next) = audio_samples
            .next_if(|audio| i128::from(audio.pts) * i128::from(video_timescale) <= video_time)
        {
            write_audio(&mut output, next, audio_samples.peek().is_none(), gapless).await?;
        }
        output.write_sample(0, sample).await?;
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

#[cfg(test)]
mod tests {
    use super::EncodedTrack;
    use futures::executor::block_on;
    use zvidlib::io::MemorySource;
    use zvidlib::mp4::{Mp4TrackConfig, Mp4TrackFormat};
    use zvidlib::{
        AudioGapless, Codec, CoverArt, CoverArtFormat, EncodedSample, EncoderConfig, Mp4Demuxer,
        Mp4DemuxerOptions, SampleDependency, TrackKind, VideoDimensions, WebmDemuxer,
        WebmDemuxerOptions,
    };

    /// A second of 24 fps `codec` video like the encoder's output. The
    /// samples are filler: muxing never decodes them.
    fn video_track(codec: Codec, decoder_config: Vec<u8>) -> EncodedTrack {
        EncodedTrack {
            config: Mp4TrackConfig {
                encoder: EncoderConfig { codec, timescale: 24, decoder_config },
                format: Mp4TrackFormat::Video(VideoDimensions { width: 32, height: 18 }),
            },
            samples: (0..24_u8)
                .map(|index| EncodedSample {
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
                })
                .collect(),
        }
    }

    fn av1_video() -> EncodedTrack {
        video_track(Codec::Av1, vec![0, 0, 0, 12, b'a', b'v', b'1', b'C', 0x81, 0, 0, 0])
    }

    /// A second of 48 kHz stereo AAC: 47 frames of 1024 samples, trimmed by
    /// 1024 samples of priming and the rest of the last frame.
    fn aac_audio() -> (EncodedTrack, AudioGapless) {
        let track = EncodedTrack {
            config: Mp4TrackConfig {
                encoder: EncoderConfig {
                    codec: Codec::Aac,
                    timescale: 48_000,
                    decoder_config: super::codec::esds_box(&[0x11, 0x90]),
                },
                format: Mp4TrackFormat::Audio { channels: 2 },
            },
            samples: (0..48_i64)
                .map(|index| EncodedSample {
                    data: vec![0x21; 8],
                    dts: index * 1024,
                    pts: index * 1024,
                    duration: 1024,
                    is_sync: true,
                    dependency: SampleDependency::INDEPENDENT,
                })
                .collect(),
        };
        (track, AudioGapless { priming: 1024, padding: 48 * 1024 - 1024 - 48_000 })
    }

    fn open_mp4(bytes: Vec<u8>) -> Mp4Demuxer {
        let source = MemorySource::new(bytes);
        block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).unwrap()
    }

    #[test]
    fn embeds_the_jpeg_cover() {
        let jpeg = vec![0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];
        let output = block_on(super::mux_mp4(av1_video(), None, Some(jpeg.clone()))).unwrap();
        assert_eq!(open_mp4(output).cover_art, Some(CoverArt { format: CoverArtFormat::Jpeg, data: jpeg }));
    }

    #[test]
    fn writes_no_cover_without_one() {
        let output = block_on(super::mux_mp4(av1_video(), None, None)).unwrap();
        assert_eq!(open_mp4(output).cover_art, None);
    }

    #[test]
    fn muxes_h264_video() {
        // An avcC box as WebCodecs describes it: High profile, one SPS and PPS.
        let avcc = vec![
            0, 0, 0, 27, b'a', b'v', b'c', b'C', 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64,
            0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80,
        ];
        let output = block_on(super::mux_mp4(video_track(Codec::H264, avcc.clone()), None, None)).unwrap();
        let movie = open_mp4(output);
        assert_eq!(movie.tracks.len(), 1);
        assert_eq!(movie.tracks[0].codec, Codec::H264);
        assert_eq!(movie.tracks[0].decoder_config, avcc);
        assert_eq!(movie.tracks[0].samples.len(), 24);
    }

    #[test]
    fn muxes_aac_audio_with_its_gapless_trim() {
        let (audio, gapless) = aac_audio();
        let output = block_on(super::mux_mp4(av1_video(), Some((audio, gapless)), None)).unwrap();
        let movie = open_mp4(output);
        assert_eq!(movie.tracks.len(), 2);
        let audio = movie.tracks.iter().find(|track| track.kind == TrackKind::Audio).unwrap();
        assert_eq!((audio.codec, audio.channels, audio.sample_rate), (Codec::Aac, Some(2), Some(48_000)));
        assert_eq!(audio.samples.len(), 48);
        let timing = audio.audio_timing(movie.movie_timescale).unwrap();
        assert_eq!((timing.priming, timing.padding), (gapless.priming, gapless.padding));
    }

    #[test]
    fn mp4_export_rejects_webm_codecs() {
        assert!(block_on(super::mux_mp4(video_track(Codec::Vp8, Vec::new()), None, None)).is_err());
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

    /// The fixture's video track as the encoder hands it over: a 320×180
    /// second of real `WebCodecs` output.
    fn webm_video(fixture: &[u8]) -> EncodedTrack {
        let (source, movie) = open_webm(fixture.to_vec());
        let track = &movie.tracks[0];
        let samples = (0..track.samples.len())
            .map(|index| {
                let sample = &track.samples[index];
                let mut data = vec![0; sample.size as usize];
                block_on(track.read_sample_into(&source, index, &mut data)).unwrap();
                EncodedSample {
                    data,
                    dts: sample.dts as i64,
                    pts: sample.pts,
                    duration: sample.duration.max(1),
                    is_sync: sample.is_sync,
                    dependency: sample.dependency,
                }
            })
            .collect();
        EncodedTrack {
            config: Mp4TrackConfig {
                encoder: EncoderConfig {
                    codec: track.codec,
                    timescale: track.timescale,
                    decoder_config: track.decoder_config.clone(),
                },
                format: Mp4TrackFormat::Video(track.dimensions.unwrap()),
            },
            samples,
        }
    }

    /// Muxes the fixture's `codec` video with the tone, and checks the WebM
    /// has both tracks and every input sample of the audio.
    fn muxes_video_with_opus(fixture: &[u8], codec: Codec) {
        let video = webm_video(fixture);
        let frames = video.samples.len();
        let output = block_on(super::mux_webm(video, Some(tone()), 2, 128_000)).unwrap();
        let (_, movie) = open_webm(output);
        assert_eq!(movie.doc_type, "webm");
        assert_eq!(movie.tracks.len(), 2);
        let video = &movie.tracks[0];
        assert_eq!((video.kind, video.codec), (TrackKind::Video, codec));
        assert_eq!(video.samples.len(), frames);
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
        let video = webm_video(include_bytes!("../tests/fixtures/vp9-video.webm"));
        let output = block_on(super::mux_webm(video, None, 2, 128_000)).unwrap();
        let (_, movie) = open_webm(output);
        assert_eq!(movie.tracks.len(), 1);
        assert_eq!(movie.tracks[0].codec, Codec::Vp9);
    }

    #[test]
    fn webm_export_rejects_mp4_codecs() {
        assert!(block_on(super::mux_webm(av1_video(), Some(tone()), 2, 128_000)).is_err());
    }
}
