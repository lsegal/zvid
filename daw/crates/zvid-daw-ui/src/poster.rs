//! Poster frames for `zvid://thumb/<id>`: the take's first frame, decoded
//! with zvidlib and encoded as a small JPEG.
//!
//! Only the group of pictures holding the frame is read and decoded, so a
//! poster costs the same at the start of an hour-long capture as at its end.

use std::fs::File;
use std::future::Future;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};

use zvidlib::io::{ByteSource, IoFuture};
use zvidlib::{
    CancellationToken, Codec, CodecProfile, ColorRange, EncodedVideoSample, Error, ErrorKind,
    ExactFrameReader, FrameIndex, HardwarePreference, Limits, Mp4Demuxer, Mp4DemuxerOptions,
    Mp4Track, PixelFormat, TrackKind, VideoDecoderConfig, VideoDecoderFactory,
    native_av1_video_decoder_factory, native_hevc_video_decoder_factory,
};

use crate::image::{Rgba, rgba_to_jpeg};

/// Longest edge of a poster, in pixels. Cards show them at about 88 pt.
pub const POSTER_EDGE: u32 = 320;

/// Decodes the frame shown at `offset_sec` into the file and returns it as
/// a JPEG no larger than `max_edge` on its longest side.
pub fn poster_jpeg(path: &Path, offset_sec: f64, max_edge: u32) -> zvidlib::Result<Vec<u8>> {
    let source = FileSource::open(path)?;
    let options = Mp4DemuxerOptions::default();
    let limits = options.limits;
    let movie = block_on(Mp4Demuxer::open(&source, options))?;
    let track = movie
        .tracks
        .iter()
        .find(|track| track.kind == TrackKind::Video)
        .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "the take has no video track"))?;
    let dimensions = track
        .dimensions
        .ok_or_else(|| Error::new(ErrorKind::InvalidInput, "the video track has no size"))?;

    let (codec, profile, factory): (_, _, Box<dyn VideoDecoderFactory>) = match track.codec {
        Codec::Hevc => (
            Codec::Hevc,
            CodecProfile::HevcMain,
            Box::new(native_hevc_video_decoder_factory()),
        ),
        Codec::Av1 => (
            Codec::Av1,
            CodecProfile::Av1Main,
            Box::new(native_av1_video_decoder_factory()),
        ),
        _ => {
            return Err(Error::new(
                ErrorKind::Unsupported,
                "posters need an HEVC or AV1 track",
            ));
        }
    };
    let target = presentation_index_at(track, offset_sec)?;
    let samples = group_of_pictures(track, &source, target)?;
    // AV1 carries its colour range in the stream and the reader insists the
    // output matches the configuration, so try the capture default first.
    let ranges: &[ColorRange] = match codec {
        Codec::Av1 => &[ColorRange::Limited, ColorRange::Full],
        _ => &[ColorRange::Limited],
    };
    let mut result = Err(Error::new(ErrorKind::Codec, "no colour range to try"));
    for &color_range in ranges {
        let configuration = VideoDecoderConfig {
            codec,
            profile,
            coded_dimensions: dimensions,
            output_format: PixelFormat::Rgba8,
            color_range,
            hardware: HardwarePreference::Prefer,
            configuration: track.decoder_config.clone(),
        };
        result = ExactFrameReader::new(factory.as_ref(), configuration, samples.clone(), limits)
            .and_then(|mut reader| {
                reader.get(FrameIndex(target as u64), &CancellationToken::new())
            });
        match &result {
            Err(error) if error.kind() == ErrorKind::MalformedMedia => continue,
            _ => break,
        }
    }
    let frame = result?;
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

/// The presentation index of the frame on screen at `offset_sec`.
fn presentation_index_at(track: &Mp4Track, offset_sec: f64) -> zvidlib::Result<usize> {
    if track.presentation_order.is_empty() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "the video track is empty",
        ));
    }
    let first_pts = track.samples[track.presentation_order[0]].pts;
    let target = first_pts + (offset_sec.max(0.0) * f64::from(track.timescale)).round() as i64;
    let after = track
        .presentation_order
        .partition_point(|&decode| track.samples[decode].pts <= target);
    Ok(after.saturating_sub(1))
}

/// The decode-order samples from the random-access point before `target`
/// up to the next one, keyed by presentation index.
fn group_of_pictures(
    track: &Mp4Track,
    source: &FileSource,
    target: usize,
) -> zvidlib::Result<Vec<EncodedVideoSample>> {
    let mut presentation_by_decode = vec![0_usize; track.samples.len()];
    for (presentation, &decode) in track.presentation_order.iter().enumerate() {
        presentation_by_decode[decode] = presentation;
    }
    let decode = track.presentation_order[target];
    let start = (0..=decode)
        .rev()
        .find(|&index| track.samples[index].is_sync)
        .unwrap_or(0);
    let end = (decode + 1..track.samples.len())
        .find(|&index| track.samples[index].is_sync)
        .unwrap_or(track.samples.len());
    (start..end)
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
        .collect()
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

        assert!(poster_jpeg(&dir.join("missing.mp4"), 0.0, 32).is_err());
        std::fs::write(dir.join("junk.mp4"), b"not a movie").unwrap();
        assert!(poster_jpeg(&dir.join("junk.mp4"), 0.0, 32).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
