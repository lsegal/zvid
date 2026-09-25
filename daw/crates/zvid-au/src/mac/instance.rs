//! One AU instance: the `AudioComponentPlugInInterface` the host calls into,
//! and the selector handlers behind `Lookup`.
//!
//! ZVID Capture is a pass-through effect with no parameters. Input comes from
//! either a render callback or a connection to another unit, is copied to the
//! output unchanged, and is handed to the input tap for recording. Every
//! render also reads the host transport and pushes a snapshot into the SPSC
//! ring the take tracker drains.

// Apple's constant names are used as match patterns.
#![allow(non_upper_case_globals)]

use std::ffi::{c_uint, c_void};
use std::mem::{self, size_of};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicI32, AtomicPtr, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_audio_toolbox::{
    AUChannelInfo, AUPreset, AURenderCallback, AURenderCallbackStruct, AudioComponentInstance,
    AudioComponentMethod, AudioComponentPlugInInterface, AudioUnit, AudioUnitCocoaViewInfo,
    AudioUnitConnection, AudioUnitElement, AudioUnitGetProperty, AudioUnitPropertyID,
    AudioUnitPropertyListenerProc, AudioUnitRender, AudioUnitRenderActionFlags, AudioUnitScope,
    HostCallbackInfo, OpaqueAudioComponentInstance, kAudioUnitAddPropertyListenerSelect,
    kAudioUnitAddRenderNotifySelect, kAudioUnitErr_CannotDoInCurrentContext,
    kAudioUnitErr_FormatNotSupported, kAudioUnitErr_Initialized, kAudioUnitErr_InvalidElement,
    kAudioUnitErr_InvalidParameter, kAudioUnitErr_InvalidProperty,
    kAudioUnitErr_InvalidPropertyValue, kAudioUnitErr_InvalidScope, kAudioUnitErr_NoConnection,
    kAudioUnitErr_PropertyNotWritable, kAudioUnitErr_TooManyFramesToProcess,
    kAudioUnitErr_Uninitialized, kAudioUnitGetParameterSelect, kAudioUnitGetPropertyInfoSelect,
    kAudioUnitGetPropertySelect, kAudioUnitInitializeSelect, kAudioUnitProperty_ClassInfo,
    kAudioUnitProperty_CocoaUI, kAudioUnitProperty_ElementCount, kAudioUnitProperty_HostCallbacks,
    kAudioUnitProperty_LastRenderError, kAudioUnitProperty_Latency,
    kAudioUnitProperty_MakeConnection, kAudioUnitProperty_MaximumFramesPerSlice,
    kAudioUnitProperty_ParameterList, kAudioUnitProperty_PresentPreset,
    kAudioUnitProperty_SampleRate, kAudioUnitProperty_SetRenderCallback,
    kAudioUnitProperty_StreamFormat, kAudioUnitProperty_SupportedNumChannels,
    kAudioUnitProperty_TailTime, kAudioUnitRemovePropertyListenerSelect,
    kAudioUnitRemovePropertyListenerWithUserDataSelect, kAudioUnitRemoveRenderNotifySelect,
    kAudioUnitRenderSelect, kAudioUnitResetSelect, kAudioUnitScheduleParametersSelect,
    kAudioUnitScope_Global, kAudioUnitScope_Input, kAudioUnitScope_Output,
    kAudioUnitSetParameterSelect, kAudioUnitSetPropertySelect, kAudioUnitUninitializeSelect,
};
use objc2_core_audio_types::{
    AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp, AudioTimeStampFlags,
    kAudio_ParamError, kAudioFormatFlagIsNonInterleaved, kAudioFormatFlagsNativeFloatPacked,
    kAudioFormatLinearPCM,
};
use objc2_foundation::NSString;
use zvid_daw_core::ring::{Consumer, Producer, transport_ring};
use zvid_daw_core::{InputTap, State, TransportSnapshot};

use super::{class_info, view};
use crate::transport::{HostReading, host_ticks_to_sec, snapshot};

/// Private global property returning the [`AudioUnitInstance`] behind a unit,
/// so the Cocoa view can reach the instance it edits. IDs from 64000 up are
/// reserved for plugins.
pub const INSTANCE_PROPERTY: AudioUnitPropertyID = 64_000;
/// Most channels a stream format may carry.
pub const MAX_CHANNELS: usize = 16;
const DEFAULT_SAMPLE_RATE: f64 = 44_100.0;
const DEFAULT_CHANNELS: u32 = 2;
/// AudioToolbox's default slice size.
const DEFAULT_MAX_FRAMES: u32 = 1156;
const DEFAULT_PRESET_NAME: &str = "Untitled";
/// Returned when a handler panics, so the panic never unwinds into the host.
const PANIC_STATUS: i32 = kAudioUnitErr_CannotDoInCurrentContext;

/// The format of one bus. Always packed, native-endian, non-interleaved
/// 32-bit float linear PCM.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Format {
    sample_rate: f64,
    channels: u32,
}

impl Format {
    fn description(self) -> AudioStreamBasicDescription {
        AudioStreamBasicDescription {
            mSampleRate: self.sample_rate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagsNativeFloatPacked | kAudioFormatFlagIsNonInterleaved,
            mBytesPerPacket: 4,
            mFramesPerPacket: 1,
            mBytesPerFrame: 4,
            mChannelsPerFrame: self.channels,
            mBitsPerChannel: 32,
            mReserved: 0,
        }
    }

    fn from_description(description: &AudioStreamBasicDescription) -> Option<Self> {
        let expected = Self {
            sample_rate: description.mSampleRate,
            channels: description.mChannelsPerFrame,
        };
        let supported = description.mSampleRate.is_finite()
            && description.mSampleRate > 0.0
            && (1..=MAX_CHANNELS as u32).contains(&description.mChannelsPerFrame)
            && *description == expected.description();
        supported.then_some(expected)
    }
}

