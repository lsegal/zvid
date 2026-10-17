//! What the export's encoders are configured with, and the sample-entry
//! configuration records their output is muxed under. None of this needs a
//! browser, so it is tested natively.
use zvidlib::av1::{Av1Obu, Av1Parser};
use zvidlib::{Codec, Error, ErrorKind, Limits, Result, VideoDimensions};

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, message)
}

/// A video codec the export encodes with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VideoCodec {
    H264,
    Hevc,
    Av1,
    Vp8,
    Vp9,
}

impl VideoCodec {
    /// The codec by the name the app's session settings give it.
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "h264" => Self::H264,
            "hevc" => Self::Hevc,
            "av1" => Self::Av1,
            "vp8" => Self::Vp8,
            "vp9" => Self::Vp9,
            _ => return None,
        })
    }

    pub fn codec(self) -> Codec {
        match self {
            Self::H264 => Codec::H264,
            Self::Hevc => Codec::Hevc,
            Self::Av1 => Codec::Av1,
            Self::Vp8 => Codec::Vp8,
            Self::Vp9 => Codec::Vp9,
        }
    }

    /// VP8 and VP9 export to WebM; the rest to MP4.
    pub fn is_webm(self) -> bool {
        matches!(self, Self::Vp8 | Self::Vp9)
    }

    /// H.264 and HEVC encoders take only even dimensions.
    pub fn needs_even_dimensions(self) -> bool {
        matches!(self, Self::H264 | Self::Hevc)
    }

    /// The `WebCodecs` codec string for a `width`×`height` encode at
    /// `bitrate` bits a second: the lowest level that holds both, in the
    /// codec's 8-bit main (H.264 High) profile.
    pub fn codec_string(self, width: u32, height: u32, bitrate: u32) -> String {
        let pixels = u64::from(width) * u64::from(height);
        let bitrate = u64::from(bitrate);
        match self {
            Self::H264 => {
                let macroblocks = u64::from(width.div_ceil(16)) * u64::from(height.div_ceil(16));
                let level = AVC_LEVELS
                    .iter()
                    .find(|(max_macroblocks, max_bitrate, _)| {
                        macroblocks <= *max_macroblocks && bitrate <= *max_bitrate
                    })
                    .map_or(0x3e, |level| level.2);
                format!("avc1.6400{level:02x}")
            }
            Self::Hevc => {
                let (tier, level) = find_level(HEVC_LEVELS, pixels, bitrate);
                format!("hev1.1.6.{tier}{level}.B0")
            }
            Self::Av1 => {
                let (tier, level) = find_level(AV1_LEVELS, pixels, bitrate);
                format!("av01.0.{level:02}{tier}.08")
            }
            Self::Vp8 => "vp8".to_owned(),
            Self::Vp9 => format!("vp09.00.{:02}.08", vp9_level(width, height, bitrate as u32)),
        }
    }
}

/// The VP9 level a `width`×`height` encode at `bitrate` names.
pub fn vp9_level(width: u32, height: u32, bitrate: u32) -> u8 {
    let pixels = u64::from(width) * u64::from(height);
    find_level(VP9_LEVELS, pixels, u64::from(bitrate)).1
}

fn find_level<T: Copy, L: Copy>(table: &[(u64, u64, T, L)], pixels: u64, bitrate: u64) -> (T, L) {
    let (_, _, tier, level) = table
        .iter()
        .find(|(max_pixels, max_bitrate, _, _)| pixels <= *max_pixels && bitrate <= *max_bitrate)
        .or(table.last())
        .copied()
        .expect("level tables are not empty");
    (tier, level)
}

