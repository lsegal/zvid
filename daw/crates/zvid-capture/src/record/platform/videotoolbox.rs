//! VideoToolbox hardware HEVC encoder.
//!
//! A `VTCompressionSession` in real-time mode with frame reordering off, so
//! output order is input order, and a keyframe every second. Output is
//! already length-prefixed; the parameter sets come from the format
//! description and go into the `hvcC`.

use std::collections::VecDeque;
use std::ffi::c_void;
use std::ptr;
use std::sync::Mutex;

use crate::format::Rational;
use crate::frame::Frame;
use crate::record::bitstream::{self, ParameterSets};
use crate::record::encoder::{EncodedFrame, FrameEncoder};

type OSStatus = i32;
type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFMutableDictionaryRef = *mut c_void;
type CFArrayRef = *const c_void;
type CFBooleanRef = *const c_void;
type CMSampleBufferRef = *mut c_void;
type CMBlockBufferRef = *mut c_void;
type CMFormatDescriptionRef = *mut c_void;
type CVPixelBufferRef = *mut c_void;
type CVPixelBufferPoolRef = *mut c_void;
type VTCompressionSessionRef = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

const CM_TIME_VALID: u32 = 1;
const CM_TIME_INVALID: CMTime = CMTime {
    value: 0,
    timescale: 0,
    flags: 0,
    epoch: 0,
};
const HEVC: u32 = u32::from_be_bytes(*b"hvc1");
/// `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`, what capture delivers.
const NV12_VIDEO_RANGE: u32 = u32::from_be_bytes(*b"420v");
const CF_NUMBER_SINT32: isize = 3;
const CF_NUMBER_FLOAT64: isize = 6;
/// `kVTEncodeInfo_FrameDropped`.
const FRAME_DROPPED: u32 = 1 << 1;

