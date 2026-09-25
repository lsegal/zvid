//! AVFoundation backend.
//!
//! An `AVCaptureDeviceDiscoverySession` lists built-in, external (USB and
//! Camera Extension virtual cameras such as Camo and DroidCam) and
//! Continuity Camera devices; Desk View is excluded. Frames come from an
//! `AVCaptureVideoDataOutput` as NV12 ('420v'/'420f') on a serial dispatch
//! queue.

use crate::clock::HostTime;
use crate::fanout::{Dispatcher, lock};
use crate::frame::{ColorInfo, Frame, PixelFormat, Rotation, pack_nv12};
use crate::{
    CaptureError, Device, DeviceId, Format, FormatPreference, Permission, Rational, Selection,
    Transport, select_format,
};
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, ProtocolObject, Sel};
use objc2::{AnyThread, ClassType, Message, ProtocolType, msg_send, sel};
#[allow(deprecated)]
use objc2_av_foundation::AVCaptureDeviceTypeExternalUnknown;
use objc2_av_foundation::{
    AVAuthorizationStatus, AVCaptureDevice, AVCaptureDeviceDiscoverySession, AVCaptureDeviceFormat,
    AVCaptureDeviceInput, AVCaptureDevicePosition, AVCaptureDeviceRotationCoordinator,
    AVCaptureDeviceType, AVCaptureDeviceTypeBuiltInWideAngleCamera,
    AVCaptureDeviceWasConnectedNotification, AVCaptureDeviceWasDisconnectedNotification,
    AVCaptureSession, AVCaptureVideoDataOutput, AVCaptureVideoDataOutputSampleBufferDelegate,
    AVMediaTypeVideo,
};
use objc2_core_foundation::{CFRunLoop, kCFRunLoopDefaultMode};
use objc2_core_media::{
    CMClock, CMSampleBuffer, CMSyncConvertTime, CMTime, CMTimeFlags,
    CMVideoFormatDescriptionGetDimensions,
};
use objc2_core_video::{
    CVPixelBufferGetBaseAddressOfPlane, CVPixelBufferGetBytesPerRowOfPlane, CVPixelBufferGetHeight,
    CVPixelBufferGetHeightOfPlane, CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidth,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
    kCVPixelBufferPixelFormatTypeKey, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSNotification, NSNotificationCenter, NSNumber, NSObject,
    NSObjectProtocol, NSOperatingSystemVersion, NSProcessInfo, NSString,
};
use std::ffi::{CStr, CString, c_void};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, OnceLock, mpsc};
use std::time::Duration;

// AVError codes (AVError.h).
const AV_ERROR_DEVICE_ALREADY_USED_BY_ANOTHER_SESSION: isize = -11804;
const AV_ERROR_DEVICE_IN_USE_BY_ANOTHER_APPLICATION: isize = -11815;
const AV_ERROR_APPLICATION_IS_NOT_AUTHORIZED_TO_USE_DEVICE: isize = -11852;

fn at_least(major: isize, minor: isize) -> bool {
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: major,
        minorVersion: minor,
        patchVersion: 0,
    })
}

// macOS 14 device types, named by value so the binary still loads on older
// systems that lack the exported constants.
const DEVICE_TYPE_EXTERNAL: &str = "AVCaptureDeviceTypeExternal";
const DEVICE_TYPE_CONTINUITY: &str = "AVCaptureDeviceTypeContinuityCamera";
const DEVICE_TYPE_DESK_VIEW: &str = "AVCaptureDeviceTypeDeskViewCamera";

fn video_media_type() -> &'static NSString {
    // SAFETY: AVMediaTypeVideo is a constant NSString exported since 10.7.
    unsafe { AVMediaTypeVideo }.expect("AVMediaTypeVideo")
}

