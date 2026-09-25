//! Video and audio encoders behind one small interface each.
//!
//! Video: the platform's hardware HEVC encoder (VideoToolbox on macOS, a
//! Media Foundation HEVC encoder on Windows) first, then zvidlib's native
//! HEVC encoder, then zvidlib's native AV1 encoder. zvidlib's encoders are
//! software only and far slower than real time at camera resolutions, so
//! they are a last resort; the recorder drops what they can't keep up with.
//!
//! Audio: AAC-LC through zvidlib's AudioToolbox encoder on macOS, or the
//! Media Foundation AAC encoder on Windows.

use zvidlib::{
    AudioBuffer, AudioEncoder, AudioEncoderConfig, AudioEncoderFactory, AudioGapless, Codec,
    CodecProfile, ColorRange, CpuFrameSource, EncoderConfig, FrameIndex, FrameSource,
    HardwarePreference, Limits, Orientation, PixelFormat as ZPixelFormat, Plane, SampleRange,
    VideoDimensions, VideoEncoder, VideoEncoderConfig, VideoEncoderFactory, VideoFrame,
};

use super::block_on;
use crate::format::Rational;
use crate::frame::Frame;
use crate::preview::Converter;

/// One encoded video frame, in the order frames were submitted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedFrame {
    /// Four-byte length-prefixed NAL units (HEVC) or OBUs (AV1). Empty when
    /// the encoder dropped the frame.
    pub data: Vec<u8>,
    pub is_sync: bool,
}

impl EncodedFrame {
    /// Stands in for a frame the encoder dropped.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub const DROPPED: Self = Self {
        data: Vec::new(),
        is_sync: false,
    };
}

/// Encodes NV12 frames. Implementations must not reorder frames, so output
/// `n` is input `n` (or [`EncodedFrame::DROPPED`]).
pub trait FrameEncoder {
    /// Short description for logs and stats, like `"VideoToolbox HEVC"`.
    fn name(&self) -> &'static str;
    fn codec(&self) -> Codec;
    /// Size of the encoded picture.
    fn dimensions(&self) -> (u32, u32);
    /// The complete codec configuration box, once known. Platform encoders
    /// learn it from their first output.
    fn decoder_config(&self) -> Option<Vec<u8>>;
    fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedFrame>, String>;
    /// Flushes frames still in flight.
    fn finish(&mut self) -> Result<Vec<EncodedFrame>, String>;
}

/// Which video encoders to try.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VideoEncoderChoice {
    /// Hardware HEVC, then zvidlib HEVC, then zvidlib AV1.
    #[default]
    Auto,
    /// zvidlib's native software encoders only (HEVC, then AV1).
    Software,
    /// zvidlib's native AV1 encoder only.
    Av1,
}

/// Target bitrate for a frame size and rate: about 0.12 bits per pixel,
/// roughly 7.5 Mb/s for 1080p30.
pub fn target_bitrate(width: u32, height: u32, fps: Rational) -> u32 {
    let bits = f64::from(width) * f64::from(height) * fps.as_f64() * 0.12;
    bits.clamp(500_000.0, 60_000_000.0) as u32
}

/// An opened video encoder and why earlier candidates were skipped.
pub type Opened = (Box<dyn FrameEncoder>, Vec<String>);

/// Opens the first video encoder in `choice` that accepts this format.
/// Returns the encoder and the reasons earlier candidates were skipped.
pub fn open_video(
    width: u32,
    height: u32,
    fps: Rational,
    choice: VideoEncoderChoice,
) -> Result<Opened, Vec<String>> {
    let mut skipped = Vec::new();
    let bitrate = target_bitrate(width, height, fps);
    if choice == VideoEncoderChoice::Auto {
        match super::platform::open_hevc(width, height, fps, bitrate) {
            Ok(encoder) => return Ok((encoder, skipped)),
            Err(error) => skipped.push(format!("hardware HEVC: {error}")),
        }
    }
    if choice != VideoEncoderChoice::Av1 {
        match ZvidlibVideo::open(Codec::Hevc, width, height, fps, bitrate) {
            Ok(encoder) => return Ok((Box::new(encoder), skipped)),
            Err(error) => skipped.push(format!("zvidlib HEVC: {error}")),
        }
    }
    match ZvidlibVideo::open(Codec::Av1, width, height, fps, bitrate) {
        Ok(encoder) => Ok((Box::new(encoder), skipped)),
        Err(error) => {
            skipped.push(format!("zvidlib AV1: {error}"));
            Err(skipped)
        }
    }
}

