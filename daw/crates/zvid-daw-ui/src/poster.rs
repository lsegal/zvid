//! Take frames decoded with zvidlib and encoded as JPEG: poster frames for
//! `zvid://thumb/<id>`, and the frame-by-frame preview `zvid://frames/<id>`
//! serves to webviews that can't decode the take themselves (WebView2 plays
//! HEVC only with Microsoft's HEVC Video Extensions installed).
//!
//! Only the group of pictures holding a frame is read and decoded, so a frame
//! costs the same at the start of an hour-long capture as at its end, and
//! frames read in order reuse the decoder already walking their group.

use std::fs::File;
use std::future::Future;
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};

use zvidlib::io::{ByteSource, IoFuture};
use zvidlib::{
    CancellationToken, Codec, CodecProfile, ColorRange, EncodedVideoSample, Error, ErrorKind,
    ExactFrameReader, FrameIndex, HardwarePreference, Limits, Mp4Demuxer, Mp4DemuxerOptions,
    Mp4Track, PixelFormat, TrackKind, VideoDecoderConfig, VideoDecoderFactory, VideoDimensions,
    VideoFrame, native_av1_video_decoder_factory, native_hevc_video_decoder_factory,
};

use crate::image::{Rgba, rgba_to_jpeg};

/// Longest edge of a poster, in pixels. Cards show them at about 88 pt.
pub const POSTER_EDGE: u32 = 320;

/// Longest edge of a preview frame, in pixels. The preview modal is never
/// wider than the editor.
pub const FRAME_EDGE: u32 = 960;

/// Decodes the frame shown at `offset_sec` into the file and returns it as
/// a JPEG no larger than `max_edge` on its longest side.
pub fn poster_jpeg(path: &Path, offset_sec: f64, max_edge: u32) -> zvidlib::Result<Vec<u8>> {
    TakeFrames::open(path)?.jpeg_at(offset_sec, max_edge)
}

/// A take's video track, decoded one group of pictures at a time.
pub struct TakeFrames {
    source: FileSource,
    track: Mp4Track,
    dimensions: VideoDimensions,
    codec: Codec,
    profile: CodecProfile,
    limits: Limits,
    /// The color range that last decoded, tried first for the next group.
    color_range: Option<ColorRange>,
    /// The group being decoded: its decode-order samples and their reader.
    group: Option<(Range<usize>, ExactFrameReader)>,
}

impl TakeFrames {
    pub fn open(path: &Path) -> zvidlib::Result<Self> {
        let source = FileSource::open(path)?;
        let options = Mp4DemuxerOptions::default();
        let limits = options.limits;
        let movie = block_on(Mp4Demuxer::open(&source, options))?;
        let track = movie
            .tracks
            .into_iter()
            .find(|track| track.kind == TrackKind::Video)
            .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "the take has no video track"))?;
        let dimensions = track
            .dimensions
            .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "the video track has no size"))?;
        if track.presentation_order.is_empty() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "the video track is empty",
            ));
        }
        let (codec, profile) = match track.codec {
            Codec::Hevc => (Codec::Hevc, CodecProfile::HevcMain),
            Codec::Av1 => (Codec::Av1, CodecProfile::Av1Main),
            _ => {
                return Err(Error::new(
                    ErrorKind::Unsupported,
                    "takes need an HEVC or AV1 track",
                ));
            }
        };
        Ok(Self {
            source,
            track,
            dimensions,
            codec,
            profile,
            limits,
            color_range: None,
            group: None,
        })
    }

    /// The frame shown at `offset_sec` into the file as a JPEG no larger
    /// than `max_edge` on its longest side. Offsets past the end give the
    /// last frame.
    pub fn jpeg_at(&mut self, offset_sec: f64, max_edge: u32) -> zvidlib::Result<Vec<u8>> {
        let frame = self.frame_at(offset_sec)?;
        let plane = frame
            .planes
            .first()
            .ok_or_else(|| Error::new(ErrorKind::Codec, "the decoder returned no picture"))?;
        Ok(rgba_to_jpeg(
            Rgba {
                data: &plane.data,
                width: frame.dimensions.width,
                height: frame.dimensions.height,
                stride: plane.stride,
            },
            max_edge,
        ))
    }

    fn frame_at(&mut self, offset_sec: f64) -> zvidlib::Result<VideoFrame> {
        let target = presentation_index_at(&self.track, offset_sec);
        let decode = self.track.presentation_order[target];
        if let Some((samples, reader)) = &mut self.group
            && samples.contains(&decode)
        {
            return reader.get(FrameIndex(target as u64), &CancellationToken::new());
        }
        self.group = None;
        let (samples, encoded) = group_of_pictures(&self.track, &self.source, decode)?;
        let (reader, frame) = self.open_group(encoded, target)?;
        self.group = Some((samples, reader));
        Ok(frame)
    }

    /// Opens a reader over one group of pictures and decodes `target`.
    fn open_group(
        &mut self,
        samples: Vec<EncodedVideoSample>,
        target: usize,
    ) -> zvidlib::Result<(ExactFrameReader, VideoFrame)> {
        // AV1 carries its color range in the stream and the reader insists
        // the output matches the configuration, so try the capture default
        // first, or whichever range the last group decoded with.
        let ranges: &[ColorRange] = match (self.codec, self.color_range) {
            (Codec::Av1, Some(ColorRange::Full)) => &[ColorRange::Full, ColorRange::Limited],
            (Codec::Av1, _) => &[ColorRange::Limited, ColorRange::Full],
            _ => &[ColorRange::Limited],
        };
        // Factories aren't `Send`, so each group makes its own.
        let factory: Box<dyn VideoDecoderFactory> = match self.codec {
            Codec::Av1 => Box::new(native_av1_video_decoder_factory()),
            _ => Box::new(native_hevc_video_decoder_factory()),
        };
        let mut result = Err(Error::new(ErrorKind::Codec, "no color range to try"));
        for &color_range in ranges {
            let configuration = VideoDecoderConfig {
                codec: self.codec,
                profile: self.profile,
                coded_dimensions: self.dimensions,
                output_format: PixelFormat::Rgba8,
                color_range,
                hardware: HardwarePreference::Prefer,
                configuration: self.track.decoder_config.clone(),
            };
            result = ExactFrameReader::new(
                factory.as_ref(),
                configuration,
                samples.clone(),
                self.limits,
            )
            .and_then(|mut reader| {
                let frame = reader.get(FrameIndex(target as u64), &CancellationToken::new())?;
                Ok((reader, frame))
            });
            match &result {
                Err(error) if error.kind() == ErrorKind::MalformedMedia => continue,
                Ok(_) => self.color_range = Some(color_range),
                Err(_) => {}
            }
            break;
        }
        result
    }
}

