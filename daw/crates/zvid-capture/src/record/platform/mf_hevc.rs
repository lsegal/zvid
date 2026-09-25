//! Media Foundation HEVC encoder: the GPU vendor's hardware MFT when one is
//! registered (NVENC, Quick Sync, AMF), else Microsoft's software HEVC MFT
//! from the HEVC Video Extensions.
//!
//! The encoder is set up for capture: no B-frames (so output order is input
//! order), low latency, a keyframe every second. Hardware MFTs are
//! asynchronous and are driven by their event queue; software ones are
//! synchronous. Output is Annex B; parameter sets are moved into the `hvcC`
//! and each access unit is rewritten with four-byte lengths.

use std::mem::ManuallyDrop;

use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::VARIANT;
use windows::core::Interface;

use crate::backend::ensure_mf;
use crate::format::Rational;
use crate::frame::Frame;
use crate::record::bitstream::{self, ParameterSets};
use crate::record::encoder::{EncodedFrame, FrameEncoder};

pub fn open(width: u32, height: u32, fps: Rational, bitrate: u32) -> Result<Box<dyn FrameEncoder>, String> {
    ensure_mf().map_err(|error| error.to_string())?;
    if width % 2 != 0 || height % 2 != 0 {
        return Err(format!("{width}x{height} is not a whole number of 4:2:0 chroma samples"));
    }
    let mut reasons = Vec::new();
    for hardware in [true, false] {
        for activate in candidates(hardware)? {
            let name = friendly_name(&activate);
            match MfHevc::create(&activate, hardware, width, height, fps, bitrate) {
                Ok(encoder) => return Ok(Box::new(encoder)),
                Err(error) => reasons.push(format!("{name}: {error}")),
            }
        }
    }
    if reasons.is_empty() {
        Err("no Media Foundation HEVC encoder is installed".to_string())
    } else {
        Err(reasons.join("; "))
    }
}

/// Registered NV12 → HEVC encoders, hardware or software.
fn candidates(hardware: bool) -> Result<Vec<IMFActivate>, String> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_HEVC,
    };
    let flags = if hardware {
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER
    } else {
        MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER
    };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: out pointers are valid; the array is freed below.
    unsafe {
        MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, Some(&input), Some(&output), &mut list, &mut count)
            .map_err(|error| format!("MFTEnumEx: {error}"))?;
        let found = (0..count as usize).filter_map(|index| (*list.add(index)).take()).collect();
        CoTaskMemFree(Some(list as *const _));
        Ok(found)
    }
}

fn friendly_name(activate: &IMFActivate) -> String {
    let mut value = windows::core::PWSTR::null();
    let mut len = 0;
    // SAFETY: out pointers are valid; the string is freed below.
    unsafe {
        if activate
            .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut value, &mut len)
            .is_err()
        {
            return "unnamed encoder".to_string();
        }
        let name = value.to_string().unwrap_or_default();
        CoTaskMemFree(Some(value.0 as *const _));
        name
    }
}

struct MfHevc {
    transform: IMFTransform,
    /// The event queue of an asynchronous MFT.
    events: Option<IMFMediaEventGenerator>,
    /// `METransformNeedInput` events not yet answered.
    need_input: u32,
    provides_samples: bool,
    output_size: u32,
    hardware: bool,
    width: u32,
    height: u32,
    frame_100ns: i64,
    submitted: i64,
    sets: ParameterSets,
    hvcc: Option<Vec<u8>>,
}

impl MfHevc {
    fn create(activate: &IMFActivate, hardware: bool, width: u32, height: u32, fps: Rational, bitrate: u32) -> Result<Self, String> {
        // SAFETY: plain Media Foundation calls on objects this thread owns.
        unsafe {
            let transform: IMFTransform = activate.ActivateObject().map_err(|e| format!("activate: {e}"))?;
            let attributes = transform.GetAttributes().ok();
            let is_async = attributes
                .as_ref()
                .and_then(|a| a.GetUINT32(&MF_TRANSFORM_ASYNC).ok())
                .unwrap_or(0)
                != 0;
            let events = if is_async {
                let attributes = attributes.as_ref().ok_or("async MFT has no attributes")?;
                attributes
                    .SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)
                    .map_err(|e| format!("unlock async MFT: {e}"))?;
                Some(transform.cast::<IMFMediaEventGenerator>().map_err(|e| e.to_string())?)
            } else {
                None
            };
            if let Some(attributes) = &attributes {
                let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);
            }

            let frame_size = (u64::from(width) << 32) | u64::from(height);
            let frame_rate = (u64::from(fps.num) << 32) | u64::from(fps.den);