/// zvidlib's native software encoders. HEVC takes RGBA at dimensions
/// divisible by 16 and AV1 takes 8-bit grey, so frames are centre-cropped
/// and converted.
struct ZvidlibVideo {
    encoder: Box<dyn VideoEncoder>,
    codec: Codec,
    width: u32,
    height: u32,
    next: u64,
    limits: Limits,
}

impl ZvidlibVideo {
    fn open(
        codec: Codec,
        width: u32,
        height: u32,
        fps: Rational,
        bitrate: u32,
    ) -> Result<Self, String> {
        let limits = Limits::default();
        let (width, height, profile, input_format, configuration, factory): (
            _,
            _,
            _,
            _,
            _,
            Box<dyn VideoEncoderFactory>,
        ) = match codec {
            Codec::Hevc => (
                width & !15,
                height & !15,
                CodecProfile::HevcMain,
                ZPixelFormat::Rgba8,
                bitrate.to_be_bytes().to_vec(),
                Box::new(zvidlib::native_hevc_video_encoder_factory()),
            ),
            _ => (
                width & !7,
                height & !7,
                CodecProfile::Av1Main,
                ZPixelFormat::Gray8,
                // base_q_idx: lossy at moderate quality.
                vec![120],
                Box::new(zvidlib::native_av1_video_encoder_factory()),
            ),
        };
        let dimensions = VideoDimensions::new(width, height, &limits).map_err(|e| e.to_string())?;
        let config = VideoEncoderConfig {
            codec,
            profile,
            coded_dimensions: dimensions,
            input_format,
            color_range: ColorRange::Limited,
            hardware: HardwarePreference::Prefer,
            timescale: fps.num,
            frame_duration: fps.den,
            configuration,
        };
        let encoder = factory
            .create(&config, &limits)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            encoder,
            codec,
            width,
            height,
            next: 0,
            limits,
        })
    }

    fn convert(&self, frame: &Frame) -> Result<VideoFrame, String> {
        let (w, h) = (self.width as usize, self.height as usize);
        let (sw, sh) = (frame.width as usize, frame.height as usize);
        if sw < w || sh < h {
            return Err(format!("frame is {sw}x{sh}, encoder expects {w}x{h}"));
        }
        // Even offsets keep chroma sited on the same samples.
        let (x0, y0) = (((sw - w) / 2) & !1, ((sh - h) / 2) & !1);
        let luma = frame.luma();
        let dimensions = VideoDimensions::new(self.width, self.height, &self.limits)
            .map_err(|e| e.to_string())?;
        let (format, plane) = if self.codec == Codec::Hevc {
            let convert = Converter::new(frame.color.bt709, frame.color.full_range);
            let chroma = frame.chroma();
            let mut rgba = Vec::with_capacity(w * h * 4);
            for y in y0..y0 + h {
                for x in x0..x0 + w {
                    let c = (y / 2) * sw + (x & !1);
                    let [r, g, b] = convert.rgb(
                        u32::from(luma[y * sw + x]),
                        u32::from(chroma[c]),
                        u32::from(chroma[c + 1]),
                    );
                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
            (
                ZPixelFormat::Rgba8,
                Plane {
                    data: rgba,
                    stride: w * 4,
                },
            )
        } else {
            let mut grey = Vec::with_capacity(w * h);
            for y in y0..y0 + h {
                grey.extend_from_slice(&luma[y * sw + x0..y * sw + x0 + w]);
            }
            (
                ZPixelFormat::Gray8,
                Plane {
                    data: grey,
                    stride: w,
                },
            )
        };
        VideoFrame::new(
            dimensions,
            format,
            ColorRange::Limited,
            vec![plane],
            &self.limits,
        )
        .map_err(|e| e.to_string())
    }
}

impl FrameEncoder for ZvidlibVideo {
    fn name(&self) -> &'static str {
        if self.codec == Codec::Hevc {
            "zvidlib HEVC (software)"
        } else {
            "zvidlib AV1 (software, greyscale)"
        }
    }

    fn codec(&self) -> Codec {
        self.codec
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn decoder_config(&self) -> Option<Vec<u8>> {
        Some(self.encoder.config().decoder_config.clone())
    }

    fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedFrame>, String> {
        let input = self.convert(frame)?;
        let index = FrameIndex(self.next);
        self.next += 1;
        let source = FrameSource::Cpu(CpuFrameSource {
            frame: &input,
            orientation: Orientation::TopLeft,
        });
        let samples = block_on(self.encoder.encode(index, source)).map_err(|e| e.to_string())?;
        Ok(samples.into_iter().map(to_frame).collect())
    }

    fn finish(&mut self) -> Result<Vec<EncodedFrame>, String> {
        let samples = block_on(self.encoder.finish()).map_err(|e| e.to_string())?;
        Ok(samples.into_iter().map(to_frame).collect())
    }
}

fn to_frame(sample: zvidlib::EncodedSample) -> EncodedFrame {
    EncodedFrame {
        data: sample.data,
        is_sync: sample.is_sync,
    }
}

/// Encodes interleaved `f32` PCM to AAC-LC packets of 1024 frames each.
pub trait PcmEncoder {
    fn name(&self) -> &'static str;
    /// The `esds` codec configuration box.
    fn decoder_config(&self) -> Vec<u8>;
    /// Encoder delay, in frames, to hide with an edit list while recording.
    /// The exact value comes from [`PcmEncoder::finish`].
    fn priming(&self) -> u32;
    fn encode(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String>;
    /// Flushes the encoder, returning the last packets and the exact delay
    /// and padding.
    fn finish(&mut self) -> Result<(Vec<Vec<u8>>, AudioGapless), String>;
}

/// Frames per AAC packet.
pub const AAC_FRAME: u32 = 1024;

/// Opens an AAC-LC encoder, or explains why none is available.
pub fn open_audio(sample_rate: u32, channels: u16) -> Result<Box<dyn PcmEncoder>, String> {
    let mut reasons = Vec::new();
    match ZvidlibAac::open(sample_rate, channels) {
        Ok(encoder) => return Ok(Box::new(encoder)),
        Err(error) => reasons.push(format!("zvidlib AAC: {error}")),
    }
    match super::platform::open_aac(sample_rate, channels) {
        Ok(encoder) => Ok(encoder),
        Err(error) => {
            reasons.push(format!("platform AAC: {error}"));
            Err(reasons.join("; "))
        }
    }
}

/// zvidlib's AAC encoder (AudioToolbox, macOS only).
struct ZvidlibAac {
    encoder: Box<dyn AudioEncoder>,
    sample_rate: u32,
    channels: u16,
    position: u64,
    limits: Limits,
}

impl ZvidlibAac {
    fn open(sample_rate: u32, channels: u16) -> Result<Self, String> {
        let config = AudioEncoderConfig {
            codec: Codec::Aac,
            profile: CodecProfile::AacLowComplexity,
            sample_rate,
            channels,
            timescale: sample_rate,
            configuration: Vec::new(),
        };
        let limits = Limits::default();
        let factory = zvidlib::native_aac_audio_encoder_factory();
        let support = factory.capability(&config);
        if !support.is_supported() {
            return Err(format!("{support:?}"));
        }
        let encoder = factory
            .create(&config, &limits)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            encoder,
            sample_rate,
            channels,
            position: 0,
            limits,
        })
    }
}

