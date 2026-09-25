//! Media Foundation AAC-LC encoder (Microsoft's AAC encoder MFT).
//!
//! It takes 16-bit PCM at 44.1 or 48 kHz, mono or stereo, and returns one
//! raw AAC frame (1024 PCM frames) per output sample. Other rates are
//! resampled to one it takes.

use std::mem::ManuallyDrop;

use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use zvidlib::AudioGapless;

use crate::backend::ensure_mf;
use crate::record::bitstream::{aac_lc_config, esds_box};
use crate::record::encoder::{AAC_FRAME, PcmEncoder};
use crate::record::resample::Resampled;

/// Output bitrate: 192 kb/s, the highest the MFT offers.
const BYTES_PER_SECOND: u32 = 24_000;
/// The MFT's encoder delay, in PCM frames. Measured with an impulse: it
/// trims its own delay, so decoded output starts at input frame 0.
const PRIMING: u32 = 0;

pub fn open(sample_rate: u32, channels: u16) -> Result<Box<dyn PcmEncoder>, String> {
    ensure_mf().map_err(|error| error.to_string())?;
    if !matches!(channels, 1 | 2) {
        return Err(format!(
            "the Media Foundation AAC encoder takes mono or stereo, not {channels} channels"
        ));
    }
    let transform = find()?;
    let rate = encoder_rate(sample_rate);
    let encoder = Box::new(MfAac::create(transform, rate, channels)?);
    Ok(if rate == sample_rate {
        encoder
    } else {
        Box::new(Resampled::new(encoder, sample_rate, channels))
    })
}

/// The rate to encode `sample_rate` input at: itself when the encoder takes
/// it, 44.1 kHz for the 44.1 kHz family (88.2, 176.4 kHz, ...), and 48 kHz
/// for everything else, so common session rates resample by a whole factor.
fn encoder_rate(sample_rate: u32) -> u32 {
    match sample_rate {
        44_100 | 48_000 => sample_rate,
        rate if rate % 11_025 == 0 => 44_100,
        _ => 48_000,
    }
}

fn find() -> Result<IMFTransform, String> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Audio,
        guidSubtype: MFAudioFormat_PCM,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Audio,
        guidSubtype: MFAudioFormat_AAC,
    };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: out pointers are valid; the array is freed below.
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_AUDIO_ENCODER,
            MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &mut list,
            &mut count,
        )
        .map_err(|error| format!("MFTEnumEx: {error}"))?;
        let found: Vec<IMFActivate> = (0..count as usize)
            .filter_map(|index| (*list.add(index)).take())
            .collect();
        CoTaskMemFree(Some(list as *const _));
        let activate = found
            .first()
            .ok_or("no Media Foundation AAC encoder is installed")?;
        activate
            .ActivateObject()
            .map_err(|error| format!("activate: {error}"))
    }
}

struct MfAac {
    transform: IMFTransform,
    channels: u16,
    output_size: u32,
    audio_specific_config: Vec<u8>,
    /// PCM frames handed to the encoder.
    input_frames: u64,
    /// AAC frames returned.
    packets: u64,
    sample_rate: u32,
    finished: bool,
}

