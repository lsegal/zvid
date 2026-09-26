//! The subset of the VST3 ABI ZVID Capture uses, written by hand from the
//! public VST3 interface documentation: interface IDs, vtable method order,
//! struct layouts and result codes.
//!
//! Every method uses the `system` calling convention: `__stdcall` on Windows
//! (the SDK's `PLUGIN_API`) and the C convention everywhere else. Structs use
//! natural C layout, which matches the SDK's 64-bit packing.

use std::ffi::{c_char, c_void};

pub type TResult = i32;
pub type TBool = u8;
/// A 16-byte class or interface ID.
pub type Tuid = [u8; 16];
/// A NUL-terminated string; for class and interface IDs, a pointer to a
/// [`Tuid`].
pub type FIDString = *const c_char;
/// Channel bitmask of a bus.
pub type SpeakerArrangement = u64;

/// Result codes. Windows uses COM `HRESULT`s; other platforms use small
/// integers.
#[cfg(windows)]
pub mod result {
    use super::TResult;
    pub const OK: TResult = 0;
    pub const FALSE: TResult = 1;
    pub const NO_INTERFACE: TResult = 0x8000_4002_u32 as TResult;
    pub const INVALID_ARGUMENT: TResult = 0x8007_0057_u32 as TResult;
    pub const NOT_IMPLEMENTED: TResult = 0x8000_4001_u32 as TResult;
}

/// Result codes. Windows uses COM `HRESULT`s; other platforms use small
/// integers.
#[cfg(not(windows))]
pub mod result {
    use super::TResult;
    pub const OK: TResult = 0;
    pub const FALSE: TResult = 1;
    pub const NO_INTERFACE: TResult = -1;
    pub const INVALID_ARGUMENT: TResult = 2;
    pub const NOT_IMPLEMENTED: TResult = 3;
}

/// Builds a [`Tuid`] from the four 32-bit words the documentation lists.
/// Windows stores the first eight bytes in COM `GUID` order; other
/// platforms store all four words big-endian.
pub const fn uid(l1: u32, l2: u32, l3: u32, l4: u32) -> Tuid {
    let [a0, a1, a2, a3] = l1.to_be_bytes();
    let [b0, b1, b2, b3] = l2.to_be_bytes();
    let [c0, c1, c2, c3] = l3.to_be_bytes();
    let [d0, d1, d2, d3] = l4.to_be_bytes();
    if cfg!(windows) {
        [
            a3, a2, a1, a0, b1, b0, b3, b2, c0, c1, c2, c3, d0, d1, d2, d3,
        ]
    } else {
        [
            a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3, d0, d1, d2, d3,
        ]
    }
}

pub const FUNKNOWN_IID: Tuid = uid(0x00000000, 0x00000000, 0xC0000000, 0x00000046);
pub const IPLUGIN_BASE_IID: Tuid = uid(0x22888DDB, 0x156E45AE, 0x8358B348, 0x08190625);
pub const IPLUGIN_FACTORY_IID: Tuid = uid(0x7A4D811C, 0x52114A1F, 0xAED9D2EE, 0x0B43BF9F);
pub const IPLUGIN_FACTORY2_IID: Tuid = uid(0x0007B650, 0xF24B4C0B, 0xA464EDB9, 0xF00B2ABB);
pub const ICOMPONENT_IID: Tuid = uid(0xE831FF31, 0xF2D54301, 0x928EBBEE, 0x25697802);
pub const IAUDIO_PROCESSOR_IID: Tuid = uid(0x42043F99, 0xB7DA453C, 0xA569E79D, 0x9AAEC33D);
pub const IPROCESS_CONTEXT_REQUIREMENTS_IID: Tuid =
    uid(0x2A654303, 0xEF764E3D, 0x95B5FE83, 0x730EF6D0);
pub const IEDIT_CONTROLLER_IID: Tuid = uid(0xDCD7BBE3, 0x7742448D, 0xA874AACC, 0x979C759E);
pub const IPLUG_VIEW_IID: Tuid = uid(0x5BC32507, 0xD06049EA, 0xA6151B52, 0x2B755B29);
pub const IPLUG_FRAME_IID: Tuid = uid(0x367FAF01, 0xAFA94693, 0x8D4DA2A0, 0xED0882A3);
pub const IPLUG_VIEW_CONTENT_SCALE_SUPPORT_IID: Tuid =
    uid(0x65ED9690, 0x8AC44525, 0x8AADEF7A, 0x72EA703F);
