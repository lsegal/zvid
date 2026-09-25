//! Captured frames.

use crate::clock::HostTime;

/// Pixel layout of [`Frame::data`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PixelFormat {
    /// 8-bit 4:2:0: a `width * height` luma plane followed by an interleaved
    /// Cb/Cr plane of `width * height / 2` bytes, both tightly packed.
    Nv12,
}

/// Clockwise rotation to apply to a frame to display it upright.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Rotation {
    #[default]
    None,
    Cw90,
    Cw180,
    Cw270,
}

impl Rotation {
    /// Maps a clockwise angle in degrees to the nearest quarter turn.
    pub fn from_degrees(degrees: f64) -> Self {
        let quarter = ((degrees / 90.0).round() as i64).rem_euclid(4);
        match quarter {
            1 => Self::Cw90,
            2 => Self::Cw180,
            3 => Self::Cw270,
            _ => Self::None,
        }
    }

    pub fn degrees(self) -> u32 {
        match self {
            Self::None => 0,
            Self::Cw90 => 90,
            Self::Cw180 => 180,
            Self::Cw270 => 270,
        }
    }

    /// Whether the displayed frame swaps width and height.
    pub fn swaps_axes(self) -> bool {
        matches!(self, Self::Cw90 | Self::Cw270)
    }

    /// Maps a coordinate in the upright image back to the `sw` x `sh`
    /// source image it was rotated from.
    pub(crate) fn source_coord(self, dx: usize, dy: usize, sw: usize, sh: usize) -> (usize, usize) {
        match self {
            Self::None => (dx, dy),
            Self::Cw90 => (dy, sh - 1 - dx),
            Self::Cw180 => (sw - 1 - dx, sh - 1 - dy),
            Self::Cw270 => (sw - 1 - dy, dx),
        }
    }
}

/// YCbCr matrix and range of the frame's samples.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ColorInfo {
    /// BT.709 when true, BT.601 otherwise.
    pub bt709: bool,
    /// Full (0–255) range when true, video (16–235) range otherwise.
    pub full_range: bool,
}

impl ColorInfo {
    /// The usual default for a camera frame of the given height.
    pub fn for_height(height: u32) -> Self {
        Self {
            bt709: height >= 720,
            full_range: false,
        }
    }
}

/// One captured video frame.
#[derive(Clone, Debug)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub color: ColorInfo,
    /// Rotation to apply when displaying or encoding the frame.
    pub rotation: Rotation,
    /// Presentation time on the host monotonic clock (see [`HostTime`]).
    pub pts: HostTime,
    /// Zero-based index of the frame within its capture session.
    pub sequence: u64,
    pub data: Vec<u8>,
}

impl Frame {
    /// Byte length of an NV12 frame of the given size.
    pub fn nv12_len(width: u32, height: u32) -> usize {
        let luma = width as usize * height as usize;
        luma + luma / 2
    }

    /// Displayed size after applying [`Frame::rotation`].
    pub fn display_size(&self) -> (u32, u32) {
        if self.rotation.swaps_axes() {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        }
    }

    /// A copy of the frame with [`Frame::rotation`] applied to its pixels,
    /// so encoders that know nothing of rotation record it upright.
    pub fn upright(&self) -> Frame {
        let PixelFormat::Nv12 = self.format;
        let (sw, sh) = (self.width as usize, self.height as usize);
        let (dw, dh) = self.display_size();
        let (dw, dh) = (dw as usize, dh as usize);
        let rotation = self.rotation;
        let mut data = vec![128; Frame::nv12_len(dw as u32, dh as u32)];
        let (luma, chroma) = data.split_at_mut(dw * dh);
        let (src_luma, src_chroma) = (self.luma(), self.chroma());
        for dy in 0..dh {
            for dx in 0..dw {
                let (sx, sy) = rotation.source_coord(dx, dy, sw, sh);
                luma[dy * dw + dx] = src_luma[sy * sw + sx];
            }
        }
        // Rotate the interleaved Cb/Cr pairs as units on the half-size grid.
        let (cw, ch) = (sw / 2, sh / 2);
        let (dcw, dch) = if rotation.swaps_axes() {
            (ch, cw)
        } else {
            (cw, ch)
        };
        for dy in 0..dch {
            for dx in 0..dcw {
                let (sx, sy) = rotation.source_coord(dx, dy, cw, ch);
                let (s, d) = (sy * sw + sx * 2, dy * dw + dx * 2);
                chroma[d..d + 2].copy_from_slice(&src_chroma[s..s + 2]);
            }
        }
        Frame {
            width: dw as u32,
            height: dh as u32,
            format: self.format,
            color: self.color,
            rotation: Rotation::None,
            pts: self.pts,
            sequence: self.sequence,
            data,
        }
    }

