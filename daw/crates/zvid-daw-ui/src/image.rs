//! Downscaling and JPEG encoding for preview frames and posters.

use jpeg_encoder::{ColorType, Encoder};

/// JPEG quality for previews and posters; they are small and short-lived.
pub const JPEG_QUALITY: u8 = 80;

/// An RGBA image borrowed from a decoder or camera.
#[derive(Clone, Copy, Debug)]
pub struct Rgba<'a> {
    pub data: &'a [u8],
    pub width: u32,
    pub height: u32,
    /// Bytes per row.
    pub stride: usize,
}

/// Fits `width`×`height` inside a `max_edge` square, keeping the aspect ratio
/// and never upscaling.
pub fn fit(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= max_edge || long == 0 {
        return (width.max(1), height.max(1));
    }
    let scale = f64::from(max_edge) / f64::from(long);
    (
        ((f64::from(width) * scale).round() as u32).max(1),
        ((f64::from(height) * scale).round() as u32).max(1),
    )
}

/// Box-filters `image` down to fit `max_edge` and returns packed RGB.
pub fn downscale_rgb(image: Rgba<'_>, max_edge: u32) -> (Vec<u8>, u32, u32) {
    let (out_w, out_h) = fit(image.width, image.height, max_edge);
    let mut rgb = Vec::with_capacity(out_w as usize * out_h as usize * 3);
    for oy in 0..out_h {
        let y0 = (u64::from(oy) * u64::from(image.height) / u64::from(out_h)) as u32;
        let y1 = ((u64::from(oy + 1) * u64::from(image.height) / u64::from(out_h)) as u32)
            .max(y0 + 1)
            .min(image.height);
        for ox in 0..out_w {
            let x0 = (u64::from(ox) * u64::from(image.width) / u64::from(out_w)) as u32;
            let x1 = ((u64::from(ox + 1) * u64::from(image.width) / u64::from(out_w)) as u32)
                .max(x0 + 1)
                .min(image.width);
            let mut sum = [0_u32; 3];
            for y in y0..y1 {
                let row = y as usize * image.stride;
                for x in x0..x1 {
                    let pixel = &image.data[row + x as usize * 4..][..3];
                    for (total, value) in sum.iter_mut().zip(pixel) {
                        *total += u32::from(*value);
                    }
                }
            }
            let count = (y1 - y0) * (x1 - x0);
            rgb.extend(sum.map(|total| (total / count) as u8));
        }
    }
    (rgb, out_w, out_h)
}

/// Encodes packed RGB as a baseline JPEG.
pub fn encode_rgb(rgb: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut jpeg = Vec::new();
    Encoder::new(&mut jpeg, JPEG_QUALITY)
        .encode(rgb, width as u16, height as u16, ColorType::Rgb)
        .expect("in-memory JPEG encoding succeeds for valid dimensions");
    jpeg
}

/// Downscales an RGBA image to fit `max_edge` and encodes it as JPEG.
pub fn rgba_to_jpeg(image: Rgba<'_>, max_edge: u32) -> Vec<u8> {
    let (rgb, width, height) = downscale_rgb(image, max_edge.min(u32::from(u16::MAX)));
    encode_rgb(&rgb, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_without_upscaling() {
        assert_eq!(fit(1920, 1080, 320), (320, 180));
        assert_eq!(fit(1080, 1920, 320), (180, 320));
        assert_eq!(fit(100, 50, 320), (100, 50));
        assert_eq!(fit(4000, 1, 320), (320, 1));
    }

    #[test]
    fn averages_blocks() {
        // 4x2 RGBA with padding: left half red, right half blue.
        let stride = 4 * 4 + 4;
        let mut data = vec![0_u8; stride * 2];
        for y in 0..2 {
            for x in 0..4 {
                let pixel = &mut data[y * stride + x * 4..][..4];
                pixel.copy_from_slice(if x < 2 {
                    &[200, 0, 0, 255]
                } else {
                    &[0, 0, 100, 255]
                });
            }
        }
        let image = Rgba {
            data: &data,
            width: 4,
            height: 2,
            stride,
        };
        let (rgb, width, height) = downscale_rgb(image, 2);
        assert_eq!((width, height), (2, 1));
        assert_eq!(rgb, [200, 0, 0, 0, 0, 100]);
    }

    #[test]
    fn encodes_jpeg() {
        let data = vec![128_u8; 64 * 48 * 4];
        let jpeg = rgba_to_jpeg(
            Rgba {
                data: &data,
                width: 64,
                height: 48,
                stride: 64 * 4,
            },
            32,
        );
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xFF, 0xD9]);
    }
}
