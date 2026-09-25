//! Media Foundation backend.
//!
//! `MFEnumDeviceSources` lists every video capture source, which includes
//! Windows 11 Connected Camera (Phone Link) and virtual cameras such as
//! DroidCam and Camo. Frames come from a synchronous `IMFSourceReader` on a
//! dedicated MTA thread, converted to NV12 by the reader's video processor.

use crate::clock::HostTime;
use crate::fanout::Dispatcher;
use crate::frame::{pack_nv12, ColorInfo, Frame, PixelFormat, Rotation};
use crate::preview::Throttle;
use crate::{select_format, CaptureError, Device, DeviceId, Format, FormatPreference, Permission, Rational, Selection, Transport};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;
use windows::core::{Interface, HRESULT, HSTRING, PCWSTR, PWSTR};
use windows::Devices::Enumeration::{DeviceClass, DeviceInformation, DeviceInformationUpdate, DeviceWatcher, Panel};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Foundation::{E_ACCESSDENIED, ERROR_SHARING_VIOLATION};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

const VIDEO_STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;

fn platform_error(context: &'static str, error: windows::core::Error) -> CaptureError {
    CaptureError::platform(context, format!("{} ({:#010x})", error.message(), error.code().0))
}

/// Maps capture HRESULTs to typed errors.
fn classify(context: &'static str, error: windows::core::Error, id: &DeviceId) -> CaptureError {
    let code = error.code();
    if code == E_ACCESSDENIED {
        CaptureError::PermissionDenied
    } else if code == MF_E_HW_MFT_FAILED_START_STREAMING
        || code == MF_E_VIDEO_RECORDING_DEVICE_PREEMPTED
        || code == HRESULT::from_win32(ERROR_SHARING_VIOLATION.0)
    {
        CaptureError::DeviceBusy
    } else if code == MF_E_VIDEO_RECORDING_DEVICE_INVALIDATED {
        CaptureError::DeviceNotFound(id.0.clone())
    } else {
        platform_error(context, error)
    }
}

/// Initializes COM (MTA) on this thread and Media Foundation once per process.
fn ensure_mf() -> Result<(), CaptureError> {
    thread_local! {
        static COM: () = {
            // S_FALSE and RPC_E_CHANGED_MODE both leave COM usable here.
            // SAFETY: no preconditions; paired uninit is skipped on purpose
            // because the thread may keep using COM objects until it exits.
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        };
    }
    COM.with(|_| {});
    static STARTUP: OnceLock<Result<(), CaptureError>> = OnceLock::new();
    STARTUP
        // SAFETY: no preconditions. Never shut down: MF is ref-counted and
        // the host may use it too.
        .get_or_init(|| unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.map_err(|e| platform_error("MFStartup", e)))
        .clone()
}

fn attr_string(attributes: &IMFAttributes, key: &windows::core::GUID) -> Option<String> {
    let mut value = PWSTR::null();
    let mut len = 0;
    // SAFETY: out pointers are valid; the string is freed below.
    unsafe {
        attributes.GetAllocatedString(key, &mut value, &mut len).ok()?;
        let text = value.to_string().ok();
        CoTaskMemFree(Some(value.0 as *const _));
        text
    }
}

fn enum_sources() -> Result<Vec<IMFActivate>, CaptureError> {
    ensure_mf()?;
    // SAFETY: standard MF enumeration; the returned array is freed below.
    unsafe {
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 1).map_err(|e| platform_error("MFCreateAttributes", e))?;
        let attributes = attributes.ok_or_else(|| CaptureError::platform("MFCreateAttributes", "no attributes"))?;
        attributes
            .SetGUID(&MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID)
            .map_err(|e| platform_error("SetGUID", e))?;
        let mut array: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        MFEnumDeviceSources(&attributes, &mut array, &mut count).map_err(|e| platform_error("MFEnumDeviceSources", e))?;
        if array.is_null() {
            return Ok(Vec::new());
        }
        let sources = std::slice::from_raw_parts_mut(array, count as usize).iter_mut().filter_map(Option::take).collect();
        CoTaskMemFree(Some(array as *const _));
        Ok(sources)
    }
}

fn source_id(activate: &IMFActivate) -> Option<DeviceId> {
    attr_string(activate, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK).map(DeviceId)
}