fn discovery_devices() -> Vec<Retained<AVCaptureDevice>> {
    // SAFETY: both constants exist on every supported macOS version.
    let mut types: Vec<Retained<AVCaptureDeviceType>> =
        vec![unsafe { AVCaptureDeviceTypeBuiltInWideAngleCamera }.retain()];
    if at_least(14, 0) {
        types.push(NSString::from_str(DEVICE_TYPE_EXTERNAL));
        types.push(NSString::from_str(DEVICE_TYPE_CONTINUITY));
    } else {
        // SAFETY: exported since macOS 10.15; deprecated by the macOS 14 types.
        #[allow(deprecated)]
        types.push(unsafe { AVCaptureDeviceTypeExternalUnknown }.retain());
    }
    let types = NSArray::from_retained_slice(&types);
    // SAFETY: valid device types and media type.
    let session = unsafe {
        AVCaptureDeviceDiscoverySession::discoverySessionWithDeviceTypes_mediaType_position(
            &types,
            Some(video_media_type()),
            AVCaptureDevicePosition::Unspecified,
        )
    };
    let desk_view = NSString::from_str(DEVICE_TYPE_DESK_VIEW);
    // SAFETY: reading properties of discovered devices.
    unsafe { session.devices() }
        .iter()
        .filter(|device| !unsafe { device.deviceType() }.isEqualToString(&desk_view))
        .collect()
}

const fn fourcc(code: &[u8; 4]) -> i32 {
    i32::from_be_bytes(*code)
}

/// Maps an AVCaptureDevice type and CoreAudio-style transport FourCC.
pub(crate) fn classify_transport(device_type: &str, transport: i32) -> Transport {
    if device_type == DEVICE_TYPE_CONTINUITY {
        return Transport::Continuity;
    }
    match transport {
        t if t == fourcc(b"bltn") => Transport::BuiltIn,
        t if t == fourcc(b"usb ") => Transport::Usb,
        t if t == fourcc(b"thun") => Transport::Thunderbolt,
        t if t == fourcc(b"virt") => Transport::Virtual,
        // Continuity Capture, wired and wireless (before the macOS 14 type).
        t if t == fourcc(b"ccwd") || t == fourcc(b"ccwl") => Transport::Continuity,
        t if t == fourcc(b"wrls") || t == fourcc(b"airp") || t == fourcc(b"blue") => {
            Transport::Wireless
        }
        _ if device_type == "AVCaptureDeviceTypeBuiltInWideAngleCamera" => Transport::BuiltIn,
        _ => Transport::Unknown,
    }
}

fn describe(device: &AVCaptureDevice) -> Device {
    // SAFETY: property reads on a live device.
    unsafe {
        Device {
            id: DeviceId(device.uniqueID().to_string()),
            name: device.localizedName().to_string(),
            transport: classify_transport(&device.deviceType().to_string(), device.transportType()),
        }
    }
}

pub(crate) fn list_devices() -> Result<Vec<Device>, CaptureError> {
    Ok(discovery_devices().iter().map(|d| describe(d)).collect())
}

fn find_device(id: &DeviceId) -> Result<Retained<AVCaptureDevice>, CaptureError> {
    discovery_devices()
        .into_iter()
        // SAFETY: property read on a live device.
        .find(|d| unsafe { d.uniqueID() }.to_string() == id.0)
        .ok_or_else(|| CaptureError::DeviceNotFound(id.0.clone()))
}

fn device_formats(
    device: &AVCaptureDevice,
) -> Vec<(Format, Retained<AVCaptureDeviceFormat>, Rational)> {
    let mut formats = Vec::new();
    // SAFETY: property reads on a live device and its formats.
    unsafe {
        for format in device.formats().iter() {
            let dims = CMVideoFormatDescriptionGetDimensions(&format.formatDescription());
            let (Ok(width), Ok(height)) = (u32::try_from(dims.width), u32::try_from(dims.height))
            else {
                continue;
            };
            for range in format.videoSupportedFrameRateRanges().iter() {
                let fastest = range.minFrameDuration();
                let slowest = range.maxFrameDuration();
                let (Some(max_fps), Some(min_fps)) = (
                    Rational::from_frame_duration(fastest.value, fastest.timescale),
                    Rational::from_frame_duration(slowest.value, slowest.timescale),
                ) else {
                    continue;
                };
                formats.push((
                    Format {
                        width,
                        height,
                        fps: max_fps,
                    },
                    format.clone(),
                    min_fps,
                ));
            }
        }
    }
    formats
}

pub(crate) fn supported_formats(id: &DeviceId) -> Result<Vec<Format>, CaptureError> {
    let device = find_device(id)?;
    let mut formats: Vec<Format> = device_formats(&device).into_iter().map(|f| f.0).collect();
    formats.sort_by_key(|f| std::cmp::Reverse((f.width * f.height, f.fps)));
    formats.dedup();
    Ok(formats)
}