            let output = MFCreateMediaType().map_err(|e| e.to_string())?;
            output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| e.to_string())?;
            output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_HEVC).map_err(|e| e.to_string())?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(|e| e.to_string())?;
            output.SetUINT64(&MF_MT_FRAME_SIZE, frame_size).map_err(|e| e.to_string())?;
            output.SetUINT64(&MF_MT_FRAME_RATE, frame_rate).map_err(|e| e.to_string())?;
            output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1).map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| e.to_string())?;
            output
                .SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH265VProfile_Main_420_8.0 as u32)
                .map_err(|e| e.to_string())?;
            transform.SetOutputType(0, &output, 0).map_err(|e| format!("output type: {e}"))?;

            let input = MFCreateMediaType().map_err(|e| e.to_string())?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| e.to_string())?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12).map_err(|e| e.to_string())?;
            input.SetUINT64(&MF_MT_FRAME_SIZE, frame_size).map_err(|e| e.to_string())?;
            input.SetUINT64(&MF_MT_FRAME_RATE, frame_rate).map_err(|e| e.to_string())?;
            input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1).map_err(|e| e.to_string())?;
            input
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| e.to_string())?;
            transform.SetInputType(0, &input, 0).map_err(|e| format!("input type: {e}"))?;

            // Settings the encoder may not support are best effort, except
            // B-frames: output must stay in input order.
            if let Ok(codec) = transform.cast::<ICodecAPI>() {
                let gop = fps.num.div_ceil(fps.den).max(1);
                let _ = codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true));
                let _ = codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(gop));
                let _ = codec.SetValue(
                    &CODECAPI_AVEncCommonRateControlMode,
                    &VARIANT::from(eAVEncCommonRateControlMode_PeakConstrainedVBR.0 as u32),
                );
                let _ = codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &VARIANT::from(bitrate));
                let _ = codec.SetValue(&CODECAPI_AVEncCommonMaxBitRate, &VARIANT::from(bitrate.saturating_mul(2)));
                let _ = codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &VARIANT::from(0u32));
            }

            let info = transform.GetOutputStreamInfo(0).map_err(|e| e.to_string())?;
            let provides_samples = info.dwFlags
                & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32)
                != 0;
            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
                .map_err(|e| e.to_string())?;
            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
                .map_err(|e| e.to_string())?;

            let mut encoder = Self {
                transform,
                events,
                need_input: 0,
                provides_samples,
                output_size: info.cbSize.max(width * height * 3 / 2),
                hardware,
                width,
                height,
                frame_100ns: (10_000_000 * i64::from(fps.den)) / i64::from(fps.num),
                submitted: 0,
                sets: ParameterSets::default(),
                hvcc: None,
            };
            encoder.read_sequence_header();
            Ok(encoder)
        }
    }

    /// Some encoders publish the parameter sets on the output type up front.
    fn read_sequence_header(&mut self) {
        // SAFETY: the blob is freed after copying.
        unsafe {
            let Ok(kind) = self.transform.GetOutputCurrentType(0) else {
                return;
            };
            let mut data = std::ptr::null_mut();
            let mut len = 0;
            if kind.GetAllocatedBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut data, &mut len).is_ok() {
                let header = std::slice::from_raw_parts(data, len as usize).to_vec();
                CoTaskMemFree(Some(data as *const _));
                for nal in bitstream::split_annex_b(&header) {
                    self.sets.collect(nal);
                }
                self.hvcc = self.sets.hvcc();
            }
        }
    }

    fn input_sample(&mut self, frame: &Frame) -> Result<IMFSample, String> {
        let len = Frame::nv12_len(self.width, self.height);
        if frame.width != self.width || frame.height != self.height || frame.data.len() < len {
            return Err(format!(
                "frame is {}x{}, encoder expects {}x{}",
                frame.width, frame.height, self.width, self.height
            ));
        }
        // SAFETY: the buffer is locked for the copy and holds `len` bytes.
        unsafe {
            let buffer = MFCreateMemoryBuffer(len as u32).map_err(|e| e.to_string())?;
            let mut data = std::ptr::null_mut();
            buffer.Lock(&mut data, None, None).map_err(|e| e.to_string())?;
            std::ptr::copy_nonoverlapping(frame.data.as_ptr(), data, len);
            buffer.Unlock().map_err(|e| e.to_string())?;
            buffer.SetCurrentLength(len as u32).map_err(|e| e.to_string())?;
            let sample = MFCreateSample().map_err(|e| e.to_string())?;
            sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
            sample
                .SetSampleTime(self.submitted * self.frame_100ns)
                .map_err(|e| e.to_string())?;
            sample.SetSampleDuration(self.frame_100ns).map_err(|e| e.to_string())?;
            self.submitted += 1;
            Ok(sample)
        }
    }

    /// Pulls every output the MFT has ready.
    fn drain_output(&mut self, out: &mut Vec<EncodedFrame>) -> Result<(), String> {
        loop {
            match self.process_output()? {
                Some(frame) => out.extend(frame),
                None => return Ok(()),
            }
        }
    }

    /// One `ProcessOutput` call: `None` when the MFT needs more input.
    fn process_output(&mut self) -> Result<Option<Option<EncodedFrame>>, String> {
        // SAFETY: the output buffer array lives across the call, and the
        // sample and events it may hold are released below.
        unsafe {
            let sample = if self.provides_samples {
                None
            } else {
                let sample = MFCreateSample().map_err(|e| e.to_string())?;
                let buffer = MFCreateMemoryBuffer(self.output_size).map_err(|e| e.to_string())?;
                sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
                Some(sample)
            };
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(sample),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            }];
            let mut status = 0;
            let result = self.transform.ProcessOutput(0, &mut buffers, &mut status);
            let sample = ManuallyDrop::take(&mut buffers[0].pSample);
            drop(ManuallyDrop::take(&mut buffers[0].pEvents));
            match result {
                Ok(()) => {}
                Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(None),
                Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                    let kind = self.transform.GetOutputAvailableType(0, 0).map_err(|e| e.to_string())?;
                    self.transform.SetOutputType(0, &kind, 0).map_err(|e| e.to_string())?;
                    let info = self.transform.GetOutputStreamInfo(0).map_err(|e| e.to_string())?;
                    self.output_size = info.cbSize.max(self.output_size);
                    return Ok(Some(None));
                }
                Err(error) => return Err(format!("ProcessOutput: {error}")),
            }
            let Some(sample) = sample else {
                return Ok(Some(None));
            };
            let buffer = sample.ConvertToContiguousBuffer().map_err(|e| e.to_string())?;
            let mut data = std::ptr::null_mut();
            let mut len = 0;
            buffer.Lock(&mut data, None, Some(&mut len)).map_err(|e| e.to_string())?;
            let stream = std::slice::from_raw_parts(data, len as usize).to_vec();
            buffer.Unlock().map_err(|e| e.to_string())?;
            let clean_point = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) != 0;
            Ok(Some(self.to_frame(&stream, clean_point)))
        }
    }

    /// Converts an Annex B access unit, keeping parameter sets for `hvcC`.
    fn to_frame(&mut self, stream: &[u8], clean_point: bool) -> Option<EncodedFrame> {
        let units = bitstream::split_annex_b(stream);
        let mut is_sync = clean_point;
        let mut picture = Vec::new();
        for unit in units {
            if bitstream::is_out_of_band(unit) {
                self.sets.collect(unit);
            } else {
                is_sync |= bitstream::is_irap(unit);
                picture.push(unit);
            }
        }
        if self.hvcc.is_none() {
            self.hvcc = self.sets.hvcc();
        }
        let has_picture = picture.iter().any(|unit| bitstream::nal_type(unit) < 32);
        has_picture.then(|| EncodedFrame {
            data: bitstream::length_prefixed(picture),
            is_sync,
        })
    }

    /// Handles one event from an asynchronous MFT.
    fn on_event(&mut self, event: &IMFMediaEvent, out: &mut Vec<EncodedFrame>) -> Result<Option<u32>, String> {
        // SAFETY: plain COM calls.
        let kind = unsafe { event.GetType() }.map_err(|e| e.to_string())?;
        if kind == METransformNeedInput.0 as u32 {
            self.need_input += 1;
        } else if kind == METransformHaveOutput.0 as u32 {
            if let Some(frame) = self.process_output()? {
                out.extend(frame);
            }
        }
        Ok(Some(kind))
    }

    fn next_event(&mut self, wait: bool, out: &mut Vec<EncodedFrame>) -> Result<Option<u32>, String> {
        let events = self.events.clone().expect("async MFT");
        let flags = if wait {
            MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0)
        } else {
            MF_EVENT_FLAG_NO_WAIT
        };
        // SAFETY: plain COM call.
        match unsafe { events.GetEvent(flags) } {
            Ok(event) => self.on_event(&event, out),
            Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => Ok(None),
            Err(error) => Err(format!("GetEvent: {error}")),
        }
    }
}