/// The presentation index of the frame on screen at `offset_sec`. The track
/// must not be empty.
fn presentation_index_at(track: &Mp4Track, offset_sec: f64) -> usize {
    let first_pts = track.samples[track.presentation_order[0]].pts;
    let target = first_pts + (offset_sec.max(0.0) * f64::from(track.timescale)).round() as i64;
    let after = track
        .presentation_order
        .partition_point(|&decode| track.samples[decode].pts <= target);
    after.saturating_sub(1)
}

/// The group of pictures holding decode-order sample `decode`: its
/// decode-order range, from the random-access point at or before it up to
/// the next one, and its samples keyed by presentation index.
fn group_of_pictures(
    track: &Mp4Track,
    source: &FileSource,
    decode: usize,
) -> zvidlib::Result<(Range<usize>, Vec<EncodedVideoSample>)> {
    let mut presentation_by_decode = vec![0_usize; track.samples.len()];
    for (presentation, &decode) in track.presentation_order.iter().enumerate() {
        presentation_by_decode[decode] = presentation;
    }
    let start = (0..=decode)
        .rev()
        .find(|&index| track.samples[index].is_sync)
        .unwrap_or(0);
    let end = (decode + 1..track.samples.len())
        .find(|&index| track.samples[index].is_sync)
        .unwrap_or(track.samples.len());
    let samples = (start..end)
        .map(|index| {
            let mut data = vec![0_u8; track.samples[index].size as usize];
            block_on(track.read_sample_into(source, index, &mut data))?;
            Ok(EncodedVideoSample {
                presentation_index: FrameIndex(presentation_by_decode[index] as u64),
                // The reader needs a random-access first sample; files from
                // encoders that don't flag sync samples still start with one.
                random_access: index == start || track.samples[index].is_sync,
                data,
            })
        })
        .collect::<zvidlib::Result<_>>()?;
    Ok((start..end, samples))
}

/// A take file as a zvidlib byte source.
struct FileSource {
    file: Mutex<File>,
    len: u64,
}

impl FileSource {
    fn open(path: &Path) -> zvidlib::Result<Self> {
        let file = File::open(path).map_err(io_error)?;
        let len = file.metadata().map_err(io_error)?.len();
        Ok(Self {
            file: Mutex::new(file),
            len,
        })
    }
}

impl ByteSource for FileSource {
    fn len(&self) -> Option<u64> {
        Some(self.len)
    }