type OutputCallback = extern "C" fn(
    refcon: *mut c_void,
    frame_refcon: *mut c_void,
    status: OSStatus,
    flags: u32,
    sample: CMSampleBufferRef,
);

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    // Only their addresses are used.
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;
    static kCFBooleanTrue: CFBooleanRef;
    static kCFBooleanFalse: CFBooleanRef;
    fn CFDictionaryCreateMutable(
        allocator: *const c_void,
        capacity: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFMutableDictionaryRef;
    fn CFDictionarySetValue(
        dictionary: CFMutableDictionaryRef,
        key: *const c_void,
        value: *const c_void,
    );
    fn CFDictionaryGetValue(dictionary: CFDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberCreate(allocator: *const c_void, kind: isize, value: *const c_void) -> CFTypeRef;
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> *const c_void;
    fn CFBooleanGetValue(boolean: CFBooleanRef) -> u8;
    fn CFRelease(value: CFTypeRef);
}

#[link(name = "CoreVideo", kind = "framework")]
unsafe extern "C" {
    static kCVPixelBufferPixelFormatTypeKey: CFStringRef;
    static kCVPixelBufferWidthKey: CFStringRef;
    static kCVPixelBufferHeightKey: CFStringRef;
    fn CVPixelBufferPoolCreatePixelBuffer(
        allocator: *const c_void,
        pool: CVPixelBufferPoolRef,
        out: *mut CVPixelBufferRef,
    ) -> i32;
    fn CVPixelBufferLockBaseAddress(buffer: CVPixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(buffer: CVPixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddressOfPlane(buffer: CVPixelBufferRef, plane: usize) -> *mut u8;
    fn CVPixelBufferGetBytesPerRowOfPlane(buffer: CVPixelBufferRef, plane: usize) -> usize;
    fn CVPixelBufferGetHeightOfPlane(buffer: CVPixelBufferRef, plane: usize) -> usize;
}

#[link(name = "CoreMedia", kind = "framework")]
unsafe extern "C" {
    static kCMSampleAttachmentKey_NotSync: CFStringRef;
    fn CMSampleBufferGetDataBuffer(sample: CMSampleBufferRef) -> CMBlockBufferRef;
    fn CMSampleBufferGetFormatDescription(sample: CMSampleBufferRef) -> CMFormatDescriptionRef;
    fn CMSampleBufferGetSampleAttachmentsArray(sample: CMSampleBufferRef, create: u8)
    -> CFArrayRef;
    fn CMBlockBufferGetDataLength(buffer: CMBlockBufferRef) -> usize;
    fn CMBlockBufferCopyDataBytes(
        buffer: CMBlockBufferRef,
        offset: usize,
        length: usize,
        destination: *mut c_void,
    ) -> OSStatus;
    fn CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(
        description: CMFormatDescriptionRef,
        index: usize,
        set_out: *mut *const u8,
        size_out: *mut usize,
        count_out: *mut usize,
        header_length_out: *mut i32,
    ) -> OSStatus;
}

#[link(name = "VideoToolbox", kind = "framework")]
unsafe extern "C" {
    static kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: CFStringRef;
    static kVTCompressionPropertyKey_RealTime: CFStringRef;
    static kVTCompressionPropertyKey_AllowFrameReordering: CFStringRef;
    static kVTCompressionPropertyKey_ProfileLevel: CFStringRef;
    static kVTProfileLevel_HEVC_Main_AutoLevel: CFStringRef;
    static kVTCompressionPropertyKey_AverageBitRate: CFStringRef;
    static kVTCompressionPropertyKey_ExpectedFrameRate: CFStringRef;
    static kVTCompressionPropertyKey_MaxKeyFrameInterval: CFStringRef;
    static kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: CFStringRef;
    static kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder: CFStringRef;
    fn VTCompressionSessionCreate(
        allocator: *const c_void,
        width: i32,
        height: i32,
        codec: u32,
        encoder_specification: CFDictionaryRef,
        source_attributes: CFDictionaryRef,
        compressed_allocator: *const c_void,
        callback: OutputCallback,
        refcon: *mut c_void,
        out: *mut VTCompressionSessionRef,
    ) -> OSStatus;
    fn VTSessionSetProperty(
        session: VTCompressionSessionRef,
        key: CFStringRef,
        value: CFTypeRef,
    ) -> OSStatus;
    fn VTSessionCopyProperty(
        session: VTCompressionSessionRef,
        key: CFStringRef,
        allocator: *const c_void,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTCompressionSessionPrepareToEncodeFrames(session: VTCompressionSessionRef) -> OSStatus;
    fn VTCompressionSessionGetPixelBufferPool(
        session: VTCompressionSessionRef,
    ) -> CVPixelBufferPoolRef;
    fn VTCompressionSessionEncodeFrame(
        session: VTCompressionSessionRef,
        image: CVPixelBufferRef,
        pts: CMTime,
        duration: CMTime,
        frame_properties: CFDictionaryRef,
        frame_refcon: *mut c_void,
        info_out: *mut u32,
    ) -> OSStatus;
    fn VTCompressionSessionCompleteFrames(
        session: VTCompressionSessionRef,
        until: CMTime,
    ) -> OSStatus;
    fn VTCompressionSessionInvalidate(session: VTCompressionSessionRef);
}

/// What the output callback hands back, in submission order.
enum Output {
    Frame(EncodedFrame),
    Error(String),
}

/// State shared with the output callback.
#[derive(Default)]
struct Shared {
    outputs: VecDeque<Output>,
    sets: ParameterSets,
}

pub fn open(
    width: u32,
    height: u32,
    fps: Rational,
    bitrate: u32,
) -> Result<Box<dyn FrameEncoder>, String> {
    VtHevc::create(width, height, fps, bitrate)
        .map(|encoder| Box::new(encoder) as Box<dyn FrameEncoder>)
}

struct VtHevc {
    session: VTCompressionSessionRef,
    shared: Box<Mutex<Shared>>,
    hardware: bool,
    width: u32,
    height: u32,
    fps: Rational,
    submitted: i64,
    hvcc: Option<Vec<u8>>,
}

/// An owned Core Foundation object, released on drop.
struct Owned(CFTypeRef);

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: this holds the only reference it was created with.
            unsafe { CFRelease(self.0) };
        }
    }
}

fn number_i32(value: i32) -> Owned {
    // SAFETY: CFNumberCreate copies the value.
    Owned(unsafe { CFNumberCreate(ptr::null(), CF_NUMBER_SINT32, (&raw const value).cast()) })
}

fn number_f64(value: f64) -> Owned {
    // SAFETY: CFNumberCreate copies the value.
    Owned(unsafe { CFNumberCreate(ptr::null(), CF_NUMBER_FLOAT64, (&raw const value).cast()) })
}

fn dictionary(entries: &[(CFStringRef, CFTypeRef)]) -> Owned {
    // SAFETY: the dictionary retains its keys and values.
    unsafe {
        let dictionary = CFDictionaryCreateMutable(
            ptr::null(),
            0,
            (&raw const kCFTypeDictionaryKeyCallBacks).cast(),
            (&raw const kCFTypeDictionaryValueCallBacks).cast(),
        );
        for &(key, value) in entries {
            CFDictionarySetValue(dictionary, key, value);
        }
        Owned(dictionary.cast_const())
    }
}

impl VtHevc {
    fn create(width: u32, height: u32, fps: Rational, bitrate: u32) -> Result<Self, String> {
        let shared: Box<Mutex<Shared>> = Box::default();
        let mut session: VTCompressionSessionRef = ptr::null_mut();
        // SAFETY: all objects passed are valid for the call; the refcon
        // points at `shared`, which outlives the session (see `Drop`).
        unsafe {
            let specification = dictionary(&[(
                kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder,
                kCFBooleanTrue,
            )]);
            let format = number_i32(NV12_VIDEO_RANGE as i32);
            let pixel_width = number_i32(width as i32);
            let pixel_height = number_i32(height as i32);
            let attributes = dictionary(&[
                (kCVPixelBufferPixelFormatTypeKey, format.0),
                (kCVPixelBufferWidthKey, pixel_width.0),
                (kCVPixelBufferHeightKey, pixel_height.0),
            ]);
            let status = VTCompressionSessionCreate(
                ptr::null(),
                width as i32,
                height as i32,
                HEVC,
                specification.0,
                attributes.0,
                ptr::null(),
                on_output,
                (&raw const *shared).cast_mut().cast(),
                &mut session,
            );
            if status != 0 || session.is_null() {
                return Err(format!("VTCompressionSessionCreate failed ({status})"));
            }
            let mut encoder = Self {
                session,
                shared,
                hardware: false,
                width,
                height,
                fps,
                submitted: 0,
                hvcc: None,
            };
            let keyframe_interval = number_i32(fps.num.div_ceil(fps.den).max(1) as i32);
            let one_second = number_f64(1.0);
            let rate = number_f64(fps.as_f64());
            let average = number_i32(bitrate as i32);
            let required = [
                (
                    kVTCompressionPropertyKey_AllowFrameReordering,
                    kCFBooleanFalse,
                ),
                (
                    kVTCompressionPropertyKey_ProfileLevel,
                    kVTProfileLevel_HEVC_Main_AutoLevel,
                ),
            ];
            for (key, value) in required {
                let status = VTSessionSetProperty(session, key, value);
                if status != 0 {
                    return Err(format!("VTSessionSetProperty failed ({status})"));
                }
            }
            // Tuning the encoder may ignore.
            for (key, value) in [
                (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
                (kVTCompressionPropertyKey_AverageBitRate, average.0),
                (kVTCompressionPropertyKey_ExpectedFrameRate, rate.0),
                (
                    kVTCompressionPropertyKey_MaxKeyFrameInterval,
                    keyframe_interval.0,
                ),
                (
                    kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
                    one_second.0,
                ),
            ] {
                VTSessionSetProperty(session, key, value);
            }
            let status = VTCompressionSessionPrepareToEncodeFrames(session);
            if status != 0 {
                return Err(format!(
                    "VTCompressionSessionPrepareToEncodeFrames failed ({status})"
                ));
            }
            let mut using: CFTypeRef = ptr::null();
            if VTSessionCopyProperty(
                session,
                kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
                ptr::null(),
                &mut using,
            ) == 0
                && !using.is_null()
            {
                encoder.hardware = CFBooleanGetValue(using) != 0;
                CFRelease(using);
            }
            Ok(encoder)
        }
    }

    /// Copies an NV12 frame into a pixel buffer from the session's pool.
    fn pixel_buffer(&self, frame: &Frame) -> Result<Owned, String> {
        if frame.width != self.width || frame.height != self.height {
            return Err(format!(
                "frame is {}x{}, encoder expects {}x{}",
                frame.width, frame.height, self.width, self.height
            ));
        }
        let (width, height) = (self.width as usize, self.height as usize);
        // Full-range frames are scaled to the video range the pool uses.
        let (luma_map, chroma_map) = range_maps(frame.color.full_range);
        // SAFETY: the buffer is locked while its planes are written, and
        // each row write stays within the plane's row length.
        unsafe {
            let pool = VTCompressionSessionGetPixelBufferPool(self.session);
            if pool.is_null() {
                return Err("the encoder has no pixel buffer pool".to_string());
            }
            let mut buffer: CVPixelBufferRef = ptr::null_mut();
            let status = CVPixelBufferPoolCreatePixelBuffer(ptr::null(), pool, &mut buffer);
            if status != 0 || buffer.is_null() {
                return Err(format!(
                    "CVPixelBufferPoolCreatePixelBuffer failed ({status})"
                ));
            }
            let owned = Owned(buffer);
            if CVPixelBufferLockBaseAddress(buffer, 0) != 0 {
                return Err("could not lock the pixel buffer".to_string());
            }
            let planes = [
                (frame.luma(), height, &luma_map),
                (frame.chroma(), height.div_ceil(2), &chroma_map),
            ];
            for (plane, (source, rows, map)) in planes.into_iter().enumerate() {
                let base = CVPixelBufferGetBaseAddressOfPlane(buffer, plane);
                let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane);
                let rows = rows.min(CVPixelBufferGetHeightOfPlane(buffer, plane));
                for row in 0..rows {
                    let from = &source[row * width..(row + 1) * width];
                    let to =
                        std::slice::from_raw_parts_mut(base.add(row * stride), width.min(stride));
                    match map {
                        Some(map) => to
                            .iter_mut()
                            .zip(from)
                            .for_each(|(o, &i)| *o = map[i as usize]),
                        None => to.copy_from_slice(&from[..to.len()]),
                    }
                }
            }
            CVPixelBufferUnlockBaseAddress(buffer, 0);
            Ok(owned)
        }
    }

    fn take_outputs(&mut self) -> Result<Vec<EncodedFrame>, String> {
        let mut shared = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        if self.hvcc.is_none() {
            self.hvcc = shared.sets.hvcc();
        }
        let mut frames = Vec::new();
        for output in shared.outputs.drain(..) {
            match output {
                Output::Frame(frame) => frames.push(frame),
                Output::Error(error) => return Err(error),
            }
        }
        Ok(frames)
    }
}

/// Byte maps from full to video range for luma and chroma, when needed.
type RangeMap = Option<[u8; 256]>;

fn range_maps(full_range: bool) -> (RangeMap, RangeMap) {
    if !full_range {
        return (None, None);
    }
    let map = |scale: f32, offset: f32, centre: f32| {
        let mut map = [0; 256];
        for (index, value) in map.iter_mut().enumerate() {
            *value = (offset + (index as f32 - centre) * scale)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
        Some(map)
    };
    (
        map(219.0 / 255.0, 16.0, 0.0),
        map(224.0 / 255.0, 128.0, 128.0),
    )
}

extern "C" fn on_output(
    refcon: *mut c_void,
    _frame_refcon: *mut c_void,
    status: OSStatus,
    flags: u32,
    sample: CMSampleBufferRef,
) {
    // SAFETY: `refcon` is the encoder's `Shared`, alive while the session is.
    let shared = unsafe { &*(refcon as *const Mutex<Shared>) };
    let mut shared = shared.lock().unwrap_or_else(|e| e.into_inner());
    if status != 0 {
        shared.outputs.push_back(Output::Error(format!(
            "VideoToolbox encode failed ({status})"
        )));
        return;
    }
    if sample.is_null() || flags & FRAME_DROPPED != 0 {
        shared
            .outputs
            .push_back(Output::Frame(EncodedFrame::DROPPED));
        return;
    }
    // SAFETY: the sample buffer is valid for the duration of the callback.
    let output = unsafe { read_sample(sample, &mut shared.sets) };
    shared.outputs.push_back(output);
}

/// Copies an encoded sample out, collecting parameter sets on the way.
unsafe fn read_sample(sample: CMSampleBufferRef, sets: &mut ParameterSets) -> Output {
    // SAFETY: the caller passes a valid sample buffer.
    unsafe {
        let description = CMSampleBufferGetFormatDescription(sample);
        if !description.is_null() {
            let mut count = 0usize;
            let mut header = 0i32;
            let status = CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(
                description,
                0,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut count,
                &mut header,
            );
            if status == 0 {
                for index in 0..count {
                    let mut set = ptr::null();
                    let mut size = 0usize;
                    if CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(
                        description,
                        index,
                        &mut set,
                        &mut size,
                        ptr::null_mut(),
                        ptr::null_mut(),
                    ) == 0
                        && !set.is_null()
                    {
                        sets.collect(std::slice::from_raw_parts(set, size));
                    }
                }
            }
        }

        let block = CMSampleBufferGetDataBuffer(sample);
        if block.is_null() {
            return Output::Error("VideoToolbox returned a sample without data".to_string());
        }
        let len = CMBlockBufferGetDataLength(block);
        let mut data = vec![0u8; len];
        if CMBlockBufferCopyDataBytes(block, 0, len, data.as_mut_ptr().cast()) != 0 {
            return Output::Error("could not copy VideoToolbox output".to_string());
        }
        let Some(units) = bitstream::split_length_prefixed(&data) else {
            return Output::Error("VideoToolbox output is not length-prefixed".to_string());
        };
        let mut is_sync = true;
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, 0);
        if !attachments.is_null() && CFArrayGetCount(attachments) > 0 {
            let first = CFArrayGetValueAtIndex(attachments, 0);
            let not_sync = CFDictionaryGetValue(first, kCMSampleAttachmentKey_NotSync);
            is_sync = not_sync.is_null() || CFBooleanGetValue(not_sync) == 0;
        }
        let mut picture = Vec::new();
        for unit in units {
            if bitstream::is_out_of_band(unit) {
                sets.collect(unit);
            } else {
                picture.push(unit);
            }
        }
        Output::Frame(EncodedFrame {
            data: bitstream::length_prefixed(picture),
            is_sync,
        })
    }
}

impl FrameEncoder for VtHevc {
    fn name(&self) -> &'static str {
        if self.hardware {
            "VideoToolbox HEVC (hardware)"
        } else {
            "VideoToolbox HEVC (software)"
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
        let buffer = self.pixel_buffer(frame)?;
        let pts = CMTime {
            value: self.submitted * i64::from(self.fps.den),
            timescale: self.fps.num as i32,
            flags: CM_TIME_VALID,
            epoch: 0,
        };
        let duration = CMTime {
            value: i64::from(self.fps.den),
            ..pts
        };
        self.submitted += 1;
        // SAFETY: the session and pixel buffer are valid; the session
        // retains the buffer as long as it needs it.
        let status = unsafe {
            VTCompressionSessionEncodeFrame(
                self.session,
                buffer.0.cast_mut(),
                pts,
                duration,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if status != 0 {
            return Err(format!("VTCompressionSessionEncodeFrame failed ({status})"));
        }
        self.take_outputs()
    }

    fn finish(&mut self) -> Result<Vec<EncodedFrame>, String> {
        // SAFETY: the session is valid.
        let status = unsafe { VTCompressionSessionCompleteFrames(self.session, CM_TIME_INVALID) };
        if status != 0 {
            return Err(format!(
                "VTCompressionSessionCompleteFrames failed ({status})"
            ));
        }
        self.take_outputs()
    }
}

impl Drop for VtHevc {
    fn drop(&mut self) {
        // SAFETY: completing frames delivers every pending callback, so
        // `shared` is no longer referenced once the session is invalidated.
        unsafe {
            VTCompressionSessionCompleteFrames(self.session, CM_TIME_INVALID);
            VTCompressionSessionInvalidate(self.session);
            CFRelease(self.session.cast_const());
        }
    }
}
