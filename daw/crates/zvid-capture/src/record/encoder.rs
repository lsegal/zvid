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
//! Frames bigger than the recording's size limit (1080p), from a camera
//! that only offers bigger modes, are scaled down to fit with zvidlib's CPU
//! frame transfer before encoding.
//!
//! Audio: AAC-LC through zvidlib's platform AAC encoder (AudioToolbox on
//! macOS, Media Foundation on Windows). Input at a rate the encoder doesn't
//! take, like 88.2 or 96 kHz on Windows, is resampled to one it does.

use std::fmt;

use zvidlib::{
    AudioBuffer, AudioEncoder, AudioEncoderConfig, AudioEncoderFactory, AudioGapless, Codec,
    CodecImplementation, CodecProfile, ColorRange, CpuFrameDestination, CpuFrameSource,
    CpuPlaneDestination, EncodedSample, EncoderConfig, FrameDestination, FrameIndex, FrameSource,
    HardwarePreference, Limits, Orientation, PixelFormat as ZPixelFormat, Plane, SampleRange,
    TransferPolicy, VideoDimensions, VideoEncoder, VideoEncoderConfig, VideoEncoderFactory,
    VideoFrame, execute_transfer,
};

use super::block_on;
use super::resample::Resampler;
use crate::format::{FormatPreference, Rational};
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

/// Opens the first video encoder in `choice` that accepts `width`×`height`
/// frames scaled down to fit `max_size`. Returns the encoder and the
/// reasons earlier candidates were skipped.
pub fn open_video(
    width: u32,
    height: u32,
    fps: Rational,
    choice: VideoEncoderChoice,
    max_size: FormatPreference,
) -> Result<Opened, Vec<String>> {
    let (width, height) = max_size.fit_size(width, height);
    let mut skipped = Vec::new();
    let bitrate = target_bitrate(width, height, fps);
    let mut candidates = Vec::new();
    if choice == VideoEncoderChoice::Auto {
        // Platform encoders take BGRA as is, at any even size.
        candidates.push((
            HardwarePreference::Prefer,
            ZPixelFormat::Bgra8,
            width & !1,
            height & !1,
        ));
    }
    if choice != VideoEncoderChoice::Av1 {
        candidates.push((
            HardwarePreference::Avoid,
            ZPixelFormat::Rgba8,
            width & !15,
            height & !15,
        ));
    }
    candidates.push((
        HardwarePreference::Avoid,
        ZPixelFormat::Gray8,
        width & !7,
        height & !7,
    ));
    for (hardware, input_format, width, height) in candidates {
        let codec = if input_format == ZPixelFormat::Gray8 {
            Codec::Av1
        } else {
            Codec::Hevc
        };
        let opened = VideoStream::open(codec, hardware, input_format, width, height, fps, bitrate);
        match opened {
            Ok(mut encoder) => {
                encoder.max_size = max_size;
                return Ok((encoder, skipped));
            }
            Err(error) => skipped.push(format!(
                "{hardware:?} {codec:?} at {width}x{height}: {error}"
            )),
        }
    }
    Err(skipped)
}

/// A zvidlib video encoder fed from camera frames. HEVC takes BGRA or RGBA
/// and AV1 takes 8-bit gray, so frames are converted, scaled down to fit
/// `max_size`, and center-cropped to the encoder's size.
pub struct VideoStream {
    encoder: Box<dyn VideoEncoder>,
    codec: Codec,
    input_format: ZPixelFormat,
    width: u32,
    height: u32,
    frame_duration: u32,
    next: u64,
    limits: Limits,
    max_size: FormatPreference,
}