fn map_status(status: AVAuthorizationStatus) -> Permission {
    match status {
        AVAuthorizationStatus::Authorized => Permission::Authorized,
        AVAuthorizationStatus::Denied => Permission::Denied,
        AVAuthorizationStatus::Restricted => Permission::Restricted,
        _ => Permission::NotDetermined,
    }
}

pub(crate) fn permission() -> Permission {
    // SAFETY: AVMediaTypeVideo is a valid media type for this call.
    map_status(unsafe { AVCaptureDevice::authorizationStatusForMediaType(video_media_type()) })
}

pub(crate) fn request_permission() -> Permission {
    let current = permission();
    if current != Permission::NotDetermined {
        return current;
    }
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });
    // SAFETY: the handler is retained by AVFoundation until it runs.
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(video_media_type(), &handler)
    };
    // The prompt waits for the user; give up eventually rather than hang.
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Permission::Authorized,
        Ok(false) => permission(),
        Err(_) => Permission::NotDetermined,
    }
}

pub(crate) fn run_main_loop_for(duration: Duration) {
    // SAFETY: kCFRunLoopDefaultMode is a valid mode constant.
    CFRunLoop::run_in_mode(
        unsafe { kCFRunLoopDefaultMode },
        duration.as_secs_f64(),
        false,
    );
}

fn ns_error(context: &'static str, error: &NSError) -> CaptureError {
    match error.code() {
        AV_ERROR_APPLICATION_IS_NOT_AUTHORIZED_TO_USE_DEVICE => CaptureError::PermissionDenied,
        AV_ERROR_DEVICE_IN_USE_BY_ANOTHER_APPLICATION
        | AV_ERROR_DEVICE_ALREADY_USED_BY_ANOTHER_SESSION => CaptureError::DeviceBusy,
        code => CaptureError::platform(
            context,
            format!("{} ({code})", error.localizedDescription()),
        ),
    }
}

struct DelegateState {
    dispatcher: Mutex<Dispatcher>,
    /// The session's synchronization clock, when it isn't the host clock.
    clock: Mutex<Option<Retained<CMClock>>>,
    /// Rotation still to apply when the connection couldn't rotate frames.
    rotation: Mutex<Rotation>,
}

/// The delegate class, registered at runtime under a name unique to this
/// copy of the crate. A literal `define_class!` name would panic when the
/// VST3 and AU builds are both loaded into one host process.
fn delegate_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    static IMAGE_MARKER: u8 = 0;
    CLASS.get_or_init(|| {
        let name = format!(
            "ZvidCaptureSampleBufferDelegate_{:x}",
            &IMAGE_MARKER as *const u8 as usize
        );
        let name = CString::new(name).expect("class name");
        let mut builder =
            ClassBuilder::new(&name, NSObject::class()).expect("unique delegate class name");
        builder.add_ivar::<*const c_void>(STATE_IVAR);
        if let Some(protocol) = <dyn AVCaptureVideoDataOutputSampleBufferDelegate>::protocol() {
            builder.add_protocol(protocol);
        }
        // SAFETY: the signatures match the protocol's method types.
        unsafe {
            builder.add_method(
                sel!(captureOutput:didOutputSampleBuffer:fromConnection:),
                did_output as DelegateMethod,
            );
            builder.add_method(
                sel!(captureOutput:didDropSampleBuffer:fromConnection:),
                did_drop as DelegateMethod,
            );
        }
        builder.register()
    })
}

/// `captureOutput:did…SampleBuffer:fromConnection:`, with raw pointers so
/// the function type implements `MethodImplementation` for every lifetime.
type DelegateMethod = unsafe extern "C-unwind" fn(
    *mut AnyObject,
    Sel,
    *mut AnyObject,
    *const CMSampleBuffer,
    *mut AnyObject,
);

const STATE_IVAR: &CStr = c"zvidState";

/// # Safety
///
/// `this` must be a delegate created by [`new_delegate`] whose state is alive.
unsafe fn delegate_state(this: &AnyObject) -> Option<&DelegateState> {
    let ivar = this.class().instance_variable(STATE_IVAR)?;
    let state = *unsafe { ivar.load::<*const c_void>(this) } as *const DelegateState;
    unsafe { state.as_ref() }
}

