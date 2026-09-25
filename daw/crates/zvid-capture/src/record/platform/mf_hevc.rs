//! Media Foundation hardware HEVC encoder.

use crate::format::Rational;
use crate::record::encoder::FrameEncoder;

pub fn open(_width: u32, _height: u32, _fps: Rational, _bitrate: u32) -> Result<Box<dyn FrameEncoder>, String> {
    Err("todo".into())
}