    fn read_at<'a>(&'a self, offset: u64, destination: &'a mut [u8]) -> IoFuture<'a, usize> {
        Box::pin(async move {
            let mut file = self.file.lock().unwrap_or_else(|error| error.into_inner());
            file.seek(SeekFrom::Start(offset)).map_err(io_error)?;
            file.read(destination).map_err(io_error)
        })
    }
}

fn io_error(error: std::io::Error) -> Error {
    Error::new(ErrorKind::Io, error.to_string())
}

/// Drives a future whose I/O completes synchronously, as [`FileSource`]'s does.
fn block_on<T>(future: impl Future<Output = T>) -> T {
    let mut context = Context::from_waker(Waker::noop());
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::yield_now();
    }
}

/// Writes a short synthetic AV1 MP4 whose frames get brighter over time.
/// Used by tests and the harness, which have no camera recordings.
pub fn write_test_clip(
    path: &Path,
    width: u32,
    height: u32,
    frames: u64,
    fps: u32,
) -> zvidlib::Result<()> {
    use zvidlib::io::MemorySink;
    use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};
    use zvidlib::{
        CpuFrameSource, FrameSource, Orientation, Plane, VideoDimensions, VideoEncoderConfig,
        VideoEncoderFactory, VideoFrame, native_av1_video_encoder_factory,
    };

    let limits = Limits::default();
    let dimensions = VideoDimensions::new(width, height, &limits)?;
    let configuration = VideoEncoderConfig {
        codec: Codec::Av1,
        profile: CodecProfile::Av1Main,
        coded_dimensions: dimensions,
        input_format: PixelFormat::Gray8,
        color_range: ColorRange::Full,
        hardware: HardwarePreference::Avoid,
        timescale: fps,
        frame_duration: 1,
        configuration: Vec::new(),
    };
    let mut encoder = native_av1_video_encoder_factory().create(&configuration, &limits)?;
    let mut muxer = block_on(Mp4Muxer::new(
        MemorySink::new(),
        vec![Mp4TrackConfig {
            encoder: encoder.config().clone(),
            format: Mp4TrackFormat::Video(dimensions),
        }],
        frames as usize,
    ))?;
    for index in 0..frames {
        let level = (index * 255 / frames.max(2).saturating_sub(1)).min(255) as u8;
        let pixels = (0..height)
            .flat_map(|y| (0..width).map(move |x| level.saturating_add(((x + y) % 16) as u8)))
            .collect();
        let frame = VideoFrame::new(
            dimensions,
            PixelFormat::Gray8,
            ColorRange::Full,
            vec![Plane {
                data: pixels,
                stride: width as usize,
            }],
            &limits,
        )?;
        let samples = block_on(encoder.encode(
            FrameIndex(index),
            FrameSource::Cpu(CpuFrameSource {
                frame: &frame,
                orientation: Orientation::TopLeft,
            }),
        ))?;
        for sample in samples {
            block_on(muxer.write_sample(0, sample))?;
        }
    }
    for sample in block_on(encoder.finish())? {
        block_on(muxer.write_sample(0, sample))?;
    }
    let bytes = block_on(muxer.finish())?.into_inner();
    std::fs::write(path, bytes).map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_posters_at_an_offset() {
        let dir = std::env::temp_dir().join(format!("zvid-ui-poster-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("clip.mp4");
        write_test_clip(&path, 64, 36, 20, 10).unwrap();

        let first = poster_jpeg(&path, 0.0, 32).unwrap();
        let later = poster_jpeg(&path, 1.5, 32).unwrap();
        assert_eq!(&first[..2], &[0xFF, 0xD8]);
        assert_eq!(&later[..2], &[0xFF, 0xD8]);
        assert_ne!(first, later);
        // Past the end clamps to the last frame instead of failing.
        assert_eq!(
            poster_jpeg(&path, 99.0, 32).unwrap(),
            poster_jpeg(&path, 1.9, 32).unwrap()
        );

        // Reading frames in order, across groups and back again, gives the
        // same pictures as decoding each on its own.
        let mut frames = TakeFrames::open(&path).unwrap();
        for offset in [0.0, 0.3, 0.6, 1.5, 1.9, 0.1] {
            assert_eq!(
                frames.jpeg_at(offset, 32).unwrap(),
                poster_jpeg(&path, offset, 32).unwrap(),
                "frame at {offset}s"
            );
        }

        assert!(poster_jpeg(&dir.join("missing.mp4"), 0.0, 32).is_err());
        std::fs::write(dir.join("junk.mp4"), b"not a movie").unwrap();
        assert!(poster_jpeg(&dir.join("junk.mp4"), 0.0, 32).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