unsafe extern "C-unwind" fn did_output(
    this: *mut AnyObject,
    _cmd: Sel,
    _output: *mut AnyObject,
    sample: *const CMSampleBuffer,
    _connection: *mut AnyObject,
) {
    // SAFETY: only registered on delegates made by `new_delegate`; AVFoundation
    // passes a valid sample buffer for the duration of the call.
    let (Some(this), Some(sample)) = (unsafe { this.as_ref() }, unsafe { sample.as_ref() }) else {
        return;
    };
    if let Some(state) = unsafe { delegate_state(this) }
        && let Some(frame) = state.frame_from(sample)
    {
        lock(&state.dispatcher).deliver(frame);
    }
}

unsafe extern "C-unwind" fn did_drop(
    this: *mut AnyObject,
    _cmd: Sel,
    _output: *mut AnyObject,
    _sample: *const CMSampleBuffer,
    _connection: *mut AnyObject,
) {
    // SAFETY: only registered on delegates made by `new_delegate`.
    let Some(this) = (unsafe { this.as_ref() }) else {
        return;
    };
    if let Some(state) = unsafe { delegate_state(this) } {
        lock(&state.dispatcher).record_dropped(1);
    }
}

/// Creates a delegate pointing at `state`. The caller keeps `state` alive
/// until the delegate can no longer be called.
fn new_delegate(state: &Arc<DelegateState>) -> Retained<AnyObject> {
    let class = delegate_class();
    // SAFETY: `new` on an NSObject subclass; the ivar is a raw pointer.
    unsafe {
        let delegate: Retained<AnyObject> = msg_send![class, new];
        let ivar = class.instance_variable(STATE_IVAR).expect("state ivar");
        *ivar.load_ptr::<*const c_void>(&delegate) = Arc::as_ptr(state).cast();
        delegate
    }
}

impl DelegateState {
    fn new(dispatcher: Dispatcher) -> Self {
        Self {
            dispatcher: Mutex::new(dispatcher),
            clock: Mutex::new(None),
            rotation: Mutex::new(Rotation::None),
        }
    }

    /// Converts a sample's presentation time to host time.
    fn host_time(&self, pts: CMTime) -> Option<HostTime> {
        if !pts.flags.contains(CMTimeFlags::Valid) {
            return None;
        }
        // SAFETY: CoreMedia time conversion on valid clocks.
        let host = unsafe {
            let host_clock = CMClock::host_time_clock();
            match &*lock(&self.clock) {
                Some(clock) => CMSyncConvertTime(pts, clock, &host_clock),
                None => pts,
            }
        };
        // SAFETY: `host` is on the host time clock.
        Some(HostTime::from_ticks(unsafe {
            CMClock::convert_host_time_to_system_units(host)
        }))
    }

    fn frame_from(&self, sample: &CMSampleBuffer) -> Option<Frame> {
        // SAFETY: the sample buffer is valid for the callback's duration.
        let pts = self.host_time(unsafe { sample.presentation_time_stamp() })?;
        let image = unsafe { sample.image_buffer() }?;
        let pixel_format = CVPixelBufferGetPixelFormatType(&image);
        let full_range = pixel_format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;
        if !full_range && pixel_format != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange {
            return None;
        }
        let width = CVPixelBufferGetWidth(&image) as u32;
        let height = CVPixelBufferGetHeight(&image) as u32;
        // SAFETY: the base address is locked while the planes are read.
        let data = unsafe {
            if CVPixelBufferLockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly) != 0 {
                return None;
            }
            let plane = |index: usize| {
                let base = CVPixelBufferGetBaseAddressOfPlane(&image, index) as *const u8;
                let stride = CVPixelBufferGetBytesPerRowOfPlane(&image, index);
                let rows = CVPixelBufferGetHeightOfPlane(&image, index);
                (!base.is_null()).then(|| (std::slice::from_raw_parts(base, stride * rows), stride))
            };
            let data = match (plane(0), plane(1)) {
                (Some((y, y_stride)), Some((uv, uv_stride))) => {
                    pack_nv12(width, height, y, y_stride, uv, uv_stride)
                }
                _ => None,
            };
            CVPixelBufferUnlockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly);
            data
        }?;
        Some(Frame {
            width,
            height,
            format: PixelFormat::Nv12,
            color: ColorInfo {
                full_range,
                ..ColorInfo::for_height(width.min(height))
            },
            rotation: *lock(&self.rotation),
            pts,
            sequence: 0,
            data,
        })
    }
}