/// Where the input bus pulls audio from.
#[derive(Clone, Copy)]
enum Input {
    None,
    Callback {
        proc_: RenderProc,
        user_data: *mut c_void,
    },
    Connection(AudioUnitConnection),
}

/// Settings the host changes through properties.
#[derive(Clone, Copy)]
struct Config {
    initialized: bool,
    input_format: Format,
    output_format: Format,
    max_frames: u32,
    input: Input,
    host_callbacks: Option<HostCallbackInfo>,
}

struct Preset {
    number: i32,
    name: Retained<NSString>,
}

/// `AudioUnitPropertyListenerProc` with a nullable user-data pointer, as
/// hosts may register one.
type ListenerProc = unsafe extern "C-unwind" fn(
    *mut c_void,
    AudioUnit,
    AudioUnitPropertyID,
    AudioUnitScope,
    AudioUnitElement,
);
/// `AURenderCallback` with a nullable user-data pointer.
type RenderProc = unsafe extern "C-unwind" fn(
    *mut c_void,
    *mut AudioUnitRenderActionFlags,
    *const AudioTimeStamp,
    u32,
    u32,
    *mut AudioBufferList,
) -> i32;

#[derive(Clone, Copy)]
struct Listener {
    property: AudioUnitPropertyID,
    proc_: ListenerProc,
    user_data: *mut c_void,
}

#[derive(Clone, Copy)]
struct RenderNotify {
    proc_: RenderProc,
    user_data: *mut c_void,
}

/// Buffers only the render thread touches.
struct Scratch {
    /// `channels * max_frames` samples the input is pulled into.
    samples: Vec<f32>,
    /// Backing store for an `AudioBufferList` with one buffer per channel,
    /// as `u64`s so it is aligned for the list's pointers.
    list: Vec<u64>,
    transport: Producer<TransportSnapshot>,
}

/// One instance of ZVID Capture. Created by the factory and freed by `Close`.
#[repr(C)]
pub struct AudioUnitInstance {
    /// Must stay first: the host treats a pointer to the instance as a
    /// pointer to this interface.
    interface: AudioComponentPlugInInterface,
    unit: AtomicPtr<OpaqueAudioComponentInstance>,
    config: Mutex<Config>,
    state: Mutex<State>,
    preset: Mutex<Preset>,
    listeners: Mutex<Vec<Listener>>,
    render_notifies: Mutex<Vec<RenderNotify>>,
    scratch: Mutex<Scratch>,
    transport: Mutex<Option<Consumer<TransportSnapshot>>>,
    input_tap: Mutex<Option<Arc<dyn InputTap>>>,
    last_render_error: AtomicI32,
    /// `mach_timebase_info` ratio for converting host time to seconds.
    timebase: (u32, u32),
}

impl AudioUnitInstance {
    pub(super) fn create() -> *mut Self {
        let (producer, consumer) = transport_ring();
        let format = Format {
            sample_rate: DEFAULT_SAMPLE_RATE,
            channels: DEFAULT_CHANNELS,
        };
        Box::into_raw(Box::new(Self {
            interface: AudioComponentPlugInInterface {
                Open: open,
                Close: close,
                Lookup: lookup,
                reserved: ptr::null_mut(),
            },
            unit: AtomicPtr::new(ptr::null_mut()),
            config: Mutex::new(Config {
                initialized: false,
                input_format: format,
                output_format: format,
                max_frames: DEFAULT_MAX_FRAMES,
                input: Input::None,
                host_callbacks: None,
            }),
            state: Mutex::new(State::default()),
            preset: Mutex::new(Preset {
                number: -1,
                name: NSString::from_str(DEFAULT_PRESET_NAME),
            }),
            listeners: Mutex::new(Vec::new()),
            render_notifies: Mutex::new(Vec::new()),
            scratch: Mutex::new(Scratch {
                samples: Vec::new(),
                list: Vec::new(),
                transport: producer,
            }),
            transport: Mutex::new(Some(consumer)),
            input_tap: Mutex::new(None),
            last_render_error: AtomicI32::new(0),
            timebase: timebase(),
        }))
    }

    /// The persisted plugin state, saved and restored through ClassInfo.
    pub fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    /// Takes the consuming end of the transport ring the render thread fills.
    /// Returns `None` once taken.
    pub fn take_transport_consumer(&self) -> Option<Consumer<TransportSnapshot>> {
        lock(&self.transport).take()
    }

    /// Sets the tap that receives the input audio every render.
    pub fn set_input_tap(&self, tap: Option<Arc<dyn InputTap>>) {
        *lock(&self.input_tap) = tap;
    }

    fn config(&self) -> Config {
        *lock(&self.config)
    }

    fn unit(&self) -> AudioUnit {
        self.unit.load(Ordering::Acquire)
    }

    fn initialize(&self) -> i32 {
        let mut config = lock(&self.config);
        if config.initialized {
            return 0;
        }
        if config.input_format != config.output_format {
            return kAudioUnitErr_FormatNotSupported;
        }
        let channels = config.output_format.channels as usize;
        let mut scratch = lock(&self.scratch);
        scratch.samples = vec![0.0; channels * config.max_frames as usize];
        let list_bytes = size_of::<AudioBufferList>() + (channels - 1) * size_of::<AudioBuffer>();
        scratch.list = vec![0; list_bytes.div_ceil(size_of::<u64>())];
        config.initialized = true;
        0
    }

    fn uninitialize(&self) -> i32 {
        lock(&self.config).initialized = false;
        0
    }