pub const ICONNECTION_POINT_IID: Tuid = uid(0x70A4156F, 0x6E6E4026, 0x989148BF, 0xAA60D8D1);

/// `PFactoryInfo::kUnicode`: strings in unicode class info are UTF-16.
pub const FACTORY_FLAG_UNICODE: i32 = 1 << 4;
/// `PClassInfo::kManyInstances`.
pub const MANY_INSTANCES: i32 = 0x7FFF_FFFF;
/// Class category of audio processors (`kVstAudioEffectClass`).
pub const AUDIO_EFFECT_CLASS: &str = "Audio Module Class";

pub const MEDIA_AUDIO: i32 = 0;
pub const DIRECTION_INPUT: i32 = 0;
pub const DIRECTION_OUTPUT: i32 = 1;
pub const BUS_MAIN: i32 = 0;
pub const BUS_DEFAULT_ACTIVE: u32 = 1;
pub const SAMPLE_32: i32 = 0;
/// `kSpeakerL | kSpeakerR`.
pub const STEREO: SpeakerArrangement = 0b11;

/// `ProcessContext::state` flags.
pub mod context {
    pub const PLAYING: u32 = 1 << 1;
    pub const CYCLE_ACTIVE: u32 = 1 << 2;
    pub const RECORDING: u32 = 1 << 3;
    pub const SYSTEM_TIME_VALID: u32 = 1 << 8;
    pub const PROJECT_TIME_MUSIC_VALID: u32 = 1 << 9;
    pub const TEMPO_VALID: u32 = 1 << 10;
    pub const TIME_SIG_VALID: u32 = 1 << 13;
}

/// `IProcessContextRequirements` flags.
pub mod requirements {
    pub const SYSTEM_TIME: u32 = 1 << 0;
    pub const PROJECT_TIME_MUSIC: u32 = 1 << 2;
    pub const CYCLE_MUSIC: u32 = 1 << 4;
    pub const TEMPO: u32 = 1 << 6;
    pub const TIME_SIGNATURE: u32 = 1 << 7;
    pub const TRANSPORT_STATE: u32 = 1 << 10;
}

/// `IPlugView` platform types and the editor view name.
pub const PLATFORM_HWND: &str = "HWND";
pub const PLATFORM_NSVIEW: &str = "NSView";
pub const VIEW_EDITOR: &str = "editor";

#[repr(C)]
pub struct PFactoryInfo {
    pub vendor: [c_char; 64],
    pub url: [c_char; 256],
    pub email: [c_char; 128],
    pub flags: i32,
}

#[repr(C)]
pub struct PClassInfo {
    pub cid: Tuid,
    pub cardinality: i32,
    pub category: [c_char; 32],
    pub name: [c_char; 64],
}

#[repr(C)]
pub struct PClassInfo2 {
    pub cid: Tuid,
    pub cardinality: i32,
    pub category: [c_char; 32],
    pub name: [c_char; 64],
    pub class_flags: u32,
    pub sub_categories: [c_char; 128],
    pub vendor: [c_char; 64],
    pub version: [c_char; 64],
    pub sdk_version: [c_char; 64],
}

#[repr(C)]
pub struct BusInfo {
    pub media_type: i32,
    pub direction: i32,
    pub channel_count: i32,
    pub name: [u16; 128],
    pub bus_type: i32,
    pub flags: u32,
}

#[repr(C)]
pub struct RoutingInfo {
    pub media_type: i32,
    pub bus_index: i32,
    pub channel: i32,
}

#[repr(C)]
pub struct ProcessSetup {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub max_samples_per_block: i32,
    pub sample_rate: f64,
}

#[repr(C)]
pub struct AudioBusBuffers {
    pub num_channels: i32,
    pub silence_flags: u64,
    /// `Sample32**` or `Sample64**`, depending on the symbolic sample size.
    pub channel_buffers: *mut *mut c_void,
}