/// H.264 levels: most macroblocks a frame, most bits a second, level_idc.
const AVC_LEVELS: &[(u64, u64, u8)] = &[
    (99, 64_000, 0x0a),
    (396, 192_000, 0x0b),
    (396, 384_000, 0x0c),
    (396, 768_000, 0x0d),
    (396, 2_000_000, 0x14),
    (792, 4_000_000, 0x15),
    (1_620, 4_000_000, 0x16),
    (1_620, 10_000_000, 0x1e),
    (3_600, 14_000_000, 0x1f),
    (5_120, 20_000_000, 0x20),
    (8_192, 20_000_000, 0x28),
    (8_192, 50_000_000, 0x29),
    (8_704, 50_000_000, 0x2a),
    (22_080, 135_000_000, 0x32),
    (36_864, 240_000_000, 0x33),
    (36_864, 240_000_000, 0x34),
    (139_264, 240_000_000, 0x3c),
    (139_264, 480_000_000, 0x3d),
    (139_264, 800_000_000, 0x3e),
];

/// HEVC levels: most pixels a frame, most bits a second, tier, level × 30.
const HEVC_LEVELS: &[(u64, u64, char, u8)] = &[
    (36_864, 128_000, 'L', 30),
    (122_880, 1_500_000, 'L', 60),
    (245_760, 3_000_000, 'L', 63),
    (552_960, 6_000_000, 'L', 90),
    (983_040, 10_000_000, 'L', 93),
    (2_228_224, 12_000_000, 'L', 120),
    (2_228_224, 30_000_000, 'H', 120),
    (2_228_224, 20_000_000, 'L', 123),
    (2_228_224, 50_000_000, 'H', 123),
    (8_912_896, 25_000_000, 'L', 150),
    (8_912_896, 100_000_000, 'H', 150),
    (8_912_896, 40_000_000, 'L', 153),
    (8_912_896, 160_000_000, 'H', 153),
    (8_912_896, 60_000_000, 'L', 156),
    (8_912_896, 240_000_000, 'H', 156),
    (35_651_584, 60_000_000, 'L', 180),
    (35_651_584, 240_000_000, 'H', 180),
    (35_651_584, 120_000_000, 'L', 183),
    (35_651_584, 480_000_000, 'H', 183),
    (35_651_584, 240_000_000, 'L', 186),
    (35_651_584, 800_000_000, 'H', 186),
];

/// VP9 levels: most pixels a frame, most bits a second, level × 10.
const VP9_LEVELS: &[(u64, u64, (), u8)] = &[
    (36_864, 200_000, (), 10),
    (73_728, 800_000, (), 11),
    (122_880, 1_800_000, (), 20),
    (245_760, 3_600_000, (), 21),
    (552_960, 7_200_000, (), 30),
    (983_040, 12_000_000, (), 31),
    (2_228_224, 18_000_000, (), 40),
    (2_228_224, 30_000_000, (), 41),
    (8_912_896, 60_000_000, (), 50),
    (8_912_896, 120_000_000, (), 51),
    (8_912_896, 180_000_000, (), 52),
    (35_651_584, 180_000_000, (), 60),
    (35_651_584, 240_000_000, (), 61),
    (35_651_584, 480_000_000, (), 62),
];

/// AV1 levels: most pixels a frame, most bits a second, tier, seq_level_idx.
const AV1_LEVELS: &[(u64, u64, char, u8)] = &[
    (147_456, 1_500_000, 'M', 0),
    (278_784, 3_000_000, 'M', 1),
    (665_856, 6_000_000, 'M', 4),
    (1_065_024, 10_000_000, 'M', 5),
    (2_359_296, 12_000_000, 'M', 8),
    (2_359_296, 30_000_000, 'H', 8),
    (2_359_296, 20_000_000, 'M', 9),
    (2_359_296, 50_000_000, 'H', 9),
    (8_912_896, 30_000_000, 'M', 12),
    (8_912_896, 100_000_000, 'H', 12),
    (8_912_896, 40_000_000, 'M', 13),
    (8_912_896, 160_000_000, 'H', 13),
    (8_912_896, 60_000_000, 'M', 14),
    (8_912_896, 240_000_000, 'H', 14),
    (35_651_584, 60_000_000, 'M', 15),
    (35_651_584, 240_000_000, 'H', 15),
    (35_651_584, 60_000_000, 'M', 16),
    (35_651_584, 240_000_000, 'H', 16),
    (35_651_584, 100_000_000, 'M', 17),
    (35_651_584, 480_000_000, 'H', 17),
    (35_651_584, 160_000_000, 'M', 18),
    (35_651_584, 800_000_000, 'H', 18),
    (35_651_584, 160_000_000, 'M', 19),
    (35_651_584, 800_000_000, 'H', 19),
];