impl VideoStream {
    fn open(
        codec: Codec,
        hardware: HardwarePreference,
        input_format: ZPixelFormat,
        width: u32,
        height: u32,
        fps: Rational,
        bitrate: u32,
    ) -> Result<Self, String> {
        let limits = Limits::default();
        let (profile, configuration, factory): (_, _, Box<dyn VideoEncoderFactory>) = match codec {
            Codec::Hevc => (
                CodecProfile::HevcMain,
                bitrate.to_be_bytes().to_vec(),
                Box::new(zvidlib::native_hevc_video_encoder_factory()),
            ),
            _ => (
                CodecProfile::Av1Main,
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
            input_format,
            width,
            height,
            frame_duration: fps.den,
            next: 0,
            limits,
            max_size: FormatPreference::default(),
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

    /// Whether `width`×`height` frames fill the encoder once scaled to fit
    /// `max_size`, give or take the few pixels its size was rounded down
    /// by. Frames that don't, such as a camera turned between landscape
    /// and portrait mid-take, are letterboxed instead.
    pub fn fits(&self, width: u32, height: u32) -> bool {
        let (fit_width, fit_height) = self.max_size.fit_size(width, height);
        (self.width..self.width + 16).contains(&fit_width)
            && (self.height..self.height + 16).contains(&fit_height)
    }

    fn convert(&self, frame: &Frame) -> Result<VideoFrame, String> {
        let w = self.width as usize;
        let format = self.frame_format();
        let data = if self.fits(frame.width, frame.height) {
            self.cropped(frame)?
        } else {
            self.letterboxed(frame)?
        };
        let dimensions = VideoDimensions::new(self.width, self.height, &self.limits)
            .map_err(|e| e.to_string())?;
        let plane = Plane {
            data,
            stride: w * bytes_per_pixel(format),
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

    /// The frame scaled down to fit `max_size` and center-cropped to the
    /// encoder's size, in the encoder's input format.
    fn cropped(&self, frame: &Frame) -> Result<Vec<u8>, String> {
        let (w, h) = (self.width as usize, self.height as usize);
        let (fit_width, fit_height) = self.max_size.fit_size(frame.width, frame.height);
        let (sw, sh) = (fit_width as usize, fit_height as usize);
        // Even offsets keep chroma sited on the same samples.
        let (x0, y0) = (((sw - w) / 2) & !1, ((sh - h) / 2) & !1);
        let format = self.frame_format();
        Ok(if (fit_width, fit_height) == (frame.width, frame.height) {
            self.pixels(frame, x0, y0, w, h)
        } else {
            let (width, height) = (frame.width as usize, frame.height as usize);
            let full = self.pixels(frame, 0, 0, width & !1, height);
            let scaled = self.scale(full, frame.width & !1, frame.height, fit_width, fit_height)?;
            if (sw, sh) == (w, h) {
                scaled
            } else {
                let bytes = bytes_per_pixel(format);
                let mut cropped = Vec::with_capacity(w * h * bytes);
                for row in scaled.chunks_exact(sw * bytes).skip(y0).take(h) {
                    cropped.extend_from_slice(&row[x0 * bytes..(x0 + w) * bytes]);
                }
                cropped
            }
        })
    }

    /// The whole frame scaled to fit inside the encoder's size and centered
    /// on black, in the encoder's input format.
    fn letterboxed(&self, frame: &Frame) -> Result<Vec<u8>, String> {
        let (w, h) = (self.width as usize, self.height as usize);
        let (width, height) = (frame.width & !1, frame.height);
        let (fw, fh) = (u64::from(width), u64::from(height));
        let (ew, eh) = (u64::from(self.width), u64::from(self.height));
        if fw == 0 || fh == 0 {
            return Err(format!("frame is {width}x{height}"));
        }
        let (to_width, to_height) = if fw * eh >= fh * ew {
            (ew, fh * ew / fw)
        } else {
            (fw * eh / fh, eh)
        };
        let even = |edge: u64| (edge as u32 & !1).max(2);
        let (to_width, to_height) = (even(to_width), even(to_height));
        let full = self.pixels(frame, 0, 0, width as usize, height as usize);
        let scaled = if (to_width, to_height) == (width, height) {
            full
        } else {
            self.scale(full, width, height, to_width, to_height)?
        };
        let format = self.frame_format();
        let bytes = bytes_per_pixel(format);
        let black: &[u8] = if format == ZPixelFormat::Gray8 {
            // Video-range luma, as the camera delivers it.
            &[16]
        } else {
            &[0, 0, 0, 255]
        };
        let mut out = black.repeat(w * h);
        let (sw, sh) = (to_width as usize, to_height as usize);
        let (x0, y0) = (((w - sw) / 2) & !1, ((h - sh) / 2) & !1);
        for (row, pixels) in scaled.chunks_exact(sw * bytes).enumerate() {
            let at = ((y0 + row) * w + x0) * bytes;
            out[at..at + sw * bytes].copy_from_slice(pixels);
        }
        Ok(out)
    }

    /// The encoder's input format.
    fn frame_format(&self) -> ZPixelFormat {
        if self.codec == Codec::Hevc {
            self.input_format
        } else {
            ZPixelFormat::Gray8
        }
    }

    /// The `w`×`h` region of `frame` at (`x0`, `y0`) in the encoder's input
    /// format. `x0` and `w` are even.
    fn pixels(&self, frame: &Frame, x0: usize, y0: usize, w: usize, h: usize) -> Vec<u8> {
        if self.codec == Codec::Hevc {
            let bgra = self.input_format == ZPixelFormat::Bgra8;
            to_rgb32(frame, x0, y0, w, h, bgra)
        } else {
            let (luma, sw) = (frame.luma(), frame.width as usize);
            let mut gray = Vec::with_capacity(w * h);
            for y in y0..y0 + h {
                gray.extend_from_slice(&luma[y * sw + x0..y * sw + x0 + w]);
            }
            gray
        }
    }

    /// Scales tightly packed pixels in the encoder's input format from
    /// `width`×`height` to `to_width`×`to_height` with zvidlib.
    fn scale(
        &self,
        data: Vec<u8>,
        width: u32,
        height: u32,
        to_width: u32,
        to_height: u32,
    ) -> Result<Vec<u8>, String> {
        let format = self.frame_format();
        let bytes = bytes_per_pixel(format);
        let error =
            |e: zvidlib::Error| format!("scaling {width}x{height} to {to_width}x{to_height}: {e}");
        let source = VideoFrame::new(
            VideoDimensions::new(width, height, &self.limits).map_err(error)?,
            format,
            ColorRange::Limited,
            vec![Plane {
                data,
                stride: width as usize * bytes,
            }],
            &self.limits,
        )
        .map_err(error)?;
        let stride = to_width as usize * bytes;
        let mut scaled = vec![0; stride * to_height as usize];
        let destination = CpuFrameDestination {
            dimensions: VideoDimensions::new(to_width, to_height, &self.limits).map_err(error)?,
            pixel_format: format,
            color_range: ColorRange::Limited,
            orientation: Orientation::TopLeft,
            planes: vec![CpuPlaneDestination {
                data: &mut scaled,
                stride,
            }],
        };
        execute_transfer(
            None,
            FrameSource::Cpu(CpuFrameSource {
                frame: &source,
                orientation: Orientation::TopLeft,
            }),
            FrameDestination::Cpu(destination),
            TransferPolicy::any(),
        )
        .map_err(error)?;
        Ok(scaled)
    }
}

fn bytes_per_pixel(format: ZPixelFormat) -> usize {
    if format == ZPixelFormat::Gray8 { 1 } else { 4 }
}

/// Converts the `w`×`h` NV12 region at (`x0`, `y0`) to RGBA, or BGRA when
/// `bgra` is set. `x0` and `w` are even, so each pair of pixels shares one
/// chroma sample. This runs for every frame, so it works in fixed point.
pub(super) fn to_rgb32(
    frame: &Frame,
    x0: usize,
    y0: usize,
    w: usize,
    h: usize,
    bgra: bool,
) -> Vec<u8> {
    let tables = Tables::new(&Converter::new(frame.color.bt709, frame.color.full_range));
    let (r, b) = if bgra { (2, 0) } else { (0, 2) };
    let sw = frame.width as usize;
    let (luma, chroma) = (frame.luma(), frame.chroma());
    let mut out = vec![255; w * h * 4];
    for (row, pixels) in out.chunks_exact_mut(w * 4).enumerate() {
        let y = y0 + row;
        let luma = &luma[y * sw + x0..][..w];
        let chroma = &chroma[(y / 2) * sw + x0..][..w];
        for ((pair, luma), chroma) in pixels
            .chunks_exact_mut(8)
            .zip(luma.chunks_exact(2))
            .zip(chroma.chunks_exact(2))
        {
            let (u, v) = (usize::from(chroma[0]), usize::from(chroma[1]));
            let (dr, dg, db) = (tables.rv[v], tables.gu[u] + tables.gv[v], tables.bu[u]);
            for (pixel, &l) in pair.chunks_exact_mut(4).zip(luma) {
                let l = tables.y[usize::from(l)];
                pixel[r] = clamp_fixed(l + dr);
                pixel[1] = clamp_fixed(l + dg);
                pixel[b] = clamp_fixed(l + db);
            }
        }
    }
    out
}

/// [`Converter`]'s conversion as lookup tables with 16 fractional bits.
struct Tables {
    /// Luma, with the rounding offset folded in.
    y: [i32; 256],
    rv: [i32; 256],
    gu: [i32; 256],
    gv: [i32; 256],
    bu: [i32; 256],
}

impl Tables {
    fn new(convert: &Converter) -> Self {
        let fixed = |x: f32| (x * 65536.0).round() as i32;
        let mut tables = Self {
            y: [0; 256],
            rv: [0; 256],
            gu: [0; 256],
            gv: [0; 256],
            bu: [0; 256],
        };
        for i in 0..256 {
            let [_, gu, bu] = convert.chroma(i as u32, 128);
            let [rv, gv, _] = convert.chroma(128, i as u32);
            tables.y[i] = fixed(convert.luma(i as u32)) + (1 << 15);
            tables.rv[i] = fixed(rv);
            tables.gu[i] = fixed(gu);
            tables.gv[i] = fixed(gv);
            tables.bu[i] = fixed(bu);
        }
        tables
    }
}

fn clamp_fixed(value: i32) -> u8 {
    (value >> 16).clamp(0, 255) as u8
}

/// Frames per AAC packet.
pub const AAC_FRAME: u32 = 1024;

/// zvidlib's AAC-LC encoder, fed interleaved `f32` PCM.
pub struct AudioStream {
    encoder: Box<dyn AudioEncoder>,
    /// The encoded rate, which is the track's timescale.
    sample_rate: u32,
    channels: u16,
    position: u64,
    priming: u32,
    limits: Limits,
    /// Converts input to `sample_rate` when the encoder doesn't take the
    /// input's own rate.
    resampler: Option<Resampler>,
}

impl AudioStream {
    /// Opens an AAC-LC encoder for `sample_rate` input, resampling to
    /// [`fallback_rate`] when the encoder doesn't take `sample_rate`, or
    /// explains why none is available.
    pub fn open(sample_rate: u32, channels: u16) -> Result<Self, String> {
        let error = match Self::open_at(sample_rate, channels) {
            Ok(stream) => return Ok(stream),
            Err(error) => error,
        };
        let rate = fallback_rate(sample_rate);
        if rate == sample_rate {
            return Err(error);
        }
        let mut stream = Self::open_at(rate, channels)
            .map_err(|fallback| format!("{error}; at {rate} Hz: {fallback}"))?;
        stream.resampler = Some(Resampler::new(sample_rate, rate, channels));
        Ok(stream)
    }

    /// Opens an encoder that takes `sample_rate` input as is.
    fn open_at(sample_rate: u32, channels: u16) -> Result<Self, String> {
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
                resampler: None,
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

    /// The rate of the encoded audio, which may differ from the input's.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
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
        match &mut self.resampler {
            Some(resampler) => {
                let pcm = resampler.process(interleaved);
                self.encode_pcm(&pcm)
            }
            None => self.encode_pcm(interleaved),
        }
    }

    /// Encodes interleaved samples already at the encoder's rate.
    fn encode_pcm(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
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
        // The resampler's tail completes the input it has been given.
        let mut packets = match self.resampler.as_mut().map(Resampler::finish) {
            Some(tail) => self.encode_pcm(&tail)?,
            None => Vec::new(),
        };
        let drain = block_on(self.encoder.finish()).map_err(|e| e.to_string())?;
        packets.extend(drain.samples.into_iter().map(|s| s.data));
        Ok((packets, drain.gapless))
    }
}

/// The rate to encode `sample_rate` input at when the encoder doesn't take
/// it: 44.1 kHz for the 44.1 kHz family (88.2, 176.4 kHz, ...) and 48 kHz
/// for everything else, so common session rates resample by a whole factor.
pub fn fallback_rate(sample_rate: u32) -> u32 {
    if sample_rate.is_multiple_of(11_025) {
        44_100
    } else {
        48_000
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