    /// The size and writability of a property, or why it is unavailable.
    fn property_info(
        &self,
        id: AudioUnitPropertyID,
        scope: AudioUnitScope,
        element: AudioUnitElement,
    ) -> Result<(usize, bool), i32> {
        match id {
            kAudioUnitProperty_ClassInfo => {
                global(scope, element, size_of::<*const c_void>(), true)
            }
            kAudioUnitProperty_MakeConnection => {
                input(scope, element, size_of::<AudioUnitConnection>(), true)
            }
            kAudioUnitProperty_SetRenderCallback => {
                input(scope, element, size_of::<AURenderCallbackStruct>(), true)
            }
            kAudioUnitProperty_SampleRate => bus(scope, element, size_of::<f64>(), true),
            kAudioUnitProperty_StreamFormat => bus(
                scope,
                element,
                size_of::<AudioStreamBasicDescription>(),
                true,
            ),
            kAudioUnitProperty_ElementCount => {
                valid_scope(scope)?;
                Ok((size_of::<u32>(), false))
            }
            kAudioUnitProperty_ParameterList => {
                valid_scope(scope)?;
                Ok((0, false))
            }
            kAudioUnitProperty_Latency | kAudioUnitProperty_TailTime => {
                global(scope, element, size_of::<f64>(), false)
            }
            kAudioUnitProperty_SupportedNumChannels => {
                global(scope, element, size_of::<AUChannelInfo>(), false)
            }
            kAudioUnitProperty_MaximumFramesPerSlice => {
                global(scope, element, size_of::<u32>(), true)
            }
            kAudioUnitProperty_LastRenderError => global(scope, element, size_of::<i32>(), false),
            kAudioUnitProperty_HostCallbacks => {
                global(scope, element, size_of::<HostCallbackInfo>(), true)
            }
            kAudioUnitProperty_CocoaUI => {
                global(scope, element, size_of::<AudioUnitCocoaViewInfo>(), false)
            }
            kAudioUnitProperty_PresentPreset => global(scope, element, size_of::<AUPreset>(), true),
            INSTANCE_PROPERTY => global(scope, element, size_of::<*const Self>(), false),
            _ => Err(kAudioUnitErr_InvalidProperty),
        }
    }

    /// # Safety
    ///
    /// `data` must be valid for writes of `size` bytes.
    unsafe fn get_property(
        &self,
        id: AudioUnitPropertyID,
        scope: AudioUnitScope,
        element: AudioUnitElement,
        data: *mut c_void,
        size: &mut u32,
    ) -> i32 {
        let (needed, _) = match self.property_info(id, scope, element) {
            Ok(info) => info,
            Err(status) => return status,
        };
        if (*size as usize) < needed {
            return kAudio_ParamError;
        }
        let config = self.config();
        let bus_format = || {
            if scope == kAudioUnitScope_Input {
                config.input_format
            } else {
                config.output_format
            }
        };
        // SAFETY: `data` holds at least `needed` bytes, the size of each
        // value written below.
        unsafe {
            match id {
                kAudioUnitProperty_ClassInfo => {
                    let dictionary =
                        class_info::save(&self.state(), &lock(&self.preset).name.clone());
                    // The host owns, and releases, the returned property list.
                    write(
                        data,
                        Retained::into_raw(dictionary).cast::<c_void>().cast_const(),
                    );
                }
                kAudioUnitProperty_SampleRate => write(data, bus_format().sample_rate),
                kAudioUnitProperty_StreamFormat => write(data, bus_format().description()),
                kAudioUnitProperty_ElementCount => write(data, 1u32),
                kAudioUnitProperty_ParameterList => {}
                kAudioUnitProperty_Latency | kAudioUnitProperty_TailTime => write(data, 0f64),
                kAudioUnitProperty_SupportedNumChannels => write(
                    data,
                    // -1/-1: any channel count, as long as input matches output.
                    AUChannelInfo {
                        inChannels: -1,
                        outChannels: -1,
                    },
                ),
                kAudioUnitProperty_MaximumFramesPerSlice => write(data, config.max_frames),
                kAudioUnitProperty_LastRenderError => {
                    // Reading the error clears it.
                    write(data, self.last_render_error.swap(0, Ordering::AcqRel));
                }
                kAudioUnitProperty_HostCallbacks => write(
                    data,
                    config.host_callbacks.unwrap_or(HostCallbackInfo {
                        hostUserData: ptr::null_mut(),
                        beatAndTempoProc: None,
                        musicalTimeLocationProc: None,
                        transportStateProc: None,
                        transportStateProc2: None,
                    }),
                ),
                kAudioUnitProperty_CocoaUI => match view::cocoa_view_info() {
                    Some(info) => write(data, info),
                    None => return kAudioUnitErr_InvalidProperty,
                },
                kAudioUnitProperty_PresentPreset => {
                    let preset = lock(&self.preset);
                    // The host owns, and releases, the returned name.
                    let name = Retained::into_raw(preset.name.clone());
                    write(
                        data,
                        AUPreset {
                            presetNumber: preset.number,
                            presetName: name.cast_const().cast(),
                        },
                    );
                }
                INSTANCE_PROPERTY => write(data, ptr::from_ref(self)),
                _ => return kAudioUnitErr_InvalidProperty,
            }
        }
        *size = needed as u32;
        0
    }

