//! Poster frames: a JPEG of the picture at a file time, decoded with
//! zvidlib, for take thumbnails (`zvid://thumb`).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use jpeg_encoder::{ColorType, Encoder};
use zvidlib::io::{ByteSource, IoFuture};
use zvidlib::{
    CancellationToken, Codec, CodecProfile, ColorRange, EncodedVideoSample, FrameIndex,
    HardwarePreference, Limits, Mp4Demuxer, Mp4DemuxerOptions, PixelFormat, TrackKind,
    VideoDecoderConfig, VideoDecoderFactory,
};

use super::{RecordError, block_on};
use crate::preview::scaled_size;

/// Decodes the frame shown at `file_sec` in the capture file at `path` and
/// returns it as a JPEG whose longer edge is at most `max_edge`. Works on
/// finished files and on the fragmented file of a recording in progress.
pub fn poster_jpeg(path: &Path, file_sec: f64, max_edge: u32) -> Result<Vec<u8>, RecordError> {
    let source = FileSource::open(path)?;
    let movie =
        block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).map_err(decode_error)?;
    let track = movie
        .tracks
        .iter()
        .find(|track| track.kind == TrackKind::Video)
        .ok_or_else(|| RecordError::Decode("the file has no video track".to_string()))?;
    let dimensions = track
        .dimensions
        .ok_or_else(|| RecordError::Decode("the video track has no dimensions".to_string()))?;
    if track.samples.is_empty() {
        return Err(RecordError::Decode("the video track is empty".to_string()));
    }

    // The last frame presented at or before the requested time.
    let ticks = (file_sec.max(0.0) * f64::from(track.timescale)).round() as i64;
    let target = track
        .presentation_order
        .iter()
        .copied()
        .take_while(|&index| track.samples[index].pts <= ticks)
        .last()
        .unwrap_or(track.presentation_order[0]);
    let start = (0..=target)
        .rev()
        .find(|&index| track.samples[index].is_sync)
        .unwrap_or(0);

    let (factory, profile): (Box<dyn VideoDecoderFactory>, _) = match track.codec {
        Codec::Hevc => (
            Box::new(zvidlib::native_hevc_video_decoder_factory()),
            CodecProfile::HevcMain,
        ),
        Codec::Av1 => (
            Box::new(zvidlib::native_av1_video_decoder_factory()),
            CodecProfile::Av1Main,
        ),
        other => return Err(RecordError::Decode(format!("unsupported codec {other:?}"))),
    };
    let limits = Limits::default();
    let config = VideoDecoderConfig {
        codec: track.codec,
        profile,
        coded_dimensions: dimensions,
        output_format: PixelFormat::Rgba8,
        color_range: ColorRange::Limited,
        hardware: HardwarePreference::Prefer,
        configuration: track.decoder_config.clone(),
    };
    let mut decoder = factory.create(&config, &limits).map_err(decode_error)?;
    let cancel = CancellationToken::new();
    let mut found = None;
    // Samples are in decode order and the recorder never reorders, so the
    // decode index is the presentation index.
    for index in start..=target {
        let mut data = vec![0; track.samples[index].size as usize];
        block_on(track.read_sample_into(&source, index, &mut data)).map_err(decode_error)?;
        let sample = EncodedVideoSample {
            presentation_index: FrameIndex(index as u64),
            random_access: track.samples[index].is_sync,
            data,
        };
        for frame in decoder.submit(&sample, &cancel).map_err(decode_error)? {
            if frame.presentation_index.0 == target as u64 {
                found = Some(frame.frame);
            }
        }
    }
    if found.is_none() {
        for frame in decoder.drain(&cancel).map_err(decode_error)? {
            if frame.presentation_index.0 == target as u64 {
                found = Some(frame.frame);
            }
        }
    }
    let frame =
        found.ok_or_else(|| RecordError::Decode("the decoder returned no frame".to_string()))?;
    let plane = &frame.planes[0];
    let (width, height) = (frame.dimensions.width, frame.dimensions.height);
    let (rgb_width, rgb_height, rgb) =
        downscale_rgba(&plane.data, plane.stride, width, height, max_edge);
    let mut jpeg = Vec::new();
    Encoder::new(&mut jpeg, 80)
        .encode(&rgb, rgb_width as u16, rgb_height as u16, ColorType::Rgb)
        .map_err(|error| RecordError::Decode(error.to_string()))?;
    Ok(jpeg)
}

/// Box-filters RGBA to RGB no larger than `max_edge` on its longer side.
fn downscale_rgba(
    rgba: &[u8],
    stride: usize,
    width: u32,
    height: u32,
    max_edge: u32,
) -> (u32, u32, Vec<u8>) {
    let (out_w, out_h) = scaled_size(width, height, max_edge.max(1));
    let (w, h, ow, oh) = (
        width as usize,
        height as usize,
        out_w as usize,
        out_h as usize,
    );
    let mut rgb = Vec::with_capacity(ow * oh * 3);
    for oy in 0..oh {
        let (y0, y1) = (oy * h / oh, ((oy + 1) * h / oh).max(oy * h / oh + 1));
        for ox in 0..ow {
            let (x0, x1) = (ox * w / ow, ((ox + 1) * w / ow).max(ox * w / ow + 1));
            let mut sum = [0u32; 3];
            for y in y0..y1 {
                for x in x0..x1 {
                    let pixel = &rgba[y * stride + x * 4..];
                    for (total, &value) in sum.iter_mut().zip(pixel) {
                        *total += u32::from(value);
                    }
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u32;
            rgb.extend(sum.map(|total| ((total + count / 2) / count) as u8));
        }
    }
    (out_w, out_h, rgb)
}

fn decode_error(error: zvidlib::Error) -> RecordError {
    RecordError::Decode(error.to_string())
}

/// A zvidlib [`ByteSource`] reading a file on demand.
struct FileSource {
    file: Mutex<File>,
    len: u64,
}

impl FileSource {
    fn open(path: &Path) -> std::io::Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
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
        let result = (|| {
            let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
            file.seek(SeekFrom::Start(offset))?;
            let mut read = 0;
            while read < destination.len() {
                match file.read(&mut destination[read..])? {
                    0 => break,
                    count => read += count,
                }
            }
            Ok(read)
        })()
        .map_err(|error: std::io::Error| {
            zvidlib::Error::new(zvidlib::ErrorKind::Io, error.to_string())
        });
        Box::pin(std::future::ready(result))
    }
}