impl PcmEncoder for ZvidlibAac {
    fn name(&self) -> &'static str {
        "AudioToolbox AAC-LC"
    }

    fn decoder_config(&self) -> Vec<u8> {
        self.encoder.config().decoder_config.clone()
    }

    fn priming(&self) -> u32 {
        // AudioToolbox's AAC-LC encoder delay.
        2112
    }

    fn encode(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
        let frames = (interleaved.len() / usize::from(self.channels)) as u64;
        if frames == 0 {
            return Ok(Vec::new());
        }
        let range =
            SampleRange::new(self.position, self.position + frames).map_err(|e| e.to_string())?;
        self.position += frames;
        let buffer = AudioBuffer::new(
            range,
            self.sample_rate,
            self.channels,
            interleaved.to_vec(),
            &self.limits,
        )
        .map_err(|e| e.to_string())?;
        let samples =
            block_on(self.encoder.encode(FrameIndex(0), buffer)).map_err(|e| e.to_string())?;
        Ok(samples.into_iter().map(|sample| sample.data).collect())
    }

    fn finish(&mut self) -> Result<(Vec<Vec<u8>>, AudioGapless), String> {
        let drain = block_on(self.encoder.finish()).map_err(|e| e.to_string())?;
        Ok((
            drain.samples.into_iter().map(|s| s.data).collect(),
            drain.gapless,
        ))
    }
}

/// The codec configuration of an encoder, for an MP4 track.
pub fn encoder_config(codec: Codec, timescale: u32, decoder_config: Vec<u8>) -> EncoderConfig {
    EncoderConfig {
        codec,
        timescale,
        decoder_config,
    }
}