pub(crate) struct Session {
    session: Retained<AVCaptureSession>,
    output: Retained<AVCaptureVideoDataOutput>,
    queue: DispatchRetained<DispatchQueue>,
    _delegate: Retained<AnyObject>,
    /// Declared after `_delegate`: the delegate points into it.
    _state: Arc<DelegateState>,
    _rotation: Option<Retained<AVCaptureDeviceRotationCoordinator>>,
}

// SAFETY: AVCaptureSession and its outputs may be started, stopped and
// released from any thread; the delegate's state is behind mutexes.
unsafe impl Send for Session {}

impl Session {
    pub(crate) fn start(
        id: &DeviceId,
        pref: &FormatPreference,
        dispatcher: Dispatcher,
    ) -> Result<(Self, Selection), CaptureError> {
        let device = find_device(id)?;
        let candidates = device_formats(&device);
        let formats: Vec<Format> = candidates.iter().map(|c| c.0).collect();
        let selection = select_format(&formats, pref).ok_or(CaptureError::NoSupportedFormat)?;
        let (_, device_format, min_fps) = &candidates[selection.index];

        let mut dispatcher = dispatcher;
        // Rates below the range minimum can't be requested; decimate instead.
        let requested = if selection.fps < *min_fps {
            dispatcher.limit_rate(selection.fps);
            selection.format.fps
        } else {
            selection.fps
        };
        let state = Arc::new(DelegateState::new(dispatcher));
        let delegate = new_delegate(&state);
        let queue = DispatchQueue::new("ca.soen.zvid.capture", None);

        // SAFETY: standard AVFoundation capture setup. The device lock is
        // held until the session starts so the preset can't override the
        // chosen format.
        unsafe {
            let input = AVCaptureDeviceInput::deviceInputWithDevice_error(&device)
                .map_err(|e| ns_error("AVCaptureDeviceInput", &e))?;
            let session = AVCaptureSession::new();
            session.beginConfiguration();
            if !session.canAddInput(&input) {
                session.commitConfiguration();
                return Err(CaptureError::DeviceBusy);
            }
            session.addInput(&input);

            let output = AVCaptureVideoDataOutput::new();
            let key: &NSString = std::mem::transmute::<&objc2_core_foundation::CFString, &NSString>(
                kCVPixelBufferPixelFormatTypeKey,
            );
            let value =
                NSNumber::numberWithUnsignedInt(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
            let settings = NSDictionary::<NSString, AnyObject>::from_retained_objects(
                &[key],
                &[Retained::into_super(Retained::into_super(value)).into()],
            );
            output.setVideoSettings(Some(&settings));
            output.setAlwaysDiscardsLateVideoFrames(true);
            // SAFETY: the class conforms to the protocol (registered above).
            let protocol_object: &ProtocolObject<dyn AVCaptureVideoDataOutputSampleBufferDelegate> =
                &*(&*delegate as *const AnyObject
                    as *const ProtocolObject<dyn AVCaptureVideoDataOutputSampleBufferDelegate>);
            output.setSampleBufferDelegate_queue(Some(protocol_object), Some(&queue));
            if !session.canAddOutput(&output) {
                session.commitConfiguration();
                return Err(CaptureError::platform(
                    "AVCaptureSession",
                    "can't add video output",
                ));
            }
            session.addOutput(&output);

            device.lockForConfiguration().map_err(|e| {
                session.commitConfiguration();
                ns_error("lockForConfiguration", &e)
            })?;
            device.setActiveFormat(device_format);
            let duration = CMTime {
                value: i64::from(requested.den),
                timescale: requested.num as i32,
                flags: CMTimeFlags::Valid,
                epoch: 0,
            };
            device.setActiveVideoMinFrameDuration(duration);
            device.setActiveVideoMaxFrameDuration(duration);

            // Rotate portrait sources (Continuity Camera held upright) so
            // frames arrive horizon-level. macOS 14+.
            let mut remaining = Rotation::None;
            let coordinator = at_least(14, 0).then(|| {
                AVCaptureDeviceRotationCoordinator::initWithDevice_previewLayer(
                    AVCaptureDeviceRotationCoordinator::alloc(),
                    &device,
                    None,
                )
            });
            if let (Some(coordinator), Some(connection)) = (
                &coordinator,
                output.connectionWithMediaType(video_media_type()),
            ) {
                let angle = coordinator.videoRotationAngleForHorizonLevelCapture();
                if connection.isVideoRotationAngleSupported(angle) {
                    connection.setVideoRotationAngle(angle);
                } else {
                    remaining = Rotation::from_degrees(angle);
                }
            }
            *lock(&state.rotation) = remaining;

            session.commitConfiguration();
            let clock = if at_least(12, 3) {
                session.synchronizationClock()
            } else {
                None
            };
            *lock(&state.clock) = clock;
            session.startRunning();
            device.unlockForConfiguration();
            if !session.isRunning() {
                output.setSampleBufferDelegate_queue(None, None);
                return Err(if device.isInUseByAnotherApplication() {
                    CaptureError::DeviceBusy
                } else {
                    CaptureError::platform("AVCaptureSession", "session failed to start")
                });
            }

            let started = Self {
                session,
                output,
                queue,
                _delegate: delegate,
                _state: state,
                _rotation: coordinator,
            };
            Ok((started, selection))
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: stopping a session we own, then draining its queue so no
        // callback runs after the dispatcher is released.
        unsafe {
            self.session.stopRunning();
            self.output.setSampleBufferDelegate_queue(None, None);
        }
        self.queue.exec_sync(|| {});
    }
}

/// Wakes the device watcher on AVCaptureDevice connect/disconnect.
pub(crate) struct Notifier {
    observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

// SAFETY: NSNotificationCenter observer tokens can be removed from any thread.
unsafe impl Send for Notifier {}

impl Notifier {
    pub(crate) fn register(nudge: Arc<dyn Fn() + Send + Sync>) -> Result<Self, CaptureError> {
        let center = NSNotificationCenter::defaultCenter();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| nudge());
        // SAFETY: valid notification names; a nil queue runs the block on
        // the posting thread, and it only signals a condvar.
        let observers = unsafe {
            [
                AVCaptureDeviceWasConnectedNotification,
                AVCaptureDeviceWasDisconnectedNotification,
            ]
            .into_iter()
            .map(|name| {
                center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
            })
            .collect()
        };
        Ok(Self { observers })
    }
}

impl Drop for Notifier {
    fn drop(&mut self) {
        let center = NSNotificationCenter::defaultCenter();
        for observer in &self.observers {
            // SAFETY: removing an observer token we registered.
            unsafe { center.removeObserver(observer.as_ref()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_transports() {
        assert_eq!(
            classify_transport(DEVICE_TYPE_CONTINUITY, 0),
            Transport::Continuity
        );
        assert_eq!(
            classify_transport("AVCaptureDeviceTypeBuiltInWideAngleCamera", fourcc(b"bltn")),
            Transport::BuiltIn
        );
        assert_eq!(
            classify_transport(DEVICE_TYPE_EXTERNAL, fourcc(b"usb ")),
            Transport::Usb
        );
        assert_eq!(
            classify_transport(DEVICE_TYPE_EXTERNAL, fourcc(b"virt")),
            Transport::Virtual
        );
        assert_eq!(
            classify_transport("AVCaptureDeviceTypeExternalUnknown", fourcc(b"ccwl")),
            Transport::Continuity
        );
        assert_eq!(
            classify_transport(DEVICE_TYPE_EXTERNAL, 0),
            Transport::Unknown
        );
    }

    #[test]
    fn device_type_names_match_the_sdk_constants() {
        // SAFETY: reading exported constants.
        unsafe {
            assert_eq!(
                AVCaptureDeviceTypeBuiltInWideAngleCamera.to_string(),
                "AVCaptureDeviceTypeBuiltInWideAngleCamera"
            );
            if at_least(14, 0) {
                assert_eq!(
                    objc2_av_foundation::AVCaptureDeviceTypeExternal.to_string(),
                    DEVICE_TYPE_EXTERNAL
                );
                assert_eq!(
                    objc2_av_foundation::AVCaptureDeviceTypeContinuityCamera.to_string(),
                    DEVICE_TYPE_CONTINUITY
                );
                assert_eq!(
                    objc2_av_foundation::AVCaptureDeviceTypeDeskViewCamera.to_string(),
                    DEVICE_TYPE_DESK_VIEW
                );
            }
        }
    }

    #[test]
    fn enumeration_and_permission_do_not_fail() {
        // CI machines have no cameras; this checks the AVFoundation calls.
        for device in list_devices().expect("discovery session") {
            assert!(!device.id.0.is_empty());
        }
        let _ = permission();
    }
}