impl FrameEncoder for MfHevc {
    fn name(&self) -> &'static str {
        if self.hardware {
            "Media Foundation HEVC (hardware)"
        } else {
            "Media Foundation HEVC (software)"
        }
    }

    fn codec(&self) -> zvidlib::Codec {
        zvidlib::Codec::Hevc
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn decoder_config(&self) -> Option<Vec<u8>> {
        self.hvcc.clone()
    }

    fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedFrame>, String> {
        let sample = self.input_sample(frame)?;
        let mut out = Vec::new();
        if self.events.is_some() {
            while self.need_input == 0 {
                self.next_event(true, &mut out)?;
            }
            // SAFETY: plain COM call.
            unsafe { self.transform.ProcessInput(0, &sample, 0) }.map_err(|e| format!("ProcessInput: {e}"))?;
            self.need_input -= 1;
            while self.next_event(false, &mut out)?.is_some() {}
        } else {
            // SAFETY: plain COM call.
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
        }
        Ok(out)
    }

    fn finish(&mut self) -> Result<Vec<EncodedFrame>, String> {
        let mut out = Vec::new();
        // SAFETY: plain COM calls.
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)
                .map_err(|e| format!("drain: {e}"))?;
        }
        if self.events.is_some() {
            while self.next_event(true, &mut out)? != Some(METransformDrainComplete.0 as u32) {}
        } else {
            self.drain_output(&mut out)?;
        }
        Ok(out)
    }
}

impl Drop for MfHevc {
    fn drop(&mut self) {
        // SAFETY: plain COM calls; the MFT is released afterwards.
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            if let Some(events) = self.events.take()
                && let Ok(shutdown) = events.cast::<IMFShutdown>()
            {
                let _ = shutdown.Shutdown();
            }
        }
    }
}