/// Classifies a capture device from its symbolic link.
pub(crate) fn transport_from_link(link: &str) -> Transport {
    let link = link.to_ascii_lowercase();
    let bus = link.trim_start_matches(r"\\?\").split('#').next().unwrap_or_default();
    match bus {
        "usb" => Transport::Usb,
        // Software devices: Windows virtual cameras (including Phone Link
        // connected cameras) and root-enumerated drivers.
        "swd" | "root" => Transport::Virtual,
        "bth" | "bthenum" => Transport::Wireless,
        _ => Transport::Unknown,
    }
}

/// Laptop cameras are usually USB internally; the enclosure panel tells
/// them apart from external webcams. Cached because the lookup is slow.
fn transport(link: &str) -> Transport {
    static CACHE: OnceLock<Mutex<HashMap<String, Transport>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(transport) = crate::fanout::lock(cache).get(link) {
        return *transport;
    }
    let mut transport = transport_from_link(link);
    // Software cameras can report a panel too, so only trust it for hardware.
    if matches!(transport, Transport::Usb | Transport::Unknown) {
        let on_panel = DeviceInformation::CreateFromIdAsync(&HSTRING::from(link))
            .and_then(|op| op.join())
            .and_then(|info| info.EnclosureLocation())
            .and_then(|location| location.Panel())
            .is_ok_and(|panel| panel != Panel::Unknown);
        if on_panel {
            transport = Transport::BuiltIn;
        }
    }
    crate::fanout::lock(cache).insert(link.to_owned(), transport);
    transport
}

pub(crate) fn list_devices() -> Result<Vec<Device>, CaptureError> {
    Ok(enum_sources()?
        .iter()
        .filter_map(|activate| {
            let id = source_id(activate)?;
            let name = attr_string(activate, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME).unwrap_or_else(|| id.0.clone());
            let transport = transport(&id.0);
            Some(Device { id, name, transport })
        })
        .collect())
}

fn find_source(id: &DeviceId) -> Result<IMFActivate, CaptureError> {
    enum_sources()?
        .into_iter()
        .find(|activate| source_id(activate).is_some_and(|link| link.0.eq_ignore_ascii_case(&id.0)))
        .ok_or_else(|| CaptureError::DeviceNotFound(id.0.clone()))
}

fn split_u64(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

struct NativeType {
    format: Format,
    subtype: windows::core::GUID,
    media_type: IMFMediaType,
}

fn native_types(reader: &IMFSourceReader) -> Vec<NativeType> {
    let mut types = Vec::new();
    for index in 0.. {
        // SAFETY: enumeration ends with MF_E_NO_MORE_TYPES.
        let Ok(media_type) = (unsafe { reader.GetNativeMediaType(VIDEO_STREAM, index) }) else {
            break;
        };
        // SAFETY: attribute reads on a valid media type.
        let (size, rate, subtype) = unsafe {
            (
                media_type.GetUINT64(&MF_MT_FRAME_SIZE),
                media_type.GetUINT64(&MF_MT_FRAME_RATE),
                media_type.GetGUID(&MF_MT_SUBTYPE),
            )
        };
        let (Ok(size), Ok(rate), Ok(subtype)) = (size, rate, subtype) else {
            continue;
        };
        let (width, height) = split_u64(size);
        let (num, den) = split_u64(rate);
        types.push(NativeType {
            format: Format {
                width,
                height,
                fps: Rational::new(num, den).reduced(),
            },
            subtype,
            media_type,
        });
    }
    types
}

/// Lower is better: uncompressed formats avoid a decode step.
fn subtype_rank(subtype: &windows::core::GUID) -> u8 {
    match *subtype {
        s if s == MFVideoFormat_NV12 => 0,
        s if s == MFVideoFormat_YUY2 => 1,
        s if s == MFVideoFormat_MJPG => 2,
        _ => 3,
    }
}

fn open_reader(id: &DeviceId) -> Result<(IMFMediaSource, IMFSourceReader), CaptureError> {
    let activate = find_source(id)?;
    // SAFETY: standard MF activation and reader creation.
    unsafe {
        let source: IMFMediaSource = activate.ActivateObject().map_err(|e| classify("ActivateObject", e, id))?;
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 2).map_err(|e| platform_error("MFCreateAttributes", e))?;
        let attributes = attributes.ok_or_else(|| CaptureError::platform("MFCreateAttributes", "no attributes"))?;
        attributes
            .SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1)
            .map_err(|e| platform_error("SetUINT32", e))?;
        let reader = MFCreateSourceReaderFromMediaSource(&source, &attributes).map_err(|e| {
            source.Shutdown().ok();
            classify("MFCreateSourceReaderFromMediaSource", e, id)
        })?;
        Ok((source, reader))
    }
}