impl MfAac {
    fn create(transform: IMFTransform, sample_rate: u32, channels: u16) -> Result<Self, String> {
        // SAFETY: plain Media Foundation calls on objects this thread owns.
        unsafe {
            let block_align = u32::from(channels) * 2;
            let input = MFCreateMediaType().map_err(|e| e.to_string())?;
            input
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
                .map_err(|e| e.to_string())?;
            input
                .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)
                .map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)
                .map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sample_rate)
                .map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, u32::from(channels))
                .map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block_align)
                .map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, sample_rate * block_align)
                .map_err(|e| e.to_string())?;

            let output = MFCreateMediaType().map_err(|e| e.to_string())?;
            output
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
                .map_err(|e| e.to_string())?;
            output
                .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sample_rate)
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, u32::from(channels))
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, BYTES_PER_SECOND)
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)
                .map_err(|e| e.to_string())?;

            transform
                .SetInputType(0, &input, 0)
                .map_err(|e| format!("input type: {e}"))?;
            transform
                .SetOutputType(0, &output, 0)
                .map_err(|e| format!("output type: {e}"))?;

            let audio_specific_config = read_audio_specific_config(&transform)
                .or_else(|| aac_lc_config(sample_rate, channels).map(|config| config.to_vec()))
                .ok_or("no AudioSpecificConfig")?;
            let info = transform
                .GetOutputStreamInfo(0)
                .map_err(|e| e.to_string())?;
            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
                .map_err(|e| e.to_string())?;
            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
                .map_err(|e| e.to_string())?;
            Ok(Self {
                transform,
                channels,
                output_size: info.cbSize.max(8192),
                audio_specific_config,
                input_frames: 0,
                packets: 0,
                sample_rate,
                finished: false,
            })
        }
    }

    fn drain_output(&mut self, out: &mut Vec<Vec<u8>>) -> Result<(), String> {
        loop {
            // SAFETY: the output buffer array lives across the call, and the
            // sample and events it holds are released below.
            unsafe {
                let sample = MFCreateSample().map_err(|e| e.to_string())?;
                let buffer = MFCreateMemoryBuffer(self.output_size).map_err(|e| e.to_string())?;
                sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
                let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                    dwStreamID: 0,
                    pSample: ManuallyDrop::new(Some(sample)),
                    dwStatus: 0,
                    pEvents: ManuallyDrop::new(None),
                }];
                let mut status = 0;
                let result = self.transform.ProcessOutput(0, &mut buffers, &mut status);
                let sample = ManuallyDrop::take(&mut buffers[0].pSample);
                drop(ManuallyDrop::take(&mut buffers[0].pEvents));
                match result {
                    Ok(()) => {}
                    Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(()),
                    Err(error) => return Err(format!("ProcessOutput: {error}")),
                }
                let Some(sample) = sample else { continue };
                let buffer = sample
                    .ConvertToContiguousBuffer()
                    .map_err(|e| e.to_string())?;
                let mut data = std::ptr::null_mut();
                let mut len = 0;
                buffer
                    .Lock(&mut data, None, Some(&mut len))
                    .map_err(|e| e.to_string())?;
                let packet = std::slice::from_raw_parts(data, len as usize).to_vec();
                buffer.Unlock().map_err(|e| e.to_string())?;
                if !packet.is_empty() {
                    self.packets += 1;
                    out.push(packet);
                }
            }
        }
    }

    fn submit(&mut self, pcm: &[i16]) -> Result<Vec<Vec<u8>>, String> {
        let mut out = Vec::new();
        if pcm.is_empty() {
            return Ok(out);
        }
        let bytes = pcm.len() * 2;
        // SAFETY: the buffer is locked for the copy and holds `bytes` bytes.
        let sample = unsafe {
            let buffer = MFCreateMemoryBuffer(bytes as u32).map_err(|e| e.to_string())?;
            let mut data = std::ptr::null_mut();
            buffer
                .Lock(&mut data, None, None)
                .map_err(|e| e.to_string())?;
            std::ptr::copy_nonoverlapping(pcm.as_ptr().cast::<u8>(), data, bytes);
            buffer.Unlock().map_err(|e| e.to_string())?;
            buffer
                .SetCurrentLength(bytes as u32)
                .map_err(|e| e.to_string())?;
            let sample = MFCreateSample().map_err(|e| e.to_string())?;
            sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
            let frames = (pcm.len() / usize::from(self.channels)) as i64;
            let rate = i64::from(self.sample_rate);
            sample
                .SetSampleTime(self.input_frames as i64 * 10_000_000 / rate)
                .map_err(|e| e.to_string())?;
            sample
                .SetSampleDuration(frames * 10_000_000 / rate)
                .map_err(|e| e.to_string())?;
            sample
        };
        self.input_frames += (pcm.len() / usize::from(self.channels)) as u64;
        // SAFETY: plain COM calls.
        match unsafe { self.transform.ProcessInput(0, &sample, 0) } {
            Ok(()) => {}
            Err(error) if error.code() == MF_E_NOTACCEPTING => {
                self.drain_output(&mut out)?;
                // SAFETY: plain COM call.
                unsafe { self.transform.ProcessInput(0, &sample, 0) }
                    .map_err(|e| format!("ProcessInput: {e}"))?;
            }
            Err(error) => return Err(format!("ProcessInput: {error}")),
        }
        self.drain_output(&mut out)?;
        Ok(out)
    }
}

/// The `AudioSpecificConfig` from the output type's `HEAACWAVEINFO` user
/// data: 12 bytes of wave info, then the config.
fn read_audio_specific_config(transform: &IMFTransform) -> Option<Vec<u8>> {
    // SAFETY: the blob is freed after copying.
    unsafe {
        let kind = transform.GetOutputCurrentType(0).ok()?;
        let mut data = std::ptr::null_mut();
        let mut len = 0;
        kind.GetAllocatedBlob(&MF_MT_USER_DATA, &mut data, &mut len)
            .ok()?;
        let blob = std::slice::from_raw_parts(data, len as usize).to_vec();
        CoTaskMemFree(Some(data as *const _));
        blob.get(12..)
            .filter(|config| config.len() >= 2)
            .map(<[u8]>::to_vec)
    }
}

impl PcmEncoder for MfAac {
    fn name(&self) -> &'static str {
        "Media Foundation AAC-LC"
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn decoder_config(&self) -> Vec<u8> {
        esds_box(&self.audio_specific_config, BYTES_PER_SECOND * 8)
    }

    fn priming(&self) -> u32 {
        PRIMING
    }

    fn encode(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
        let pcm: Vec<i16> = interleaved
            .iter()
            .map(|&sample| (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16)
            .collect();
        self.submit(&pcm)
    }

    fn finish(&mut self) -> Result<(Vec<Vec<u8>>, AudioGapless), String> {
        if self.finished {
            return Ok((Vec::new(), AudioGapless::default()));
        }
        self.finished = true;
        // Silence to complete the last frame (and push out any encoder
        // delay), then drain.
        let frame = u64::from(AAC_FRAME);
        let partial = (self.input_frames % frame) as usize;
        let fill = if partial == 0 {
            0
        } else {
            AAC_FRAME as usize - partial
        };
        let silence = (fill + PRIMING as usize) * usize::from(self.channels);
        let mut out = self.submit(&vec![0; silence])?;
        // SAFETY: plain COM calls.
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)
                .map_err(|e| format!("drain: {e}"))?;
        }
        self.drain_output(&mut out)?;
        let real = self.input_frames - silence as u64 / u64::from(self.channels);
        let encoded = self.packets * frame;
        let padding = encoded.saturating_sub(real + u64::from(PRIMING));
        Ok((
            out,
            AudioGapless {
                priming: PRIMING,
                padding: u32::try_from(padding).unwrap_or(u32::MAX),
            },
        ))
    }
}

impl Drop for MfAac {
    fn drop(&mut self) {
        // SAFETY: plain COM call.
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
        }
    }
}