    /// # Safety
    ///
    /// `data` must be valid for reads of `size` bytes.
    unsafe fn set_property(
        &self,
        id: AudioUnitPropertyID,
        scope: AudioUnitScope,
        element: AudioUnitElement,
        data: *const c_void,
        size: u32,
    ) -> i32 {
        let (needed, writable) = match self.property_info(id, scope, element) {
            Ok(info) => info,
            Err(status) => return status,
        };
        if !writable {
            return kAudioUnitErr_PropertyNotWritable;
        }
        if data.is_null() {
            return kAudio_ParamError;
        }
        // Old hosts may pass a shorter HostCallbackInfo; everything else must
        // be complete.
        if id != kAudioUnitProperty_HostCallbacks && (size as usize) < needed {
            return kAudio_ParamError;
        }
        // SAFETY: `data` holds at least `needed` bytes (or, for
        // HostCallbacks, `size` bytes), the size of each value read below.
        let status = unsafe {
            match id {
                kAudioUnitProperty_ClassInfo => self.restore(read::<*const AnyObject>(data)),
                kAudioUnitProperty_MakeConnection => {
                    let connection = read::<AudioUnitConnection>(data);
                    lock(&self.config).input = if connection.sourceAudioUnit.is_null() {
                        Input::None
                    } else {
                        Input::Connection(connection)
                    };
                    0
                }
                kAudioUnitProperty_SetRenderCallback => {
                    let callback = read::<AURenderCallbackStruct>(data);
                    lock(&self.config).input = match callback.inputProc {
                        None => Input::None,
                        Some(proc_) => Input::Callback {
                            proc_: render_proc(proc_),
                            user_data: callback.inputProcRefCon,
                        },
                    };
                    0
                }
                kAudioUnitProperty_SampleRate => {
                    let sample_rate = read::<f64>(data);
                    if !(sample_rate.is_finite() && sample_rate > 0.0) {
                        return kAudioUnitErr_InvalidPropertyValue;
                    }
                    self.set_format(scope, |format| Format {
                        sample_rate,
                        ..format
                    })
                }
                kAudioUnitProperty_StreamFormat => {
                    let Some(new) = Format::from_description(&read(data)) else {
                        return kAudioUnitErr_FormatNotSupported;
                    };
                    self.set_format(scope, |_| new)
                }
                kAudioUnitProperty_MaximumFramesPerSlice => {
                    let frames = read::<u32>(data);
                    let mut config = lock(&self.config);
                    if frames == 0 {
                        kAudioUnitErr_InvalidPropertyValue
                    } else if frames == config.max_frames {
                        0
                    } else if config.initialized {
                        kAudioUnitErr_Initialized
                    } else {
                        config.max_frames = frames;
                        0
                    }
                }
                kAudioUnitProperty_HostCallbacks => {
                    let mut info = HostCallbackInfo {
                        hostUserData: ptr::null_mut(),
                        beatAndTempoProc: None,
                        musicalTimeLocationProc: None,
                        transportStateProc: None,
                        transportStateProc2: None,
                    };
                    let bytes = (size as usize).min(size_of::<HostCallbackInfo>());
                    ptr::copy_nonoverlapping(
                        data.cast::<u8>(),
                        ptr::from_mut(&mut info).cast::<u8>(),
                        bytes,
                    );
                    lock(&self.config).host_callbacks = Some(info);
                    0
                }
                kAudioUnitProperty_PresentPreset => {
                    let preset = read::<AUPreset>(data);
                    // There are no factory presets, so only user presets
                    // (negative numbers, with a name) are accepted.
                    let name = preset.presetName.cast::<NSString>().cast_mut();
                    match Retained::retain(name) {
                        Some(name) if preset.presetNumber < 0 => {
                            *lock(&self.preset) = Preset {
                                number: preset.presetNumber,
                                name,
                            };
                            0
                        }
                        _ => kAudioUnitErr_InvalidPropertyValue,
                    }
                }
                _ => kAudioUnitErr_InvalidProperty,
            }
        };
        if status == 0 {
            self.notify(id, scope, element);
            if id == kAudioUnitProperty_SampleRate {
                self.notify(kAudioUnitProperty_StreamFormat, scope, element);
            }
        }
        status
    }

    fn set_format(&self, scope: AudioUnitScope, change: impl FnOnce(Format) -> Format) -> i32 {
        let mut config = lock(&self.config);
        let initialized = config.initialized;
        let format = if scope == kAudioUnitScope_Input {
            &mut config.input_format
        } else {
            &mut config.output_format
        };
        let new = change(*format);
        if new == *format {
            0
        } else if initialized {
            kAudioUnitErr_Initialized
        } else {
            *format = new;
            0
        }
    }

    fn restore(&self, object: *const AnyObject) -> i32 {
        // SAFETY: the host passes a CFPropertyListRef, a valid object.
        let Some(object) = (unsafe { object.as_ref() }) else {
            return kAudio_ParamError;
        };
        match class_info::restore(object) {
            Ok(restored) => {
                if let Some(state) = restored.state {
                    *self.state() = state;
                }
                *lock(&self.preset) = Preset {
                    number: -1,
                    name: restored
                        .preset_name
                        .unwrap_or_else(|| NSString::from_str(DEFAULT_PRESET_NAME)),
                };
                self.notify(kAudioUnitProperty_PresentPreset, kAudioUnitScope_Global, 0);
                0
            }
            Err(status) => status,
        }
    }

    /// Calls the listeners registered for `id`.
    fn notify(&self, id: AudioUnitPropertyID, scope: AudioUnitScope, element: AudioUnitElement) {
        // Listeners may add or remove listeners, so call them unlocked.
        let listeners: Vec<Listener> = lock(&self.listeners)
            .iter()
            .filter(|listener| listener.property == id)
            .copied()
            .collect();
        for listener in listeners {
            // SAFETY: the host registered this callback for this unit.
            unsafe { (listener.proc_)(listener.user_data, self.unit(), id, scope, element) };
        }
    }

