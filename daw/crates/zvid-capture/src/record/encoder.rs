//! Video and audio encoding, all through zvidlib.
//!
//! Video: zvidlib's HEVC factory with [`HardwarePreference::Prefer`], which
//! picks the platform's hardware encoder (VideoToolbox on macOS; NVENC,
//! Quick Sync or AMF through Media Foundation on Windows) and falls back to
//! a software one itself. When nothing takes the camera's size, zvidlib's
//! native HEVC encoder at a size divisible by 16, then its native AV1
//! encoder, are the last resort. Those are far slower than real time at
//! camera resolutions, so the recorder drops what they can't keep up with.
//!
//! Audio: AAC-LC through zvidlib's platform AAC encoder (AudioToolbox on
//! macOS, Media Foundation on Windows).

use std::fmt;

use zvidlib::{
    AudioBuffer, AudioEncoder, AudioEncoderConfig, AudioEncoderFactory, AudioGapless, Codec,
    CodecImplementation, CodecProfile, ColorRange, CpuFrameSource, EncodedSample, EncoderConfig,
    FrameIndex, FrameSource, HardwarePreference, Limits, Orientation, PixelFormat as ZPixelFormat,
    Plane, SampleRange, VideoDimensions, VideoEncoder, VideoEncoderConfig, VideoEncoderFactory,
    VideoFrame,
};

use super::block_on;
use crate::format::Rational;
use crate::frame::Frame;
use crate::preview::Converter;

/// The encoder zvidlib created for a stream, for logs and stats.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncoderInfo {
    /// `"hevc"` or `"av1"`.
    pub codec: &'static str,
    /// zvidlib's name for the backend, like `"VideoToolbox HEVC"`. For
    /// display only; it isn't stable across platforms or drivers.
    pub backend: String,
    /// Whether zvidlib chose dedicated hardware rather than software.
    pub hardware: bool,
}

impl fmt::Display for EncoderInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let implementation = if self.hardware {
            "hardware"
        } else {
            "software"
        };
        write!(
            f,
            "{} via {} ({implementation})",
            self.codec.to_uppercase(),
            self.backend
        )
    }
}

/// One encoded video frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedFrame {
    /// Which submitted frame this is, counting from zero. Encoders may drop
    /// frames to keep up, so indexes can skip.
    pub index: u64,
    /// Four-byte length-prefixed NAL units (HEVC) or OBUs (AV1).
    pub data: Vec<u8>,
    pub is_sync: bool,
}

/// Which video encoders to try.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VideoEncoderChoice {
    /// zvidlib's pick for HEVC (hardware where there is one), then its
    /// native HEVC and AV1 encoders.
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
pub type Opened = (VideoStream, Vec<String>);

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
    let mut candidates = Vec::new();
    if choice == VideoEncoderChoice::Auto {
        // Hardware encoders take any even size.
        candidates.push((
            Codec::Hevc,
            HardwarePreference::Prefer,
            width & !1,
            height & !1,
        ));
    }
    if choice != VideoEncoderChoice::Av1 {
        candidates.push((
            Codec::Hevc,
            HardwarePreference::Avoid,
            width & !15,
            height & !15,
        ));
    }
    candidates.push((
        Codec::Av1,
        HardwarePreference::Avoid,
        width & !7,
        height & !7,
    ));
    for (codec, hardware, width, height) in candidates {
        match VideoStream::open(codec, hardware, width, height, fps, bitrate) {
            Ok(encoder) => return Ok((encoder, skipped)),
            Err(error) => skipped.push(format!(
                "{hardware:?} {codec:?} at {width}x{height}: {error}"
            )),
        }
    }
    Err(skipped)
}

/// A zvidlib video encoder fed from camera frames. HEVC takes RGBA and AV1
/// takes 8-bit grey, so frames are centre-cropped to the encoder's size and
/// converted.
pub struct VideoStream {
    encoder: Box<dyn VideoEncoder>,
    codec: Codec,
    width: u32,
    height: u32,
    frame_duration: u32,
    next: u64,
    limits: Limits,
}

impl VideoStream {
    fn open(
        codec: Codec,
        hardware: HardwarePreference,
        width: u32,
        height: u32,
        fps: Rational,
        bitrate: u32,
    ) -> Result<Self, String> {
        let limits = Limits::default();
        let (profile, input_format, configuration, factory): (
            _,
            _,
            _,
            Box<dyn VideoEncoderFactory>,
        ) = match codec {
            Codec::Hevc => (
                CodecProfile::HevcMain,
                ZPixelFormat::Rgba8,
                bitrate.to_be_bytes().to_vec(),
                Box::new(zvidlib::native_hevc_video_encoder_factory()),
            ),
            _ => (
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
            hardware,
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
            frame_duration: fps.den,
            next: 0,
            limits,
        })
    }

    /// What zvidlib chose.
    pub fn info(&self) -> EncoderInfo {
        EncoderInfo {
            codec: self.codec_name(),
            backend: self.encoder.backend_name().to_string(),
            hardware: self.encoder.implementation() == CodecImplementation::Hardware,
        }
    }

