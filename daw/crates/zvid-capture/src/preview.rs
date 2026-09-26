//! Downscaled JPEG previews for the plugin UI.

use crate::clock::HostTime;
use crate::format::Rational;
use crate::frame::{Frame, PixelFormat, Rotation};
use jpeg_encoder::{ColorType, Encoder};

/// Preview limits. The defaults are ≤640 px on the long edge at ≤30 fps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PreviewConfig {
    pub max_edge: u32,
    pub max_fps: Rational,
    /// JPEG quality, 1–100.
    pub jpeg_quality: u8,
}

impl Default for PreviewConfig {
    fn default() -> Self {
        Self {
            max_edge: 640,
            max_fps: Rational::new(30, 1),
            jpeg_quality: 75,
        }
    }
}

/// A JPEG-encoded, upright, downscaled copy of a captured frame.
#[derive(Clone, Debug)]
pub struct PreviewFrame {
    pub width: u32,
    pub height: u32,
    pub pts: HostTime,
    pub sequence: u64,
    pub jpeg: Vec<u8>,
}

/// Output size for a `width` x `height` image limited to `max_edge`.
pub fn scaled_size(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= max_edge || long == 0 {
        return (width.max(1), height.max(1));
    }
    let scale = |edge: u32| {
        ((u64::from(edge) * u64::from(max_edge) + u64::from(long) / 2) / u64::from(long)).max(1)
            as u32
    };
    (scale(width), scale(height))
}

/// Downscales, rotates upright, and converts `frame` to packed RGB.
pub fn to_rgb(frame: &Frame, max_edge: u32) -> (u32, u32, Vec<u8>) {
    let PixelFormat::Nv12 = frame.format;
    let (sw, sh) = (frame.width as usize, frame.height as usize);
    let (dw, dh) = frame.display_size();
    let (ow, oh) = scaled_size(dw, dh, max_edge.max(1));
    let (dw, dh, ow, oh) = (dw as usize, dh as usize, ow as usize, oh as usize);
    let luma = frame.luma();
    let chroma = frame.chroma();
    let convert = Converter::new(frame.color.bt709, frame.color.full_range);

    // Average up to 4x4 samples per output pixel so downscaling doesn't alias.
    let taps_x = dw.div_ceil(ow).clamp(1, 4);
    let taps_y = dh.div_ceil(oh).clamp(1, 4);
    let taps = (taps_x * taps_y) as u32;

    let mut rgb = Vec::with_capacity(ow * oh * 3);
    for oy in 0..oh {
        for ox in 0..ow {
            let (mut y_sum, mut u_sum, mut v_sum) = (0u32, 0u32, 0u32);
            for ty in 0..taps_y {
                // Sample at the centers of a taps_x by taps_y grid over the
                // output pixel's box in display coordinates.
                let dy = ((oy * taps_y + ty) * 2 + 1) * dh / (2 * oh * taps_y);
                for tx in 0..taps_x {
                    let dx = ((ox * taps_x + tx) * 2 + 1) * dw / (2 * ow * taps_x);
                    let (sx, sy) =
                        source_coord(frame.rotation, dx.min(dw - 1), dy.min(dh - 1), sw, sh);
                    y_sum += u32::from(luma[sy * sw + sx]);
                    let c = (sy / 2) * sw + (sx & !1);
                    u_sum += u32::from(chroma[c]);
                    v_sum += u32::from(chroma[c + 1]);
                }
            }
            let [r, g, b] = convert.rgb(
                (y_sum + taps / 2) / taps,
                (u_sum + taps / 2) / taps,
                (v_sum + taps / 2) / taps,
            );
            rgb.extend_from_slice(&[r, g, b]);
        }
    }
    (ow as u32, oh as u32, rgb)
}

/// Maps a display coordinate back to the source frame for a clockwise rotation.
fn source_coord(rotation: Rotation, dx: usize, dy: usize, sw: usize, sh: usize) -> (usize, usize) {
    match rotation {
        Rotation::None => (dx, dy),
        Rotation::Cw90 => (dy, sh - 1 - dx),
        Rotation::Cw180 => (sw - 1 - dx, sh - 1 - dy),
        Rotation::Cw270 => (sw - 1 - dy, dx),
    }
}