    /// # Safety
    ///
    /// All pointers come straight from the host's `AudioUnitRender` call.
    unsafe fn render(
        &self,
        flags: *mut AudioUnitRenderActionFlags,
        time_stamp: *const AudioTimeStamp,
        bus: u32,
        frames: u32,
        io_data: *mut AudioBufferList,
    ) -> i32 {
        let config = self.config();
        if !config.initialized {
            return kAudioUnitErr_Uninitialized;
        }
        if bus != 0 {
            return kAudioUnitErr_InvalidElement;
        }
        if frames > config.max_frames {
            return kAudioUnitErr_TooManyFramesToProcess;
        }
        let (Some(time_stamp), Some(io_data)) =
            (NonNull::new(time_stamp.cast_mut()), NonNull::new(io_data))
        else {
            return kAudio_ParamError;
        };
        let channels = config.output_format.channels as usize;
        // SAFETY: the host passes a valid buffer list and time stamp.
        let time_stamp = unsafe { time_stamp.as_ref() };
        if unsafe { io_data.as_ref() }.mNumberBuffers as usize != channels {
            return kAudio_ParamError;
        }
        let mut action_flags = if flags.is_null() {
            AudioUnitRenderActionFlags(0)
        } else {
            // SAFETY: non-null host pointer.
            unsafe { *flags }
        };

        self.call_render_notifies(
            action_flags | AudioUnitRenderActionFlags::UnitRenderAction_PreRender,
            time_stamp,
            bus,
            frames,
            io_data,
        );

        // SAFETY: the host passes a valid buffer list, and nothing else
        // touches it until the post-render notification.
        let io_buffers = unsafe { buffers_mut(io_data) };
        let mut scratch = lock(&self.scratch);
        let scratch = &mut *scratch;
        // SAFETY: `initialize` sized the scratch list for `channels` buffers
        // and the samples for `channels * max_frames`.
        let input = unsafe { scratch_list(scratch, channels, frames, config.max_frames) };
        let mut input_flags = AudioUnitRenderActionFlags(0);
        let status = match config.input {
            Input::None => kAudioUnitErr_NoConnection,
            // SAFETY: the host registered this callback to provide input.
            Input::Callback { proc_, user_data } => unsafe {
                proc_(
                    user_data,
                    &mut input_flags,
                    time_stamp,
                    0,
                    frames,
                    input.as_ptr(),
                )
            },
            // SAFETY: the host connected this unit's input to that unit.
            Input::Connection(connection) => unsafe {
                AudioUnitRender(
                    connection.sourceAudioUnit,
                    &mut input_flags,
                    NonNull::from(time_stamp),
                    connection.sourceOutputNumber,
                    frames,
                    input,
                )
            },
        };
        if status != 0 {
            self.last_render_error.store(status, Ordering::Release);
            return status;
        }

        // SAFETY: the input provider filled `input`, which may now point at
        // its own buffers.
        let input_buffers = unsafe { buffers_mut(input) };
        if input_buffers.len() != channels {
            return kAudio_ParamError;
        }
        let bytes = frames * size_of::<f32>() as u32;
        for (output, input) in io_buffers.iter_mut().zip(input_buffers.iter()) {
            if input.mData.is_null() {
                return kAudio_ParamError;
            }
            if output.mData.is_null() {
                // The host asked us to provide the buffer.
                output.mData = input.mData;
            } else if output.mData != input.mData {
                // SAFETY: both buffers hold at least `frames` samples.
                unsafe {
                    ptr::copy(
                        input.mData.cast::<f32>(),
                        output.mData.cast::<f32>(),
                        frames as usize,
                    );
                }
            }
            output.mNumberChannels = 1;
            output.mDataByteSize = bytes;
        }
        action_flags.remove(AudioUnitRenderActionFlags::UnitRenderAction_OutputIsSilence);
        action_flags |= input_flags & AudioUnitRenderActionFlags::UnitRenderAction_OutputIsSilence;
        if !flags.is_null() {
            // SAFETY: non-null host pointer.
            unsafe { *flags = action_flags };
        }

        let host_time = time_stamp
            .mFlags
            .contains(AudioTimeStampFlags::HostTimeValid)
            .then(|| host_ticks_to_sec(time_stamp.mHostTime, self.timebase.0, self.timebase.1));
        if let Some(host) = &config.host_callbacks {
            // SAFETY: host callbacks are only valid inside render, which is
            // where this runs.
            let reading = unsafe { read_host(host) };
            let now = host_time
                .unwrap_or_else(|| host_ticks_to_sec(host_now(), self.timebase.0, self.timebase.1));
            if let Some(snapshot) = snapshot(reading, config.output_format.sample_rate, now) {
                // A full ring means nobody is draining it; dropping keeps the
                // audio thread wait-free.
                let _ = scratch.transport.push(snapshot);
            }
        }

        if let Some(tap) = lock(&self.input_tap).as_ref() {
            let mut slices: [&[f32]; MAX_CHANNELS] = [&[]; MAX_CHANNELS];
            for (slice, buffer) in slices.iter_mut().zip(io_buffers.iter()) {
                // SAFETY: every output buffer now holds `frames` samples.
                *slice = unsafe {
                    std::slice::from_raw_parts(buffer.mData.cast::<f32>(), frames as usize)
                };
            }
            tap.process(
                &slices[..channels],
                config.output_format.sample_rate,
                host_time,
            );
        }

        self.call_render_notifies(
            action_flags | AudioUnitRenderActionFlags::UnitRenderAction_PostRender,
            time_stamp,
            bus,
            frames,
            io_data,
        );
        0
    }