/// The video track's clock for `fps` frames a second: `(timescale,
/// frame_duration)` with `timescale / frame_duration` the frame rate, so
/// every frame lasts a whole number of ticks (30 → 30/1, 29.97 → 2997/100).
pub fn frame_clock(fps: f64) -> Result<(u32, u32)> {
    if !fps.is_finite() || fps <= 0.0 {
        return Err(invalid("frame rate must be positive"));
    }
    (1..=1001_u32)
        .find_map(|duration| {
            let timescale = (fps * f64::from(duration)).round();
            ((timescale / f64::from(duration) - fps).abs() <= fps * 1e-9 && timescale >= 1.0)
                .then_some((timescale as u32, duration))
        })
        .ok_or_else(|| invalid("frame rate has no exact clock"))
}

/// Wraps a box payload with its 32-bit size and fourcc.
pub fn wrap_box(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut boxed = Vec::with_capacity(8 + payload.len());
    boxed.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
    boxed.extend_from_slice(fourcc);
    boxed.extend_from_slice(payload);
    boxed
}

/// The video track's sample-entry configuration box, from the encoder's
/// first key frame and the `decoderConfig.description` it reported. H.264
/// and HEVC parameter sets come out of band as `description`; AV1's sequence
/// header and VP9's color description come from the key frame itself; VP8
/// has none.
pub fn video_decoder_config(
    codec: VideoCodec,
    key_frame: &[u8],
    description: Option<&[u8]>,
    vp9_level: u8,
) -> Result<Vec<u8>> {
    let missing = || invalid("the video encoder reported no decoder configuration");
    Ok(match codec {
        VideoCodec::H264 => wrap_box(b"avcC", description.ok_or_else(missing)?),
        VideoCodec::Hevc => wrap_box(b"hvcC", description.ok_or_else(missing)?),
        VideoCodec::Av1 => av1c_from_key_frame(key_frame).ok_or_else(missing)?,
        VideoCodec::Vp8 => Vec::new(),
        VideoCodec::Vp9 => {
            zvidlib_vp9_syntax::vpcc_from_key_frame(key_frame, vp9_level).ok_or_else(missing)?
        }
    })
}

/// Builds the `av1C` box from the sequence header OBU in a key frame.
fn av1c_from_key_frame(data: &[u8]) -> Option<Vec<u8>> {
    let sequence_header_obu = sequence_header_obu(data)?;
    let mut parser = Av1Parser::new(Limits::default()).ok()?;
    let parsed = parser.parse_low_overhead(sequence_header_obu).ok()?;
    let sequence = parsed.iter().find_map(|obu| match obu {
        Av1Obu::SequenceHeader { sequence, .. } => Some(sequence),
        _ => None,
    })?;
    let operating_point = sequence.operating_points.first()?;
    let color = &sequence.color_config;
    let mut payload = vec![
        0x81,
        (sequence.seq_profile << 5) | (operating_point.level & 0x1f),
        (u8::from(operating_point.tier) << 7)
            | (u8::from(color.bit_depth > 8) << 6)
            | (u8::from(color.bit_depth == 12) << 5)
            | (u8::from(color.monochrome) << 4)
            | (u8::from(color.subsampling_x) << 3)
            | (u8::from(color.subsampling_y) << 2)
            | (color.chroma_sample_position & 3),
        0, // no initial presentation delay
    ];
    payload.extend_from_slice(sequence_header_obu);
    Some(wrap_box(b"av1C", &payload))
}