    pub fn codec(&self) -> Codec {
        self.codec
    }

    /// `"hevc"` or `"av1"`.
    pub fn codec_name(&self) -> &'static str {
        match self.codec {
            Codec::Av1 => "av1",
            _ => "hevc",
        }
    }

    /// Size of the encoded picture.
    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// The complete codec configuration box.
    pub fn decoder_config(&self) -> Vec<u8> {
        self.encoder.config().decoder_config.clone()
    }

    pub fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedFrame>, String> {
        let input = self.convert(frame)?;
        let index = FrameIndex(self.next);
        self.next += 1;
        let source = FrameSource::Cpu(CpuFrameSource {
            frame: &input,
            orientation: Orientation::TopLeft,
        });
        let samples = block_on(self.encoder.encode(index, source)).map_err(|e| e.to_string())?;
        self.frames(samples)
    }

    /// Flushes frames still in flight.
    pub fn finish(&mut self) -> Result<Vec<EncodedFrame>, String> {
        let samples = block_on(self.encoder.finish()).map_err(|e| e.to_string())?;
        self.frames(samples)
    }

    /// zvidlib times frame `n` at `n` frame durations, which says which
    /// submitted frame each sample is.
    fn frames(&self, samples: Vec<EncodedSample>) -> Result<Vec<EncodedFrame>, String> {
        samples
            .into_iter()
            .map(|sample| {
                let dts = u64::try_from(sample.dts)
                    .map_err(|_| "the video encoder returned a negative timestamp")?;
                Ok(EncodedFrame {
                    index: dts / u64::from(self.frame_duration),
                    data: sample.data,
                    is_sync: sample.is_sync,
                })
            })
            .collect()
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
            (
                ZPixelFormat::Rgba8,
                Plane {
                    data: to_rgba(frame, x0, y0, w, h),
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

/// Converts the `w`×`h` NV12 region at (`x0`, `y0`) to RGBA. `x0` and `w`
/// are even, so each pair of pixels shares one chroma sample.
pub(super) fn to_rgba(frame: &Frame, x0: usize, y0: usize, w: usize, h: usize) -> Vec<u8> {
    let convert = Converter::new(frame.color.bt709, frame.color.full_range);
    let sw = frame.width as usize;
    let (luma, chroma) = (frame.luma(), frame.chroma());
    let mut rgba = vec![255; w * h * 4];
    for (row, out) in rgba.chunks_exact_mut(w * 4).enumerate() {
        let y = y0 + row;
        let luma = &luma[y * sw + x0..][..w];
        let chroma = &chroma[(y / 2) * sw + x0..][..w];
        for ((out, luma), chroma) in out
            .chunks_exact_mut(8)
            .zip(luma.chunks_exact(2))
            .zip(chroma.chunks_exact(2))
        {
            let offsets = convert.chroma(u32::from(chroma[0]), u32::from(chroma[1]));
            out[..3].copy_from_slice(&convert.with_chroma(u32::from(luma[0]), offsets));
            out[4..7].copy_from_slice(&convert.with_chroma(u32::from(luma[1]), offsets));
        }
    }
    rgba
}

/// Frames per AAC packet.
pub const AAC_FRAME: u32 = 1024;

/// zvidlib's AAC-LC encoder, fed interleaved `f32` PCM.
pub struct AudioStream {
    encoder: Box<dyn AudioEncoder>,
    sample_rate: u32,
    channels: u16,
    position: u64,
    priming: u32,
    limits: Limits,
}

impl AudioStream {
    /// Opens an AAC-LC encoder, or explains why none is available.
    pub fn open(sample_rate: u32, channels: u16) -> Result<Self, String> {
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
        let create = || -> Result<Self, String> {
            Ok(Self {
                encoder: factory
                    .create(&config, &limits)
                    .map_err(|e| e.to_string())?,
                sample_rate,
                channels,
                position: 0,
                priming: 0,
                limits,
            })
        };
        // zvidlib reports the encoder delay when a stream finishes, but the
        // crash-safe file declares it up front, so learn it from a packet of
        // silence through a second encoder.
        let mut probe = create()?;
        probe.encode(&vec![0.0; AAC_FRAME as usize * usize::from(channels)])?;
        let priming = probe.finish()?.1.priming;
        Ok(Self {
            priming,
            ..create()?
        })
    }

    pub fn name(&self) -> &'static str {
        "zvidlib AAC-LC"
    }

    /// The `esds` codec configuration box.
    pub fn decoder_config(&self) -> Vec<u8> {
        self.encoder.config().decoder_config.clone()
    }

    /// Encoder delay, in frames, to hide with an edit list while recording.
    pub fn priming(&self) -> u32 {
        self.priming
    }

    /// Encodes interleaved samples to AAC packets of [`AAC_FRAME`] frames.
    pub fn encode(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
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

    /// Flushes the encoder, returning the last packets and zvidlib's exact
    /// delay and padding.
    pub fn finish(&mut self) -> Result<(Vec<Vec<u8>>, AudioGapless), String> {
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