    fn call_render_notifies(
        &self,
        mut flags: AudioUnitRenderActionFlags,
        time_stamp: &AudioTimeStamp,
        bus: u32,
        frames: u32,
        io_data: NonNull<AudioBufferList>,
    ) {
        for notify in lock(&self.render_notifies).iter() {
            // SAFETY: the host registered this callback for this unit.
            unsafe {
                (notify.proc_)(
                    notify.user_data,
                    &mut flags,
                    time_stamp,
                    bus,
                    frames,
                    io_data.as_ptr(),
                );
            }
        }
    }
}

/// The instance behind `unit`, when `unit` is a ZVID Capture instance in
/// this process.
///
/// # Safety
///
/// `unit` must be a valid, open audio unit, and the returned reference must
/// not outlive it.
pub unsafe fn instance_from_unit<'a>(unit: AudioUnit) -> Option<&'a AudioUnitInstance> {
    let mut instance: *const AudioUnitInstance = ptr::null();
    let mut size = size_of::<*const AudioUnitInstance>() as u32;
    // SAFETY: `unit` is valid per the contract and `instance` holds `size`
    // bytes.
    let status = unsafe {
        AudioUnitGetProperty(
            NonNull::new(unit)?.as_ptr(),
            INSTANCE_PROPERTY,
            kAudioUnitScope_Global,
            0,
            NonNull::from(&mut instance).cast(),
            NonNull::from(&mut size),
        )
    };
    if status != 0 {
        return None;
    }
    // SAFETY: only our own GetProperty answers INSTANCE_PROPERTY, with a
    // pointer to the live instance.
    unsafe { instance.as_ref() }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn valid_scope(scope: AudioUnitScope) -> Result<(), i32> {
    match scope {
        kAudioUnitScope_Global | kAudioUnitScope_Input | kAudioUnitScope_Output => Ok(()),
        _ => Err(kAudioUnitErr_InvalidScope),
    }
}

fn global(
    scope: AudioUnitScope,
    element: AudioUnitElement,
    size: usize,
    writable: bool,
) -> Result<(usize, bool), i32> {
    if scope != kAudioUnitScope_Global {
        return Err(kAudioUnitErr_InvalidScope);
    }
    if element != 0 {
        return Err(kAudioUnitErr_InvalidElement);
    }
    Ok((size, writable))
}

fn input(
    scope: AudioUnitScope,
    element: AudioUnitElement,
    size: usize,
    writable: bool,
) -> Result<(usize, bool), i32> {
    if scope != kAudioUnitScope_Input {
        return Err(kAudioUnitErr_InvalidScope);
    }
    if element != 0 {
        return Err(kAudioUnitErr_InvalidElement);
    }
    Ok((size, writable))
}

fn bus(
    scope: AudioUnitScope,
    element: AudioUnitElement,
    size: usize,
    writable: bool,
) -> Result<(usize, bool), i32> {
    if scope != kAudioUnitScope_Input && scope != kAudioUnitScope_Output {
        return Err(kAudioUnitErr_InvalidScope);
    }
    if element != 0 {
        return Err(kAudioUnitErr_InvalidElement);
    }
    Ok((size, writable))
}

/// # Safety
///
/// `data` must be valid for an unaligned write of a `T`.
unsafe fn write<T>(data: *mut c_void, value: T) {
    unsafe { data.cast::<T>().write_unaligned(value) };
}

/// # Safety
///
/// `data` must be valid for an unaligned read of a `T`.
unsafe fn read<T>(data: *const c_void) -> T {
    unsafe { data.cast::<T>().read_unaligned() }
}

/// The buffers of a buffer list.
///
/// # Safety
///
/// `list` must be a valid list holding `mNumberBuffers` buffers.
unsafe fn buffers_mut<'a>(list: NonNull<AudioBufferList>) -> &'a mut [AudioBuffer] {
    let list = list.as_ptr();
    unsafe {
        let count = (*list).mNumberBuffers as usize;
        let first = ptr::addr_of_mut!((*list).mBuffers).cast::<AudioBuffer>();
        std::slice::from_raw_parts_mut(first, count)
    }
}

/// Points the scratch buffer list at the scratch samples, one channel per
/// buffer, and returns it.
///
/// # Safety
///
/// `scratch` must have been sized by `initialize` for `channels` channels and
/// `max_frames` frames, and `frames <= max_frames`.
unsafe fn scratch_list(
    scratch: &mut Scratch,
    channels: usize,
    frames: u32,
    max_frames: u32,
) -> NonNull<AudioBufferList> {
    let list = NonNull::new(scratch.list.as_mut_ptr().cast::<AudioBufferList>())
        .expect("vec pointers are non-null");
    unsafe {
        (*list.as_ptr()).mNumberBuffers = channels as u32;
        for (channel, buffer) in buffers_mut(list).iter_mut().enumerate() {
            *buffer = AudioBuffer {
                mNumberChannels: 1,
                mDataByteSize: frames * size_of::<f32>() as u32,
                mData: scratch
                    .samples
                    .as_mut_ptr()
                    .add(channel * max_frames as usize)
                    .cast(),
            };
        }
    }
    list
}

/// Reads the transport through whichever host callbacks are set.
///
/// # Safety
///
/// Must be called inside the render call, with callbacks the host set.
unsafe fn read_host(host: &HostCallbackInfo) -> HostReading {
    let mut reading = HostReading::default();
    let user = host.hostUserData;
    let (mut playing, mut recording, mut changed, mut cycling) = (0u8, 0u8, 0u8, 0u8);
    let (mut sample, mut cycle_start, mut cycle_end) = (0f64, 0f64, 0f64);
    let transport = unsafe {
        if let Some(proc_) = host.transportStateProc2 {
            Some(proc_(
                user,
                &mut playing,
                &mut recording,
                &mut changed,
                &mut sample,
                &mut cycling,
                &mut cycle_start,
                &mut cycle_end,
            ))
        } else {
            host.transportStateProc.map(|proc_| {
                proc_(
                    user,
                    &mut playing,
                    &mut changed,
                    &mut sample,
                    &mut cycling,
                    &mut cycle_start,
                    &mut cycle_end,
                )
            })
        }
    };
    if transport == Some(0) {
        reading.playing = Some(playing != 0);
        reading.sample_in_timeline = Some(sample);
    }
    if let Some(proc_) = host.beatAndTempoProc {
        let (mut beat, mut tempo) = (0f64, 0f64);
        if unsafe { proc_(user, &mut beat, &mut tempo) } == 0 {
            reading.beat = Some(beat);
            reading.tempo = Some(tempo);
        }
    }
    if let Some(proc_) = host.musicalTimeLocationProc {
        let (mut offset, mut numerator, mut denominator, mut downbeat) = (0u32, 0f32, 0u32, 0f64);
        let status = unsafe {
            proc_(
                user,
                &mut offset,
                &mut numerator,
                &mut denominator,
                &mut downbeat,
            )
        };
        if status == 0 {
            reading.time_signature = Some([numerator.round() as u32, denominator]);
        }
    }
    reading
}

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

unsafe extern "C" {
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    fn mach_absolute_time() -> u64;
}

fn timebase() -> (u32, u32) {
    let mut info = MachTimebaseInfo { numer: 1, denom: 1 };
    // SAFETY: `info` is a valid out-pointer.
    if unsafe { mach_timebase_info(&mut info) } != 0 || info.denom == 0 {
        return (1, 1);
    }
    (info.numer, info.denom)
}

fn host_now() -> u64 {
    // SAFETY: no preconditions.
    unsafe { mach_absolute_time() }
}

// ---- Plug-in interface entry points --------------------------------------

type Method = unsafe extern "C-unwind" fn(NonNull<c_void>, ...) -> i32;

/// Runs a handler on the instance, turning a panic into an error status.
///
/// # Safety
///
/// `this` must be the pointer the factory returned.
unsafe fn with(this: NonNull<c_void>, handler: impl FnOnce(&AudioUnitInstance) -> i32) -> i32 {
    // SAFETY: the host passes back the pointer the factory returned.
    let instance = unsafe { this.cast::<AudioUnitInstance>().as_ref() };
    catch_unwind(AssertUnwindSafe(|| handler(instance))).unwrap_or(PANIC_STATUS)
}

unsafe extern "C-unwind" fn open(this: NonNull<c_void>, unit: AudioComponentInstance) -> i32 {
    unsafe {
        with(this, |instance| {
            instance.unit.store(unit, Ordering::Release);
            0
        })
    }
}

unsafe extern "C-unwind" fn close(this: NonNull<c_void>) -> i32 {
    // SAFETY: the factory created this box; the host closes it exactly once.
    drop(unsafe { Box::from_raw(this.cast::<AudioUnitInstance>().as_ptr()) });
    0
}

unsafe extern "C-unwind" fn lookup(selector: i16) -> AudioComponentMethod {
    let method: *const () = match selector as c_uint {
        kAudioUnitInitializeSelect => initialize as *const (),
        kAudioUnitUninitializeSelect => uninitialize as *const (),
        kAudioUnitGetPropertyInfoSelect => get_property_info as *const (),
        kAudioUnitGetPropertySelect => get_property as *const (),
        kAudioUnitSetPropertySelect => set_property as *const (),
        kAudioUnitAddPropertyListenerSelect => add_property_listener as *const (),
        kAudioUnitRemovePropertyListenerSelect => remove_property_listener as *const (),
        kAudioUnitRemovePropertyListenerWithUserDataSelect => {
            remove_property_listener_with_user_data as *const ()
        }
        kAudioUnitAddRenderNotifySelect => add_render_notify as *const (),
        kAudioUnitRemoveRenderNotifySelect => remove_render_notify as *const (),
        kAudioUnitGetParameterSelect => get_parameter as *const (),
        kAudioUnitSetParameterSelect => set_parameter as *const (),
        kAudioUnitScheduleParametersSelect => schedule_parameters as *const (),
        kAudioUnitRenderSelect => render as *const (),
        kAudioUnitResetSelect => reset as *const (),
        _ => return None,
    };
    // SAFETY: AudioToolbox calls each selector's method with that selector's
    // concrete prototype, which is what each function above implements; the
    // variadic type is only how the table stores them.
    Some(unsafe { mem::transmute::<*const (), Method>(method) })
}

unsafe extern "C-unwind" fn initialize(this: NonNull<c_void>) -> i32 {
    unsafe { with(this, AudioUnitInstance::initialize) }
}

unsafe extern "C-unwind" fn uninitialize(this: NonNull<c_void>) -> i32 {
    unsafe { with(this, AudioUnitInstance::uninitialize) }
}

unsafe extern "C-unwind" fn get_property_info(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    scope: AudioUnitScope,
    element: AudioUnitElement,
    out_size: *mut u32,
    out_writable: *mut u8,
) -> i32 {
    unsafe {
        with(this, |instance| {
            match instance.property_info(id, scope, element) {
                Ok((size, writable)) => {
                    if !out_size.is_null() {
                        *out_size = size as u32;
                    }
                    if !out_writable.is_null() {
                        *out_writable = u8::from(writable);
                    }
                    0
                }
                Err(status) => status,
            }
        })
    }
}

unsafe extern "C-unwind" fn get_property(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    scope: AudioUnitScope,
    element: AudioUnitElement,
    out_data: *mut c_void,
    io_size: *mut u32,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let Some(size) = io_size.as_mut() else {
                return kAudio_ParamError;
            };
            if out_data.is_null() {
                return kAudio_ParamError;
            }
            instance.get_property(id, scope, element, out_data, size)
        })
    }
}