pub(crate) fn supported_formats(id: &DeviceId) -> Result<Vec<Format>, CaptureError> {
    let (source, reader) = open_reader(id)?;
    let mut formats: Vec<Format> = native_types(&reader).into_iter().map(|t| t.format).collect();
    formats.sort_by(|a, b| (b.width * b.height, b.fps).cmp(&(a.width * a.height, a.fps)));
    formats.dedup();
    drop(reader);
    // SAFETY: the reader is released; shutting down frees the device.
    unsafe { source.Shutdown().ok() };
    Ok(formats)
}

fn read_registry_string(root: HKEY, path: &str, value: &str) -> Option<String> {
    let path = HSTRING::from(path);
    let value = HSTRING::from(value);
    let mut buffer = [0u16; 64];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    // SAFETY: buffer and size describe a valid writable region.
    let status = unsafe {
        RegGetValueW(
            root,
            PCWSTR(path.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

/// Reads the Settings > Privacy > Camera switches. Desktop apps can't be
/// prompted: access is either on or off.
pub(crate) fn permission() -> Permission {
    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam";
    let denied = |root, path: &str| read_registry_string(root, path, "Value").is_some_and(|v| v.eq_ignore_ascii_case("Deny"));
    if denied(HKEY_LOCAL_MACHINE, STORE) {
        Permission::Restricted
    } else if denied(HKEY_CURRENT_USER, STORE) || denied(HKEY_CURRENT_USER, &format!(r"{STORE}\NonPackaged")) {
        Permission::Denied
    } else {
        Permission::Authorized
    }
}

pub(crate) fn request_permission() -> Permission {
    permission()
}

pub(crate) fn run_main_loop_for(duration: Duration) {
    std::thread::sleep(duration);
}

struct Configured {
    source: IMFMediaSource,
    reader: IMFSourceReader,
    selection: Selection,
    rotation: Rotation,
    color: ColorInfo,
}

fn configure(id: &DeviceId, pref: &FormatPreference) -> Result<Configured, CaptureError> {
    let (source, reader) = open_reader(id)?;
    let fail = |error: CaptureError| {
        // SAFETY: shutting down a source we own.
        unsafe { source.Shutdown().ok() };
        error
    };
    let types = native_types(&reader);
    let formats: Vec<Format> = types.iter().map(|t| t.format).collect();
    let Some(mut selection) = select_format(&formats, pref) else {
        return Err(fail(CaptureError::NoSupportedFormat));
    };
    let native = types
        .iter()
        .enumerate()
        .filter(|(_, t)| t.format == selection.format)
        .min_by_key(|(_, t)| subtype_rank(&t.subtype))
        .map(|(index, t)| (index, t))
        .expect("selected format exists");
    selection.index = native.0;
    let native = native.1;

    // SAFETY: media type setup on objects we own.
    unsafe {
        reader
            .SetCurrentMediaType(VIDEO_STREAM, None, &native.media_type)
            .map_err(|e| fail(classify("SetCurrentMediaType(native)", e, id)))?;
        let output = MFCreateMediaType().map_err(|e| fail(platform_error("MFCreateMediaType", e)))?;
        let size = (u64::from(selection.format.width) << 32) | u64::from(selection.format.height);
        output
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .and_then(|_| output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12))
            .and_then(|_| output.SetUINT64(&MF_MT_FRAME_SIZE, size))
            .map_err(|e| fail(platform_error("output media type", e)))?;
        reader
            .SetCurrentMediaType(VIDEO_STREAM, None, &output)
            .map_err(|_| fail(CaptureError::NoSupportedFormat))?;
        reader.SetStreamSelection(VIDEO_STREAM, true).ok();

        let rotation = native
            .media_type
            .GetUINT32(&MF_MT_VIDEO_ROTATION)
            .map_or(Rotation::None, |degrees| Rotation::from_degrees(f64::from(degrees)));
        let mut color = ColorInfo::for_height(selection.format.height);
        if let Ok(range) = native.media_type.GetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE) {
            color.full_range = range == MFNominalRange_0_255.0 as u32;
        }
        if let Ok(matrix) = native.media_type.GetUINT32(&MF_MT_YUV_MATRIX) {
            color.bt709 = matrix == MFVideoTransferMatrix_BT709.0 as u32;
        }
        Ok(Configured {
            source,
            reader,
            selection,
            rotation,
            color,
        })
    }
}

enum Read {
    Frame(Frame),
    Skip,
    End,
}

struct Reader {
    configured: Configured,
    /// Maps reader timestamps to QPC when a sample lacks a device timestamp.
    offset_100ns: Option<i64>,
}

impl Reader {
    fn read(&mut self, id: &DeviceId) -> Result<Read, CaptureError> {
        let reader = &self.configured.reader;
        let mut flags = 0u32;
        let mut timestamp = 0i64;
        let mut sample = None;
        // SAFETY: out pointers are valid for the call.
        unsafe { reader.ReadSample(VIDEO_STREAM, 0, None, Some(&mut flags), Some(&mut timestamp), Some(&mut sample)) }
            .map_err(|e| classify("ReadSample", e, id))?;
        if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 | MF_SOURCE_READERF_ERROR.0 as u32) != 0 {
            return Ok(Read::End);
        }
        let Some(sample) = sample else {
            return Ok(Read::Skip);
        };
        // Camera samples carry the QPC capture time in 100 ns units.
        // SAFETY: attribute read on a valid sample.
        let qpc_100ns = match unsafe { sample.GetUINT64(&MFSampleExtension_DeviceTimestamp) } {
            Ok(device) => device as i64,
            Err(_) => {
                // SAFETY: no preconditions.
                let offset = *self.offset_100ns.get_or_insert_with(|| unsafe { MFGetSystemTime() } - timestamp);
                timestamp + offset
            }
        };
        let pts = HostTime::from_nanos(qpc_100ns.max(0) as u64 * 100);
        let Some(data) = copy_nv12(&sample, &self.configured) else {
            return Ok(Read::Skip);
        };
        let format = self.configured.selection.format;
        Ok(Read::Frame(Frame {
            width: format.width,
            height: format.height,
            format: PixelFormat::Nv12,
            color: self.configured.color,
            rotation: self.configured.rotation,
            pts,
            sequence: 0,
            data,
        }))
    }
}

fn copy_nv12(sample: &IMFSample, configured: &Configured) -> Option<Vec<u8>> {
    let (width, height) = (configured.selection.format.width, configured.selection.format.height);
    let (w, h) = (width as usize, height as usize);
    // SAFETY: buffers are locked for the duration of the copy.
    unsafe {
        let buffer = sample.ConvertToContiguousBuffer().ok()?;
        if let Ok(buffer_2d) = buffer.cast::<IMF2DBuffer>() {
            let mut scanline = std::ptr::null_mut();
            let mut pitch = 0i32;
            if buffer_2d.Lock2D(&mut scanline, &mut pitch).is_ok() {
                let result = (pitch > 0).then(|| {
                    let pitch = pitch as usize;
                    // The chroma plane follows `height` luma rows at the same pitch.
                    let y = std::slice::from_raw_parts(scanline, pitch * h);
                    let uv = std::slice::from_raw_parts(scanline.add(pitch * h), pitch * h.div_ceil(2));
                    pack_nv12(width, height, y, pitch, uv, pitch)
                });
                buffer_2d.Unlock2D().ok();
                if let Some(data) = result.flatten() {
                    return Some(data);
                }
            }
        }
        let mut data = std::ptr::null_mut();
        let mut len = 0u32;
        buffer.Lock(&mut data, None, Some(&mut len)).ok()?;
        let bytes = std::slice::from_raw_parts(data, len as usize);
        let result = (bytes.len() >= Frame::nv12_len(width, height)).then(|| {
            let (y, uv) = bytes.split_at(w * h);
            pack_nv12(width, height, y, w, uv, w)
        });
        buffer.Unlock().ok();
        result.flatten()
    }
}

pub(crate) struct Session {
    stop: Arc<AtomicBool>,
    done: mpsc::Receiver<()>,
    thread: Option<JoinHandle<()>>,
}

impl Session {
    pub(crate) fn start(id: &DeviceId, pref: &FormatPreference, mut dispatcher: Dispatcher) -> Result<(Self, Selection), CaptureError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let thread_stop = stop.clone();
        let id = id.clone();
        let pref = *pref;
        // COM objects stay on the thread that created them.
        let thread = std::thread::Builder::new()
            .name("zvid-capture-mf".into())
            .spawn(move || {
                let _done = DoneSignal(done_tx);
                let setup = ensure_mf().and_then(|_| configure(&id, &pref));
                let mut reader = match setup {
                    Ok(configured) => Reader {
                        configured,
                        offset_100ns: None,
                    },
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                // Read one frame before reporting success, so a busy or
                // blocked camera fails `start` instead of going silent.
                let first = reader.read(&id);
                let first = match first {
                    Ok(read) => read,
                    Err(error) => {
                        // SAFETY: shutting down a source we own.
                        unsafe { reader.configured.source.Shutdown().ok() };
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                let selection = reader.configured.selection;
                let _ = ready_tx.send(Ok(selection));

                let mut decimate = (selection.fps < selection.format.fps).then(|| Throttle::new(selection.fps));
                let mut handle = |read: Read| match read {
                    Read::Frame(frame) => {
                        if decimate.as_mut().is_none_or(|t| t.accept(frame.pts)) {
                            dispatcher.deliver(frame);
                        }
                        true
                    }
                    Read::Skip => true,
                    Read::End => false,
                };
                let mut running = handle(first);
                while running && !thread_stop.load(Ordering::Acquire) {
                    running = match reader.read(&id) {
                        Ok(read) => handle(read),
                        Err(_) => false,
                    };
                }
                // SAFETY: shutting down a source we own.
                unsafe { reader.configured.source.Shutdown().ok() };
            })
            .map_err(|e| CaptureError::platform("spawn capture thread", e))?;

        let selection = ready_rx
            .recv()
            .unwrap_or_else(|_| Err(CaptureError::platform("capture thread", "exited during setup")));
        let session = Self {
            stop,
            done: done_rx,
            thread: Some(thread),
        };
        selection.map(|selection| (session, selection))
    }
}

/// Signals the owning `Session` when the capture thread exits.
struct DoneSignal(mpsc::Sender<()>);

impl Drop for DoneSignal {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        // ReadSample returns within a frame interval. If a stalled device
        // keeps it blocked, detach instead of hanging the host.
        let finished = self.done.recv_timeout(Duration::from_secs(2)).is_ok()
            || matches!(self.done.try_recv(), Err(mpsc::TryRecvError::Disconnected));
        if let Some(thread) = self.thread.take() {
            if finished {
                let _ = thread.join();
            }
        }
    }
}

/// Wakes the device watcher when Windows reports a video capture device
/// being added, removed, or updated.
pub(crate) struct Notifier {
    watcher: DeviceWatcher,
    tokens: [i64; 3],
}

impl Notifier {
    pub(crate) fn register(nudge: Arc<dyn Fn() + Send + Sync>) -> Result<Self, CaptureError> {
        ensure_mf()?;
        let error = |e| platform_error("DeviceWatcher", e);
        let watcher = DeviceInformation::CreateWatcherDeviceClass(DeviceClass::VideoCapture).map_err(error)?;
        let (a, r, u) = (nudge.clone(), nudge.clone(), nudge);
        let added = watcher
            .Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(move |_, _| {
                a();
                Ok(())
            }))
            .map_err(error)?;
        let removed = watcher
            .Removed(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, _| {
                r();
                Ok(())
            }))
            .map_err(error)?;
        let updated = watcher
            .Updated(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, _| {
                u();
                Ok(())
            }))
            .map_err(error)?;
        watcher.Start().map_err(error)?;
        Ok(Self {
            watcher,
            tokens: [added, removed, updated],
        })
    }
}

