//! Platform encoders: hardware HEVC (VideoToolbox on macOS, Media
//! Foundation on Windows) and, on Windows, the Media Foundation AAC encoder.
//! macOS AAC comes from zvidlib's AudioToolbox encoder instead.

use super::encoder::{FrameEncoder, PcmEncoder};
use crate::format::Rational;

#[cfg(windows)]
mod mf_aac;
#[cfg(windows)]
mod mf_hevc;
#[cfg(target_os = "macos")]
mod videotoolbox;

/// Opens the platform's hardware HEVC Main encoder.
pub fn open_hevc(
    width: u32,
    height: u32,
    fps: Rational,
    bitrate: u32,
) -> Result<Box<dyn FrameEncoder>, String> {
    #[cfg(windows)]
    {
        mf_hevc::open(width, height, fps, bitrate)
    }
    #[cfg(target_os = "macos")]
    {
        videotoolbox::open(width, height, fps, bitrate)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (width, height, fps, bitrate);
        Err("no hardware HEVC encoder on this platform".to_string())
    }
}

/// Opens the platform's AAC-LC encoder, where zvidlib has none.
pub fn open_aac(sample_rate: u32, channels: u16) -> Result<Box<dyn PcmEncoder>, String> {
    #[cfg(windows)]
    {
        mf_aac::open(sample_rate, channels)
    }
    #[cfg(not(windows))]
    {
        let _ = (sample_rate, channels);
        Err("no platform AAC encoder on this platform".to_string())
    }
}