unsafe extern "C-unwind" fn set_property(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    scope: AudioUnitScope,
    element: AudioUnitElement,
    data: *const c_void,
    size: u32,
) -> i32 {
    unsafe {
        with(this, |instance| {
            instance.set_property(id, scope, element, data, size)
        })
    }
}

unsafe extern "C-unwind" fn add_property_listener(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    proc_: AudioUnitPropertyListenerProc,
    user_data: *mut c_void,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let Some(proc_) = proc_ else {
                return kAudio_ParamError;
            };
            lock(&instance.listeners).push(Listener {
                property: id,
                proc_: listener_proc(proc_),
                user_data,
            });
            0
        })
    }
}

unsafe extern "C-unwind" fn remove_property_listener(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    proc_: AudioUnitPropertyListenerProc,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let proc_ = proc_.map(listener_proc);
            lock(&instance.listeners).retain(|listener| {
                !(listener.property == id && same_fn(Some(listener.proc_), proc_))
            });
            0
        })
    }
}

unsafe extern "C-unwind" fn remove_property_listener_with_user_data(
    this: NonNull<c_void>,
    id: AudioUnitPropertyID,
    proc_: AudioUnitPropertyListenerProc,
    user_data: *mut c_void,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let proc_ = proc_.map(listener_proc);
            lock(&instance.listeners).retain(|listener| {
                !(listener.property == id
                    && same_fn(Some(listener.proc_), proc_)
                    && listener.user_data == user_data)
            });
            0
        })
    }
}