/// The first sequence header OBU (header, size and payload) in a low
/// overhead bitstream, which `av1C` embeds verbatim.
fn sequence_header_obu(bytes: &[u8]) -> Option<&[u8]> {
    const SEQUENCE_HEADER: u8 = 1;
    let mut offset = 0;
    while offset < bytes.len() {
        let header = bytes[offset];
        if header & 0b10 == 0 {
            // An OBU without a size field can't be bounded without decoding.
            return None;
        }
        let size_offset = offset + 1 + usize::from(header & 0b100 != 0);
        let (payload_len, leb_len) = read_leb128(bytes.get(size_offset..)?)?;
        let end = (size_offset + leb_len).checked_add(usize::try_from(payload_len).ok()?)?;
        let obu = bytes.get(offset..end)?;
        if (header >> 3) & 0b1111 == SEQUENCE_HEADER {
            return Some(obu);
        }
        offset = end;
    }
    None
}

fn read_leb128(bytes: &[u8]) -> Option<(u64, usize)> {
    let mut value = 0_u64;
    for (index, &byte) in bytes.iter().enumerate().take(8) {
        value |= u64::from(byte & 0x7f) << (index * 7);
        if byte & 0x80 == 0 {
            return Some((value, index + 1));
        }
    }
    None
}

fn write_descriptor(out: &mut Vec<u8>, tag: u8, content: &[u8]) {
    out.push(tag);
    let length = content.len() as u32;
    let mut shift = 21;
    while shift > 0 && length >> shift == 0 {
        shift -= 7;
    }
    while shift > 0 {
        out.push(((length >> shift) & 0x7f) as u8 | 0x80);
        shift -= 7;
    }
    out.push((length & 0x7f) as u8);
    out.extend_from_slice(content);
}

/// The `esds` box declaring an AAC track whose `AudioSpecificConfig` the
/// encoder reported as its `decoderConfig.description`.
pub fn esds_box(audio_specific_config: &[u8]) -> Vec<u8> {
    let mut decoder_config = vec![
        0x40, // MPEG-4 audio
        0x15, // audio stream, upstream 0, reserved 1
        0, 0, 0, // bufferSizeDB
        0, 0, 0, 0, // maxBitrate
        0, 0, 0, 0, // avgBitrate
    ];
    write_descriptor(&mut decoder_config, 0x05, audio_specific_config);
    let mut es = vec![0, 0, 0]; // ES_ID, flags
    write_descriptor(&mut es, 0x04, &decoder_config);
    write_descriptor(&mut es, 0x06, &[0x02]); // MP4 predefined SLConfig
    let mut payload = vec![0, 0, 0, 0]; // FullBox version and flags
    write_descriptor(&mut payload, 0x03, &es);
    wrap_box(b"esds", &payload)
}

/// The AAC `AudioSpecificConfig` for AAC-LC at `sample_rate` with
/// `channels`, for encoders that report none.
pub fn aac_lc_audio_specific_config(sample_rate: u32, channels: u16) -> Vec<u8> {
    const RATES: [u32; 13] = [
        96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025,
        8_000, 7_350,
    ];
    let index = RATES.iter().position(|rate| *rate == sample_rate).unwrap_or(15) as u16;
    let channels = channels.min(15);
    let mut config = Vec::with_capacity(5);
    if index == 15 {
        // An explicit 24-bit rate follows the escape index.
        let bits: u64 = (2 << 35) | (15 << 31) | (u64::from(sample_rate) << 7) | (u64::from(channels) << 3);
        config.extend_from_slice(&bits.to_be_bytes()[3..]);
    } else {
        let bits = (2 << 11) | (index << 7) | (channels << 3);
        config.extend_from_slice(&bits.to_be_bytes());
    }
    config
}