#[repr(C)]
pub struct ProcessData {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub num_samples: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub inputs: *mut AudioBusBuffers,
    pub outputs: *mut AudioBusBuffers,
    pub input_parameter_changes: *mut c_void,
    pub output_parameter_changes: *mut c_void,
    pub input_events: *mut c_void,
    pub output_events: *mut c_void,
    pub process_context: *mut ProcessContext,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Chord {
    pub key_note: u8,
    pub root_note: u8,
    pub chord_mask: i16,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct FrameRate {
    pub frames_per_second: u32,
    pub flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct ProcessContext {
    pub state: u32,
    pub sample_rate: f64,
    pub project_time_samples: i64,
    pub system_time: i64,
    pub continous_time_samples: i64,
    pub project_time_music: f64,
    pub bar_position_music: f64,
    pub cycle_start_music: f64,
    pub cycle_end_music: f64,
    pub tempo: f64,
    pub time_sig_numerator: i32,
    pub time_sig_denominator: i32,
    pub chord: Chord,
    pub smpte_offset_subframes: i32,
    pub frame_rate: FrameRate,
    pub samples_to_next_clock: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ViewRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl ViewRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[repr(C)]
pub struct FUnknownVtbl {
    pub query_interface: unsafe extern "system" fn(
        this: *mut c_void,
        iid: *const Tuid,
        obj: *mut *mut c_void,
    ) -> TResult,
    pub add_ref: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub release: unsafe extern "system" fn(this: *mut c_void) -> u32,
}

#[repr(C)]
pub struct IPluginFactory2Vtbl {
    pub unknown: FUnknownVtbl,
    pub get_factory_info:
        unsafe extern "system" fn(this: *mut c_void, info: *mut PFactoryInfo) -> TResult,
    pub count_classes: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_class_info:
        unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut PClassInfo) -> TResult,
    pub create_instance: unsafe extern "system" fn(
        this: *mut c_void,
        cid: FIDString,
        iid: FIDString,
        obj: *mut *mut c_void,
    ) -> TResult,
    pub get_class_info2:
        unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut PClassInfo2) -> TResult,
}

#[repr(C)]
pub struct IComponentVtbl {
    pub unknown: FUnknownVtbl,
    pub initialize: unsafe extern "system" fn(this: *mut c_void, context: *mut c_void) -> TResult,
    pub terminate: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub get_controller_class_id:
        unsafe extern "system" fn(this: *mut c_void, class_id: *mut Tuid) -> TResult,
    pub set_io_mode: unsafe extern "system" fn(this: *mut c_void, mode: i32) -> TResult,
    pub get_bus_count: unsafe extern "system" fn(this: *mut c_void, media: i32, dir: i32) -> i32,
    pub get_bus_info: unsafe extern "system" fn(
        this: *mut c_void,
        media: i32,
        dir: i32,
        index: i32,
        bus: *mut BusInfo,
    ) -> TResult,
    pub get_routing_info: unsafe extern "system" fn(
        this: *mut c_void,
        input: *mut RoutingInfo,
        output: *mut RoutingInfo,
    ) -> TResult,
    pub activate_bus: unsafe extern "system" fn(
        this: *mut c_void,
        media: i32,
        dir: i32,
        index: i32,
        state: TBool,
    ) -> TResult,
    pub set_active: unsafe extern "system" fn(this: *mut c_void, state: TBool) -> TResult,
    pub set_state: unsafe extern "system" fn(this: *mut c_void, stream: *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(this: *mut c_void, stream: *mut c_void) -> TResult,
}

#[repr(C)]
pub struct IAudioProcessorVtbl {
    pub unknown: FUnknownVtbl,
    pub set_bus_arrangements: unsafe extern "system" fn(
        this: *mut c_void,
        inputs: *mut SpeakerArrangement,
        num_inputs: i32,
        outputs: *mut SpeakerArrangement,
        num_outputs: i32,
    ) -> TResult,
    pub get_bus_arrangement: unsafe extern "system" fn(
        this: *mut c_void,
        dir: i32,
        index: i32,
        arrangement: *mut SpeakerArrangement,
    ) -> TResult,
    pub can_process_sample_size: unsafe extern "system" fn(this: *mut c_void, size: i32) -> TResult,
    pub get_latency_samples: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub setup_processing:
        unsafe extern "system" fn(this: *mut c_void, setup: *mut ProcessSetup) -> TResult,
    pub set_processing: unsafe extern "system" fn(this: *mut c_void, state: TBool) -> TResult,
    pub process: unsafe extern "system" fn(this: *mut c_void, data: *mut ProcessData) -> TResult,
    pub get_tail_samples: unsafe extern "system" fn(this: *mut c_void) -> u32,
}

#[repr(C)]
pub struct IProcessContextRequirementsVtbl {
    pub unknown: FUnknownVtbl,
    pub get_process_context_requirements: unsafe extern "system" fn(this: *mut c_void) -> u32,
}

#[repr(C)]
pub struct IEditControllerVtbl {
    pub unknown: FUnknownVtbl,
    pub initialize: unsafe extern "system" fn(this: *mut c_void, context: *mut c_void) -> TResult,
    pub terminate: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub set_component_state:
        unsafe extern "system" fn(this: *mut c_void, stream: *mut c_void) -> TResult,
    pub set_state: unsafe extern "system" fn(this: *mut c_void, stream: *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(this: *mut c_void, stream: *mut c_void) -> TResult,
    pub get_parameter_count: unsafe extern "system" fn(this: *mut c_void) -> i32,
    pub get_parameter_info:
        unsafe extern "system" fn(this: *mut c_void, index: i32, info: *mut c_void) -> TResult,
    pub get_param_string_by_value: unsafe extern "system" fn(
        this: *mut c_void,
        id: u32,
        value: f64,
        string: *mut u16,
    ) -> TResult,
    pub get_param_value_by_string: unsafe extern "system" fn(
        this: *mut c_void,
        id: u32,
        string: *mut u16,
        value: *mut f64,
    ) -> TResult,
    pub normalized_param_to_plain:
        unsafe extern "system" fn(this: *mut c_void, id: u32, value: f64) -> f64,
    pub plain_param_to_normalized:
        unsafe extern "system" fn(this: *mut c_void, id: u32, value: f64) -> f64,
    pub get_param_normalized: unsafe extern "system" fn(this: *mut c_void, id: u32) -> f64,
    pub set_param_normalized:
        unsafe extern "system" fn(this: *mut c_void, id: u32, value: f64) -> TResult,
    pub set_component_handler:
        unsafe extern "system" fn(this: *mut c_void, handler: *mut c_void) -> TResult,
    pub create_view: unsafe extern "system" fn(this: *mut c_void, name: FIDString) -> *mut c_void,
}

#[repr(C)]
pub struct IPlugViewVtbl {
    pub unknown: FUnknownVtbl,
    pub is_platform_type_supported:
        unsafe extern "system" fn(this: *mut c_void, kind: FIDString) -> TResult,
    pub attached: unsafe extern "system" fn(
        this: *mut c_void,
        parent: *mut c_void,
        kind: FIDString,
    ) -> TResult,
    pub removed: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub on_wheel: unsafe extern "system" fn(this: *mut c_void, distance: f32) -> TResult,
    pub on_key_down: unsafe extern "system" fn(
        this: *mut c_void,
        key: u16,
        key_code: i16,
        modifiers: i16,
    ) -> TResult,
    pub on_key_up: unsafe extern "system" fn(
        this: *mut c_void,
        key: u16,
        key_code: i16,
        modifiers: i16,
    ) -> TResult,
    pub get_size: unsafe extern "system" fn(this: *mut c_void, size: *mut ViewRect) -> TResult,
    pub on_size: unsafe extern "system" fn(this: *mut c_void, size: *mut ViewRect) -> TResult,
    pub on_focus: unsafe extern "system" fn(this: *mut c_void, state: TBool) -> TResult,
    pub set_frame: unsafe extern "system" fn(this: *mut c_void, frame: *mut c_void) -> TResult,
    pub can_resize: unsafe extern "system" fn(this: *mut c_void) -> TResult,
    pub check_size_constraint:
        unsafe extern "system" fn(this: *mut c_void, rect: *mut ViewRect) -> TResult,
}

/// Host-implemented frame around a plugin view.
#[repr(C)]
pub struct IPlugFrameVtbl {
    pub unknown: FUnknownVtbl,
    pub resize_view: unsafe extern "system" fn(
        this: *mut c_void,
        view: *mut c_void,
        new_size: *mut ViewRect,
    ) -> TResult,
}

/// Tells a view its display scale factor on platforms (Windows) where the
/// view can't find it out itself.
#[repr(C)]
pub struct IPlugViewContentScaleSupportVtbl {
    pub unknown: FUnknownVtbl,
    pub set_content_scale_factor:
        unsafe extern "system" fn(this: *mut c_void, factor: f32) -> TResult,
}

/// Host-implemented byte stream used for state.
#[repr(C)]
pub struct IBStreamVtbl {
    pub unknown: FUnknownVtbl,
    pub read: unsafe extern "system" fn(
        this: *mut c_void,
        buffer: *mut c_void,
        num_bytes: i32,
        num_bytes_read: *mut i32,
    ) -> TResult,
    pub write: unsafe extern "system" fn(
        this: *mut c_void,
        buffer: *mut c_void,
        num_bytes: i32,
        num_bytes_written: *mut i32,
    ) -> TResult,
    pub seek: unsafe extern "system" fn(
        this: *mut c_void,
        pos: i64,
        mode: i32,
        result: *mut i64,
    ) -> TResult,
    pub tell: unsafe extern "system" fn(this: *mut c_void, pos: *mut i64) -> TResult,
}

/// Reads the vtable of a COM object pointer.
///
/// # Safety
/// `object` must point to a live object whose first field is a pointer to a
/// `V`.
pub unsafe fn vtbl<'a, V>(object: *mut c_void) -> &'a V {
    unsafe { &**object.cast::<*const V>() }
}

/// Reads the 16 bytes a `FIDString` class or interface ID points at.
///
/// # Safety
/// `id` must be null or point to 16 readable bytes.
pub unsafe fn read_tuid(id: *const c_void) -> Option<Tuid> {
    (!id.is_null()).then(|| unsafe { id.cast::<Tuid>().read_unaligned() })
}

/// Copies `text` into a NUL-terminated C string field, truncating to fit.
pub fn copy_cstr(field: &mut [c_char], text: &str) {
    let len = text.len().min(field.len().saturating_sub(1));
    for (slot, byte) in field.iter_mut().zip(text.bytes().take(len)) {
        *slot = byte as c_char;
    }
    field[len..].fill(0);
}

/// Copies `text` into a NUL-terminated UTF-16 field, truncating to fit.
pub fn copy_utf16(field: &mut [u16], text: &str) {
    let capacity = field.len().saturating_sub(1);
    let mut len = 0;
    for (slot, unit) in field.iter_mut().take(capacity).zip(text.encode_utf16()) {
        *slot = unit;
        len += 1;
    }
    field[len..].fill(0);
}

/// Compares a `FIDString` with `expected`.
///
/// # Safety
/// `text` must be null or a NUL-terminated string.
pub unsafe fn fid_eq(text: FIDString, expected: &str) -> bool {
    !text.is_null() && unsafe { std::ffi::CStr::from_ptr(text) }.to_bytes() == expected.as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    #[test]
    fn uid_byte_order_matches_the_platform() {
        let id = uid(0x00112233, 0x44556677, 0x8899AABB, 0xCCDDEEFF);
        if cfg!(windows) {
            assert_eq!(
                id,
                [
                    0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xAA, 0xBB, 0xCC,
                    0xDD, 0xEE, 0xFF
                ]
            );
        } else {
            assert_eq!(
                id,
                [
                    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC,
                    0xDD, 0xEE, 0xFF
                ]
            );
        }
        // FUnknown is the COM IUnknown GUID on every platform.
        assert_eq!(FUNKNOWN_IID[8], 0xC0);
        assert_eq!(FUNKNOWN_IID[15], 0x46);
    }

    #[test]
    fn struct_layouts_match_the_documented_abi() {
        assert_eq!(size_of::<PFactoryInfo>(), 64 + 256 + 128 + 4);
        assert_eq!(size_of::<PClassInfo>(), 16 + 4 + 32 + 64);
        assert_eq!(
            size_of::<PClassInfo2>(),
            16 + 4 + 32 + 64 + 4 + 128 + 64 + 64 + 64
        );
        assert_eq!(size_of::<BusInfo>(), 4 * 3 + 256 + 4 + 4);
        assert_eq!(offset_of!(ProcessSetup, sample_rate), 16);
        assert_eq!(offset_of!(AudioBusBuffers, silence_flags), 8);
        assert_eq!(offset_of!(AudioBusBuffers, channel_buffers), 16);
        assert_eq!(offset_of!(ProcessData, inputs), 24);
        assert_eq!(offset_of!(ProcessData, process_context), 72);
        assert_eq!(offset_of!(ProcessContext, sample_rate), 8);
        assert_eq!(offset_of!(ProcessContext, tempo), 72);
        assert_eq!(offset_of!(ProcessContext, time_sig_numerator), 80);
        assert_eq!(offset_of!(ProcessContext, chord), 88);
        assert_eq!(offset_of!(ProcessContext, frame_rate), 96);
        assert_eq!(size_of::<ProcessContext>(), 112);
    }

    #[test]
    fn copies_strings_with_truncation() {
        let mut field = [1 as c_char; 5];
        copy_cstr(&mut field, "ZVID Capture");
        assert_eq!(field, [b'Z', b'V', b'I', b'D', 0].map(|b| b as c_char));
        let mut wide = [1u16; 8];
        copy_utf16(&mut wide, "Out");
        assert_eq!(wide, [79, 117, 116, 0, 0, 0, 0, 0]);
    }
}
