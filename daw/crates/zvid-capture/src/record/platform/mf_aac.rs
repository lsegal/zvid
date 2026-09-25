//! Media Foundation AAC encoder.

use crate::record::encoder::PcmEncoder;

pub fn open(_sample_rate: u32, _channels: u16) -> Result<Box<dyn PcmEncoder>, String> {
    Err("todo".into())
}