/// The video track's dimensions, checked for an encode.
pub fn dimensions(width: u32, height: u32) -> Result<VideoDimensions> {
    if width == 0 || height == 0 {
        return Err(invalid("video dimensions must be positive"));
    }
    Ok(VideoDimensions { width, height })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_strings_name_the_lowest_fitting_level() {
        assert_eq!(VideoCodec::H264.codec_string(1920, 1080, 12_000_000), "avc1.640028");
        assert_eq!(VideoCodec::H264.codec_string(1280, 720, 8_000_000), "avc1.64001f");
        assert_eq!(VideoCodec::Hevc.codec_string(1920, 1080, 12_000_000), "hev1.1.6.L120.B0");
        assert_eq!(VideoCodec::Hevc.codec_string(1080, 1920, 25_000_000), "hev1.1.6.H120.B0");
        assert_eq!(VideoCodec::Av1.codec_string(1920, 1080, 12_000_000), "av01.0.08M.08");
        assert_eq!(VideoCodec::Vp9.codec_string(1920, 1080, 12_000_000), "vp09.00.40.08");
        assert_eq!(VideoCodec::Vp8.codec_string(1920, 1080, 12_000_000), "vp8");
    }

    #[test]
    fn codec_strings_fall_back_to_the_top_level() {
        assert_eq!(VideoCodec::H264.codec_string(16_384, 16_384, 900_000_000), "avc1.64003e");
        assert_eq!(VideoCodec::Hevc.codec_string(16_384, 16_384, 900_000_000), "hev1.1.6.H186.B0");
    }

    #[test]
    fn frame_clocks_last_whole_ticks() {
        assert_eq!(frame_clock(30.0).unwrap(), (30, 1));
        assert_eq!(frame_clock(29.97).unwrap(), (2997, 100));
        assert_eq!(frame_clock(30_000.0 / 1001.0).unwrap(), (30_000, 1001));
        assert_eq!(frame_clock(23.976).unwrap(), (2997, 125));
        assert!(frame_clock(0.0).is_err());
        assert!(frame_clock(f64::NAN).is_err());
    }

    #[test]
    fn h264_and_hevc_configs_wrap_the_description() {
        let description = [1, 0x64, 0, 0x28];
        assert_eq!(
            video_decoder_config(VideoCodec::H264, &[], Some(&description), 0).unwrap(),
            [0, 0, 0, 12, b'a', b'v', b'c', b'C', 1, 0x64, 0, 0x28]
        );
        assert_eq!(
            &video_decoder_config(VideoCodec::Hevc, &[], Some(&description), 0).unwrap()[4..8],
            b"hvcC"
        );
        assert!(video_decoder_config(VideoCodec::H264, &[], None, 0).is_err());
    }

    #[test]
    fn vp8_has_no_config_and_av1_needs_a_sequence_header() {
        assert!(video_decoder_config(VideoCodec::Vp8, &[1, 2, 3], None, 0).unwrap().is_empty());
        // A temporal delimiter OBU alone.
        assert!(video_decoder_config(VideoCodec::Av1, &[0x12, 0], None, 0).is_err());
    }

    #[test]
    fn audio_specific_configs_name_aac_lc() {
        assert_eq!(aac_lc_audio_specific_config(48_000, 2), [0x11, 0x90]);
        assert_eq!(aac_lc_audio_specific_config(44_100, 2), [0x12, 0x10]);
        assert_eq!(aac_lc_audio_specific_config(44_000, 1).len(), 5);
    }

    #[test]
    fn esds_wraps_the_audio_specific_config() {
        let esds = esds_box(&[0x11, 0x90]);
        assert_eq!(&esds[4..8], b"esds");
        assert_eq!(u32::from_be_bytes(esds[..4].try_into().unwrap()) as usize, esds.len());
        assert_eq!(&esds[esds.len() - 5..], [0x11, 0x90, 0x06, 0x01, 0x02]);
    }
}