impl Drop for Notifier {
    fn drop(&mut self) {
        let [added, removed, updated] = self.tokens;
        let _ = self.watcher.Stop();
        let _ = self.watcher.RemoveAdded(added);
        let _ = self.watcher.RemoveRemoved(removed);
        let _ = self.watcher.RemoveUpdated(updated);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_symbolic_links() {
        assert_eq!(
            transport_from_link(r"\\?\usb#vid_046d&pid_085e&mi_00#7&1a2b3c&0&0000#{e5323777-f976-4f5b-9b55-b94699c46e44}\global"),
            Transport::Usb
        );
        assert_eq!(
            transport_from_link(r"\\?\SWD#VCAMDEVAPI#{6ac4c1d4-2f4b-4c8e-9c3e-1d6f2b0a7e10}#{e5323777-f976-4f5b-9b55-b94699c46e44}"),
            Transport::Virtual
        );
        assert_eq!(transport_from_link(r"\\?\ROOT#CAMERA#0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}"), Transport::Virtual);
        assert_eq!(transport_from_link(r"\\?\display#int3470#4&1835d135&0&uid13424#{e5323777}"), Transport::Unknown);
    }

    #[test]
    fn splits_packed_attributes() {
        assert_eq!(split_u64((1920u64 << 32) | 1080), (1920, 1080));
    }

    #[test]
    fn prefers_uncompressed_subtypes() {
        assert!(subtype_rank(&MFVideoFormat_NV12) < subtype_rank(&MFVideoFormat_MJPG));
        assert!(subtype_rank(&MFVideoFormat_YUY2) < subtype_rank(&MFVideoFormat_MJPG));
    }

    #[test]
    fn enumeration_and_permission_do_not_fail() {
        // CI machines have no cameras; this checks the MF calls themselves.
        let devices = list_devices().expect("MFEnumDeviceSources");
        for device in devices {
            assert!(!device.id.0.is_empty());
        }
        let _ = permission();
    }
}