    pub(crate) fn luma(&self) -> &[u8] {
        &self.data[..self.width as usize * self.height as usize]
    }

    pub(crate) fn chroma(&self) -> &[u8] {
        &self.data[self.width as usize * self.height as usize..]
    }
}

/// Copies a strided NV12 image into a tightly packed buffer.
///
/// `y_plane` and `uv_plane` are the start of each plane, with `y_stride` and
/// `uv_stride` bytes per row. Returns `None` when a plane is too short.
pub fn pack_nv12(
    width: u32,
    height: u32,
    y_plane: &[u8],
    y_stride: usize,
    uv_plane: &[u8],
    uv_stride: usize,
) -> Option<Vec<u8>> {
    let (w, h) = (width as usize, height as usize);
    let chroma_rows = h.div_ceil(2);
    let row_len = |rows: usize, stride: usize| rows.checked_sub(1).map_or(0, |r| r * stride + w);
    if y_stride < w
        || uv_stride < w
        || y_plane.len() < row_len(h, y_stride)
        || uv_plane.len() < row_len(chroma_rows, uv_stride)
    {
        return None;
    }
    let mut out = Vec::with_capacity(Frame::nv12_len(width, height));
    for row in 0..h {
        out.extend_from_slice(&y_plane[row * y_stride..row * y_stride + w]);
    }
    for row in 0..chroma_rows {
        out.extend_from_slice(&uv_plane[row * uv_stride..row * uv_stride + w]);
    }
    out.resize(Frame::nv12_len(width, height), 128);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upright_rotates_both_planes() {
        // 4x2 frame; luma counts 0..8 row-major, chroma pairs (10,11), (12,13).
        let frame = |rotation| Frame {
            width: 4,
            height: 2,
            format: PixelFormat::Nv12,
            color: ColorInfo::for_height(2),
            rotation,
            pts: HostTime::default(),
            sequence: 7,
            data: vec![0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13],
        };
        let upright = frame(Rotation::Cw90).upright();
        assert_eq!((upright.width, upright.height), (2, 4));
        assert_eq!(upright.rotation, Rotation::None);
        assert_eq!(upright.sequence, 7);
        // Clockwise: the bottom-left source pixel lands top-left.
        assert_eq!(&upright.data[..8], &[4, 0, 5, 1, 6, 2, 7, 3]);
        assert_eq!(&upright.data[8..], &[10, 11, 12, 13]);

        let upright = frame(Rotation::Cw270).upright();
        assert_eq!(&upright.data[..8], &[3, 7, 2, 6, 1, 5, 0, 4]);
        assert_eq!(&upright.data[8..], &[12, 13, 10, 11]);

        let upright = frame(Rotation::Cw180).upright();
        assert_eq!((upright.width, upright.height), (4, 2));
        assert_eq!(&upright.data[..8], &[7, 6, 5, 4, 3, 2, 1, 0]);
        assert_eq!(&upright.data[8..], &[12, 13, 10, 11]);

        assert_eq!(
            frame(Rotation::None).upright().data,
            frame(Rotation::None).data
        );
    }

    #[test]
    fn rotation_from_degrees() {
        assert_eq!(Rotation::from_degrees(0.0), Rotation::None);
        assert_eq!(Rotation::from_degrees(90.0), Rotation::Cw90);
        assert_eq!(Rotation::from_degrees(-90.0), Rotation::Cw270);
        assert_eq!(Rotation::from_degrees(540.0), Rotation::Cw180);
        assert_eq!(Rotation::from_degrees(269.0), Rotation::Cw270);
    }

    #[test]
    fn pack_nv12_strips_row_padding() {
        // 2x2 image with 4-byte strides.
        let y = [1, 2, 0, 0, 3, 4, 0, 0];
        let uv = [5, 6, 0, 0];
        let packed = pack_nv12(2, 2, &y, 4, &uv, 4).unwrap();
        assert_eq!(packed, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn pack_nv12_rejects_short_planes() {
        assert!(pack_nv12(4, 2, &[0; 7], 4, &[0; 4], 4).is_none());
        assert!(pack_nv12(4, 2, &[0; 8], 2, &[0; 4], 4).is_none());
    }
}