pub(crate) struct Converter {
    y_offset: f32,
    y_scale: f32,
    c_scale: f32,
    kr: f32,
    kgu: f32,
    kgv: f32,
    kb: f32,
}

impl Converter {
    pub(crate) fn new(bt709: bool, full_range: bool) -> Self {
        let (kr, kgu, kgv, kb) = if bt709 {
            (1.5748, 0.187_324, 0.468_124, 1.8556)
        } else {
            (1.402, 0.344_136, 0.714_136, 1.772)
        };
        let (y_offset, y_scale, c_scale) = if full_range {
            (0.0, 1.0, 1.0)
        } else {
            (16.0, 255.0 / 219.0, 255.0 / 224.0)
        };
        Self {
            y_offset,
            y_scale,
            c_scale,
            kr,
            kgu,
            kgv,
            kb,
        }
    }

    pub(crate) fn rgb(&self, y: u32, u: u32, v: u32) -> [u8; 3] {
        self.with_chroma(y, self.chroma(u, v))
    }

    /// What a chroma sample adds to R, G and B, shared by the pixels it
    /// covers.
    pub(crate) fn chroma(&self, u: u32, v: u32) -> [f32; 3] {
        let u = (u as f32 - 128.0) * self.c_scale;
        let v = (v as f32 - 128.0) * self.c_scale;
        [self.kr * v, -self.kgu * u - self.kgv * v, self.kb * u]
    }

    pub(crate) fn with_chroma(&self, y: u32, [r, g, b]: [f32; 3]) -> [u8; 3] {
        let y = (y as f32 - self.y_offset) * self.y_scale;
        let clamp = |x: f32| x.round().clamp(0.0, 255.0) as u8;
        [clamp(y + r), clamp(y + g), clamp(y + b)]
    }
}

/// Renders `frame` as a preview JPEG.
pub fn render(
    frame: &Frame,
    config: &PreviewConfig,
) -> Result<PreviewFrame, jpeg_encoder::EncodingError> {
    let (width, height, rgb) = to_rgb(frame, config.max_edge);
    let mut jpeg = Vec::with_capacity(rgb.len() / 8);
    let encoder = Encoder::new(&mut jpeg, config.jpeg_quality.clamp(1, 100));
    encoder.encode(&rgb, width as u16, height as u16, ColorType::Rgb)?;
    Ok(PreviewFrame {
        width,
        height,
        pts: frame.pts,
        sequence: frame.sequence,
        jpeg,
    })
}

/// Decides which frames become previews so the preview rate stays at or
/// below `max_fps` on average, tolerating capture jitter.
#[derive(Debug)]
pub(crate) struct Throttle {
    interval: u64,
    next_due: Option<u64>,
}

impl Throttle {
    pub(crate) fn new(max_fps: Rational) -> Self {
        Self {
            interval: max_fps.frame_duration_nanos(),
            next_due: None,
        }
    }