unsafe extern "C-unwind" fn add_render_notify(
    this: NonNull<c_void>,
    proc_: AURenderCallback,
    user_data: *mut c_void,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let Some(proc_) = proc_ else {
                return kAudio_ParamError;
            };
            lock(&instance.render_notifies).push(RenderNotify {
                proc_: render_proc(proc_),
                user_data,
            });
            0
        })
    }
}

unsafe extern "C-unwind" fn remove_render_notify(
    this: NonNull<c_void>,
    proc_: AURenderCallback,
    user_data: *mut c_void,
) -> i32 {
    unsafe {
        with(this, |instance| {
            let proc_ = proc_.map(render_proc);
            lock(&instance.render_notifies).retain(|notify| {
                !(same_fn(Some(notify.proc_), proc_) && notify.user_data == user_data)
            });
            0
        })
    }
}

unsafe extern "C-unwind" fn get_parameter(
    _this: NonNull<c_void>,
    _id: u32,
    _scope: AudioUnitScope,
    _element: AudioUnitElement,
    _value: *mut f32,
) -> i32 {
    kAudioUnitErr_InvalidParameter
}

unsafe extern "C-unwind" fn set_parameter(
    _this: NonNull<c_void>,
    _id: u32,
    _scope: AudioUnitScope,
    _element: AudioUnitElement,
    _value: f32,
    _buffer_offset: u32,
) -> i32 {
    kAudioUnitErr_InvalidParameter
}

unsafe extern "C-unwind" fn schedule_parameters(
    _this: NonNull<c_void>,
    _events: *const c_void,
    count: u32,
) -> i32 {
    if count == 0 {
        0
    } else {
        kAudioUnitErr_InvalidParameter
    }
}

unsafe extern "C-unwind" fn render(
    this: NonNull<c_void>,
    flags: *mut AudioUnitRenderActionFlags,
    time_stamp: *const AudioTimeStamp,
    bus: u32,
    frames: u32,
    io_data: *mut AudioBufferList,
) -> i32 {
    unsafe {
        with(this, |instance| {
            instance.render(flags, time_stamp, bus, frames, io_data)
        })
    }
}

unsafe extern "C-unwind" fn reset(
    _this: NonNull<c_void>,
    _scope: AudioUnitScope,
    _element: AudioUnitElement,
) -> i32 {
    0
}

/// Whether two optional function pointers are the same function.
fn same_fn<F: Copy>(a: Option<F>, b: Option<F>) -> bool {
    match (a, b) {
        // SAFETY: function pointers are pointer-sized.
        (Some(a), Some(b)) => unsafe {
            mem::transmute_copy::<F, usize>(&a) == mem::transmute_copy::<F, usize>(&b)
        },
        (None, None) => true,
        _ => false,
    }
}

/// The binding's listener type with the user-data pointer made nullable.
fn listener_proc(
    proc_: unsafe extern "C-unwind" fn(
        NonNull<c_void>,
        AudioUnit,
        AudioUnitPropertyID,
        AudioUnitScope,
        AudioUnitElement,
    ),
) -> ListenerProc {
    // SAFETY: `NonNull<T>` and `*mut T` share an ABI; hosts may register a
    // null user-data pointer, which the binding's type cannot express.
    unsafe { mem::transmute(proc_) }
}

/// The binding's render callback type with its pointers made nullable.
fn render_proc(
    proc_: unsafe extern "C-unwind" fn(
        NonNull<c_void>,
        NonNull<AudioUnitRenderActionFlags>,
        NonNull<AudioTimeStamp>,
        u32,
        u32,
        *mut AudioBufferList,
    ) -> i32,
) -> RenderProc {
    // SAFETY: `NonNull<T>` and `*mut T`/`*const T` share an ABI; hosts may
    // register a null user-data pointer.
    unsafe { mem::transmute(proc_) }
}