    pub(crate) fn accept(&mut self, pts: HostTime) -> bool {
        let pts = pts.as_nanos();
        let tolerance = self.interval / 4;
        let due = *self.next_due.get_or_insert(pts);
        if pts + tolerance < due {
            return false;
        }
        let mut next = due + self.interval;
        if next + self.interval < pts {
            // After a gap, restart the schedule instead of bursting to catch up.
            next = pts + self.interval;
        }
        self.next_due = Some(next);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::ColorInfo;

    fn solid(width: u32, height: u32, y: u8, u: u8, v: u8) -> Frame {
        let luma = (width * height) as usize;
        let mut data = vec![y; luma];
        for _ in 0..luma / 4 {
            data.extend_from_slice(&[u, v]);
        }
        Frame {
            width,
            height,
            format: PixelFormat::Nv12,
            color: ColorInfo {
                bt709: false,
                full_range: false,
            },
            rotation: Rotation::None,
            pts: HostTime::from_nanos(0),
            sequence: 0,
            data,
        }
    }

    #[test]
    fn scaled_size_limits_the_long_edge() {
        assert_eq!(scaled_size(1920, 1080, 640), (640, 360));
        assert_eq!(scaled_size(1080, 1920, 640), (360, 640));
        assert_eq!(scaled_size(320, 240, 640), (320, 240));
        assert_eq!(scaled_size(4000, 2, 640), (640, 1));
    }

    #[test]
    fn converts_video_range_colors() {
        let (_, _, white) = to_rgb(&solid(4, 4, 235, 128, 128), 640);
        assert!(white.iter().all(|&c| c == 255));
        let (_, _, black) = to_rgb(&solid(4, 4, 16, 128, 128), 640);
        assert!(black.iter().all(|&c| c == 0));
        // BT.601 video-range red is roughly Y=81, Cb=90, Cr=240.
        let (_, _, red) = to_rgb(&solid(4, 4, 81, 90, 240), 640);
        assert!(red[0] > 250 && red[1] < 5 && red[2] < 5, "{:?}", &red[..3]);
    }

    #[test]
    fn rotates_portrait_frames_upright() {
        // 4x2 landscape frame: left half black, right half white.
        let mut frame = solid(4, 2, 16, 128, 128);
        for row in 0..2 {
            frame.data[row * 4 + 2] = 235;
            frame.data[row * 4 + 3] = 235;
        }
        frame.rotation = Rotation::Cw90;
        let (w, h, rgb) = to_rgb(&frame, 640);
        assert_eq!((w, h), (2, 4));
        // Rotating clockwise moves the right half to the bottom.
        let px = |x: usize, y: usize| rgb[(y * w as usize + x) * 3];
        assert_eq!((px(0, 0), px(1, 1)), (0, 0));
        assert_eq!((px(0, 2), px(1, 3)), (255, 255));

        frame.rotation = Rotation::Cw270;
        let (w, _, rgb) = to_rgb(&frame, 640);
        let px = |x: usize, y: usize| rgb[(y * w as usize + x) * 3];
        assert_eq!((px(0, 0), px(1, 3)), (255, 0));
    }

    #[test]
    fn renders_a_decodable_jpeg_within_limits() {
        let preview = render(&solid(1920, 1080, 128, 128, 128), &PreviewConfig::default()).unwrap();
        assert_eq!((preview.width, preview.height), (640, 360));
        assert_eq!(&preview.jpeg[..2], &[0xFF, 0xD8]);
        assert_eq!(&preview.jpeg[preview.jpeg.len() - 2..], &[0xFF, 0xD9]);
    }

    fn accepted(throttle: &mut Throttle, period_ns: u64, frames: u64) -> u64 {
        (0..frames)
            .filter(|i| throttle.accept(HostTime::from_nanos(i * period_ns)))
            .count() as u64
    }

    #[test]
    fn throttle_passes_30fps_and_halves_60fps() {
        let mut t = Throttle::new(Rational::new(30, 1));
        assert_eq!(accepted(&mut t, 33_333_333, 90), 90);
        let mut t = Throttle::new(Rational::new(30, 1));
        assert_eq!(accepted(&mut t, 16_666_667, 120), 60);
    }

    #[test]
    fn throttle_caps_uneven_rates_on_average() {
        let mut t = Throttle::new(Rational::new(30, 1));
        // 40 fps for 3 s must not exceed 30 fps (+1 for the first frame).
        assert!(accepted(&mut t, 25_000_000, 120) <= 91);
    }

    #[test]
    fn throttle_tolerates_jitter() {
        let mut t = Throttle::new(Rational::new(30, 1));
        let jitter = [0i64, 4_000_000, -4_000_000, 3_000_000, -2_000_000];
        let count = (0..90u64)
            .filter(|i| {
                let pts =
                    (*i as i64 * 33_333_333 + jitter[*i as usize % jitter.len()]).max(0) as u64;
                t.accept(HostTime::from_nanos(pts))
            })
            .count();
        assert_eq!(count, 90);
    }
}
