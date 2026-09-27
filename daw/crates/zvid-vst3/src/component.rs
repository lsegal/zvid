//! The ZVID Capture component: one COM object that is the `IComponent`, the
//! `IAudioProcessor` and the `IEditController`, a single-component effect.
//! `IComponent::getControllerClassId` returns the component's own class ID,
//! so no `IConnectionPoint` is needed.
//!
//! The object starts with one vtable pointer per interface. An interface
//! pointer handed to the host points at that interface's vtable field, and
//! each method subtracts the field's offset to find the object.
//!
//! `process()` is real-time safe: it copies audio, pushes a transport
//! snapshot and, once the tap is taken, timed input audio into lock-free
//! rings, and
//! never allocates, locks, does I/O or logs. A control thread started by
//! `initialize` drains the transport ring and the capture layer's
//! [`Command`]s into the take log, which appends every take to the plugin
//! state as it opens, and tells the host the state changed. It also logs
//! transport changes, and arms and disarms the capture as Live's record
//! buttons turn on and off when the optional Live companion script is
//! running.

use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::mem::offset_of;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering, fence};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use zvid_daw_core::{
    AudioTap, Command, Consumer, ProcessSnapshot, Producer, RecordRoot, SharedLiveStatus, State,
    TakeChange, TakeFeed, TapWriter, TransportFollower, audio_tap, clock, ring,
};

use zvid_daw_ui::{Backend, HostLink, LiveControl, instance_backend};

use crate::CLASS_ID;
use crate::abi::result::{FALSE, INVALID_ARGUMENT, NO_INTERFACE, NOT_IMPLEMENTED, OK};
use crate::abi::*;
use crate::log::log;
use crate::transport::snapshot;
use crate::view::View;

/// Snapshots the transport ring holds: about ten seconds of 512-sample
/// blocks at 48 kHz, far more than the control thread lets queue up.
const TRANSPORT_CAPACITY: usize = 1024;
/// Stereo frames the audio tap holds: about 5 s at 48 kHz.
const AUDIO_TAP_FRAMES: usize = 1 << 18;
/// How often the control thread drains the transport ring.
const CONTROL_INTERVAL: Duration = Duration::from_millis(10);
/// Largest state `setState` accepts.
const MAX_STATE_BYTES: usize = 64 << 20;
/// Chunk size for reading and writing host streams.
const STREAM_CHUNK: usize = 16 << 10;

const COMPONENT: usize = offset_of!(Component, component_vtbl);
const PROCESSOR: usize = offset_of!(Component, processor_vtbl);
const CONTROLLER: usize = offset_of!(Component, controller_vtbl);
const REQUIREMENTS: usize = offset_of!(Component, requirements_vtbl);

/// Fields only `process()` touches. VST3 calls `process()` from one thread
/// at a time, so they need no synchronization.
struct AudioThread {
    block: u64,
    transport: Producer<ProcessSnapshot>,
    tap: TapWriter,
}

/// What the control thread reads from.
struct ControlInputs {
    transport: Consumer<ProcessSnapshot>,
    commands: Receiver<Command>,
}

struct Control {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<ControlInputs>,
}

#[derive(Default)]
struct Lifecycle {
    /// Unbalanced `initialize` calls. The host may initialize the component
    /// and controller sides separately, even though they are one object.
    initialized: u32,
    control: Option<Control>,
    /// The control thread's inputs while no control thread owns them.
    inputs: Option<ControlInputs>,
}

#[repr(C)]
pub struct Component {
    component_vtbl: &'static IComponentVtbl,
    processor_vtbl: &'static IAudioProcessorVtbl,
    controller_vtbl: &'static IEditControllerVtbl,
    requirements_vtbl: &'static IProcessContextRequirementsVtbl,
    refs: AtomicU32,
    lifecycle: Mutex<Lifecycle>,
    state: Arc<Mutex<State>>,
    handler: Arc<HostHandler>,
    commands: Sender<Command>,
    /// Takes the control thread opens and closes, for the editor.
    takes: TakeFeed,
    /// What the Live companion last reported, kept current by the control
    /// thread, for the editor's record root.
    live: SharedLiveStatus,
    tap_enabled: AtomicBool,
    audio_tap: Mutex<Option<AudioTap>>,
    /// The sample rate from `setupProcessing` as `f64` bits, for blocks
    /// without a process context.
    sample_rate: AtomicU64,
    audio: UnsafeCell<AudioThread>,
    /// What every editor this instance opens talks to, created with the
    /// first one.
    backend: OnceLock<Arc<dyn Backend>>,
}

impl Component {
    /// Allocates a component holding one reference.
    pub fn create() -> *mut Component {
        let (transport, transport_reader) = ring(TRANSPORT_CAPACITY);
        let (commands, command_reader) = mpsc::channel();
        let (tap, tap_reader) = audio_tap(AUDIO_TAP_FRAMES);
        Box::into_raw(Box::new(Component {
            component_vtbl: &COMPONENT_VTBL,
            processor_vtbl: &PROCESSOR_VTBL,
            controller_vtbl: &CONTROLLER_VTBL,
            requirements_vtbl: &REQUIREMENTS_VTBL,
            refs: AtomicU32::new(1),
            lifecycle: Mutex::new(Lifecycle {
                inputs: Some(ControlInputs {
                    transport: transport_reader,
                    commands: command_reader,
                }),
                ..Lifecycle::default()
            }),
            state: Arc::new(Mutex::new(State::default())),
            handler: Arc::new(HostHandler::default()),
            commands,
            takes: TakeFeed::default(),
            live: SharedLiveStatus::default(),
            tap_enabled: AtomicBool::new(false),
            audio_tap: Mutex::new(Some(tap_reader)),
            sample_rate: AtomicU64::new(0),
            audio: UnsafeCell::new(AudioThread {
                block: 0,
                transport,
                tap,
            }),
            backend: OnceLock::new(),
        }))
    }

    /// Creates a component and returns its `iid` interface in `obj`, as
    /// `IPluginFactory::createInstance` does.
    ///
    /// # Safety
    /// `iid` must be null or point to 16 bytes; `obj` must be null or
    /// writable.
    pub unsafe fn create_instance(iid: *const c_void, obj: *mut *mut c_void) -> TResult {
        let component = Self::create();
        unsafe {
            let result = (*component).query_interface(iid.cast(), obj);
            Self::release(component);
            result
        }
    }

    /// The persisted state.
    pub fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    /// Where the capture layer sends [`Command::Arm`], [`Command::Disarm`]
    /// and [`Command::FrameClock`]. Commands wait while the component is
    /// not initialized and are applied once the control thread runs.
    pub fn commands(&self) -> Sender<Command> {
        self.commands.clone()
    }

    /// The persisted state, shared with the editor backend.
    pub fn shared_state(&self) -> Arc<Mutex<State>> {
        Arc::clone(&self.state)
    }

    /// Receives each take the control thread opens or closes, replacing
    /// any earlier receiver.
    pub fn take_changes(&self) -> Receiver<TakeChange> {
        self.takes.subscribe()
    }

    /// Takes the reading end of the input-audio tap: blocks of stereo frames
    /// from the main input bus (mono input is duplicated), each with the
    /// host time of its first frame, taken at the start of `process()` as
    /// for transport snapshots, and the sample rate. `process()` only feeds
    /// the tap once it has been taken; later calls return `None`.
    pub fn take_audio_tap(&self) -> Option<AudioTap> {
        let tap = lock(&self.audio_tap).take();
        if tap.is_some() {
            self.tap_enabled.store(true, Ordering::Release);
        }
        tap
    }

    /// The backend this instance's editors share: the one the plugin binary
    /// registered (see [`zvid_daw_ui::register_backend`]), started when the
    /// first editor opens and shut down with the instance.
    ///
    /// Starting it takes the [`Component::take_changes`] receiver and the audio
    /// tap, which only happens once. An editor may open before `initialize`: it
    /// lists and opens cameras right away, while its capture commands wait in
    /// [`Component::commands`] and takes appear once the control thread runs.
    pub fn backend(&self) -> Arc<dyn Backend> {
        self.backend
            .get_or_init(|| {
                let handler = Arc::clone(&self.handler);
                instance_backend(HostLink {
                    state: self.shared_state(),
                    commands: self.commands(),
                    takes: self.take_changes(),
                    state_changed: Box::new(move || handler.state_changed()),
                    documents_root: RecordRoot::resolve_or_temp(None),
                    live: self.live.clone(),
                    audio: self.take_audio_tap(),
                })
            })
            .clone()
    }

    unsafe fn query_interface(&self, iid: *const Tuid, obj: *mut *mut c_void) -> TResult {
        if obj.is_null() {
            return INVALID_ARGUMENT;
        }
        let offset = match unsafe { read_tuid(iid.cast()) } {
            Some(FUNKNOWN_IID | IPLUGIN_BASE_IID | ICOMPONENT_IID) => COMPONENT,
            Some(IAUDIO_PROCESSOR_IID) => PROCESSOR,
            Some(IEDIT_CONTROLLER_IID) => CONTROLLER,
            Some(IPROCESS_CONTEXT_REQUIREMENTS_IID) => REQUIREMENTS,
            _ => {
                unsafe { *obj = ptr::null_mut() };
                return NO_INTERFACE;
            }
        };
        self.add_ref();
        unsafe { *obj = ptr::from_ref(self).byte_add(offset).cast_mut().cast() };
        OK
    }

    fn add_ref(&self) -> u32 {
        self.refs.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// # Safety
    /// `this` must come from [`Component::create`] and own a reference.
    unsafe fn release(this: *const Component) -> u32 {
        let remaining = unsafe { (*this).refs.fetch_sub(1, Ordering::Release) } - 1;
        if remaining == 0 {
            fence(Ordering::Acquire);
            drop(unsafe { Box::from_raw(this.cast_mut()) });
        }
        remaining
    }

    fn initialize(&self) -> TResult {
        let mut lifecycle = lock(&self.lifecycle);
        lifecycle.initialized += 1;
        if lifecycle.initialized == 1
            && let Some(inputs) = lifecycle.inputs.take()
        {
            lifecycle.control = start_control(
                ptr::from_ref(self) as usize,
                inputs,
                Arc::clone(&self.state),
                self.takes.clone(),
                self.live.clone(),
                Arc::clone(&self.handler),
            );
        }
        OK
    }

    fn terminate(&self) -> TResult {
        let mut lifecycle = lock(&self.lifecycle);
        if lifecycle.initialized == 0 {
            return OK;
        }
        lifecycle.initialized -= 1;
        if lifecycle.initialized == 0 {
            stop_control(&mut lifecycle);
            drop(lifecycle);
            unsafe { self.set_component_handler(ptr::null_mut()) };
        }
        OK
    }

    fn bus_count(media: i32) -> i32 {
        i32::from(media == MEDIA_AUDIO)
    }

    unsafe fn bus_info(media: i32, dir: i32, index: i32, bus: *mut BusInfo) -> TResult {
        if bus.is_null() || media != MEDIA_AUDIO || index != 0 {
            return INVALID_ARGUMENT;
        }
        let name = match dir {
            DIRECTION_INPUT => "Input",
            DIRECTION_OUTPUT => "Output",
            _ => return INVALID_ARGUMENT,
        };
        let bus = unsafe { &mut *bus };
        bus.media_type = MEDIA_AUDIO;
        bus.direction = dir;
        bus.channel_count = 2;
        copy_utf16(&mut bus.name, name);
        bus.bus_type = BUS_MAIN;
        bus.flags = BUS_DEFAULT_ACTIVE;
        OK
    }

    unsafe fn set_state(&self, stream: *mut c_void) -> TResult {
        let Some(bytes) = (unsafe { read_stream(stream) }) else {
            return INVALID_ARGUMENT;
        };
        if bytes.is_empty() {
            return OK;
        }
        let parsed = std::str::from_utf8(&bytes)
            .map_err(|error| error.to_string())
            .and_then(|json| State::from_json(json).map_err(|error| error.to_string()));
        match parsed {
            Ok(state) => {
                *lock(&self.state) = state;
                OK
            }
            Err(error) => {
                log(&format!("ignoring unreadable state: {error}"));
                FALSE
            }
        }
    }

    unsafe fn get_state(&self, stream: *mut c_void) -> TResult {
        let json = lock(&self.state).to_json();
        if unsafe { write_stream(stream, json.as_bytes()) } {
            OK
        } else {
            FALSE
        }
    }

    unsafe fn set_component_handler(&self, handler: *mut c_void) -> TResult {
        unsafe { self.handler.set(handler) };
        OK
    }

    /// # Safety
    /// Called only from the host's audio thread, with `data` valid for the
    /// call.
    unsafe fn process(&self, data: *mut ProcessData) -> TResult {
        let Some(data) = (unsafe { data.as_mut() }) else {
            return INVALID_ARGUMENT;
        };
        // SAFETY: `process()` is never called concurrently.
        let audio = unsafe { &mut *self.audio.get() };
        audio.block += 1;
        let now = clock::now_sec();
        let context = unsafe { data.process_context.as_ref() };
        if let Some(context) = context {
            audio
                .transport
                .push(snapshot(context, audio.block, data.num_samples, now));
        }
        if data.symbolic_sample_size != SAMPLE_32 {
            return NOT_IMPLEMENTED;
        }
        let frames = usize::try_from(data.num_samples).unwrap_or(0);
        let input = if data.num_inputs > 0 {
            unsafe { data.inputs.as_ref() }
        } else {
            None
        };
        let output = if data.num_outputs > 0 {
            unsafe { data.outputs.as_mut() }
        } else {
            None
        };
        unsafe {
            // Tap before copying: with in-place buffers, the input is the
            // output.
            if self.tap_enabled.load(Ordering::Acquire)
                && let Some(left) = input.and_then(|bus| channel(bus, 0))
            {
                let right = input.and_then(|bus| channel(bus, 1)).unwrap_or(left);
                let sample_rate = context
                    .map(|context| context.sample_rate)
                    .filter(|rate| *rate > 0.0)
                    .unwrap_or_else(|| f64::from_bits(self.sample_rate.load(Ordering::Relaxed)));
                // A full tap drops the whole block and counts it.
                if sample_rate > 0.0 {
                    audio.tap.push(now, sample_rate, frames, |frame| {
                        [*left.add(frame), *right.add(frame)]
                    });
                }
            }
            if let Some(output) = output {
                pass_through(input, output, frames);
            }
        }
        OK
    }
}

impl Drop for Component {
    fn drop(&mut self) {
        // The control thread may start the backend, so it stops first.
        stop_control(self.lifecycle.get_mut().unwrap_or_else(|e| e.into_inner()));
        // Editors may outlive the instance; the capture must not.
        if let Some(backend) = self.backend.get() {
            backend.shutdown();
        }
        unsafe { self.set_component_handler(ptr::null_mut()) };
    }
}

/// The host's `IComponentHandler`, shared with the control thread so it can
/// tell the host when a take changes the state.
#[derive(Default)]
struct HostHandler(Mutex<HandlerPtr>);

struct HandlerPtr(*mut c_void);

impl Default for HandlerPtr {
    fn default() -> Self {
        Self(ptr::null_mut())
    }
}

// SAFETY: the pointer is a reference-counted host object, and this crate
// only calls it under `HostHandler`'s lock or through its own reference.
unsafe impl Send for HandlerPtr {}

impl HostHandler {
    /// Holds a reference to `handler`, or to nothing when it is null, in
    /// place of the current one.
    ///
    /// # Safety
    /// `handler` must be null or a live `IComponentHandler`.
    unsafe fn set(&self, handler: *mut c_void) {
        let old = {
            let mut current = lock(&self.0);
            if !handler.is_null() {
                unsafe { (vtbl::<FUnknownVtbl>(handler).add_ref)(handler) };
            }
            std::mem::replace(&mut current.0, handler)
        };
        if !old.is_null() {
            unsafe { (vtbl::<FUnknownVtbl>(old).release)(old) };
        }
    }

    /// Tells the host the state changed so it marks the project as
    /// modified: `IComponentHandler2::setDirty` when the host has it,
    /// otherwise `restartComponent(kParamValuesChanged)`.
    fn state_changed(&self) {
        // Query under the lock, which takes a reference, and call the host
        // without it.
        let (dirty, restart) = {
            let current = lock(&self.0);
            if current.0.is_null() {
                return;
            }
            unsafe {
                match query_host(current.0, &ICOMPONENT_HANDLER2_IID) {
                    Some(handler) => (Some(handler), None),
                    None => (None, query_host(current.0, &ICOMPONENT_HANDLER_IID)),
                }
            }
        };
        unsafe {
            if let Some(handler) = dirty {
                (vtbl::<IComponentHandler2Vtbl>(handler).set_dirty)(handler, 1);
                (vtbl::<FUnknownVtbl>(handler).release)(handler);
            } else if let Some(handler) = restart {
                (vtbl::<IComponentHandlerVtbl>(handler).restart_component)(
                    handler,
                    restart::PARAM_VALUES_CHANGED,
                );
                (vtbl::<FUnknownVtbl>(handler).release)(handler);
            } else {
                log("the host's component handler can't be told the state changed");
            }
        }
    }
}

/// `object`'s `iid` interface, holding a reference, if it has one.
///
/// # Safety
/// `object` must be a live COM object.
unsafe fn query_host(object: *mut c_void, iid: &Tuid) -> Option<*mut c_void> {
    let mut out = ptr::null_mut();
    let result = unsafe { (vtbl::<FUnknownVtbl>(object).query_interface)(object, iid, &mut out) };
    (result == OK && !out.is_null()).then_some(out)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts the control thread for the component at address `component`,
/// which must stop and join it before it is freed.
fn start_control(
    component: usize,
    mut inputs: ControlInputs,
    state: Arc<Mutex<State>>,
    takes: TakeFeed,
    shared: SharedLiveStatus,
    handler: Arc<HostHandler>,
) -> Option<Control> {
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = Arc::clone(&stop);
    let spawned = thread::Builder::new()
        .name("zvid-vst3-control".to_string())
        .spawn(move || {
            let mut follower = TransportFollower::with_feed(takes);
            let mut live = LiveControl::connect(shared.clone())
                .inspect_err(|error| log(&format!("could not open the Live link: {error}")))
                .ok();
            // SAFETY: the component stops and joins this thread before it is
            // freed, so it outlives every use here.
            let backend = || unsafe { &*(component as *const Component) }.backend();
            loop {
                let stopping = stopping.load(Ordering::Acquire);
                if follower.drain(&mut inputs.transport, &inputs.commands, &state, log) {
                    handler.state_changed();
                }
                if let Some(live) = &mut live {
                    live.poll(Instant::now(), backend, log);
                }
                if stopping {
                    // Nothing polls the companion until the next start.
                    shared.set(None);
                    return inputs;
                }
                thread::park_timeout(CONTROL_INTERVAL);
            }
        });
    match spawned {
        Ok(thread) => Some(Control { stop, thread }),
        Err(error) => {
            log(&format!("could not start the control thread: {error}"));
            None
        }
    }
}

fn stop_control(lifecycle: &mut Lifecycle) {
    let Some(control) = lifecycle.control.take() else {
        return;
    };
    control.stop.store(true, Ordering::Release);
    control.thread.thread().unpark();
    match control.thread.join() {
        Ok(inputs) => lifecycle.inputs = Some(inputs),
        Err(_) => log("the control thread panicked"),
    }
}

/// Sample pointer of channel `index`, if the bus has it.
unsafe fn channel(bus: &AudioBusBuffers, index: usize) -> Option<*mut f32> {
    let count = usize::try_from(bus.num_channels).unwrap_or(0);
    if index >= count || bus.channel_buffers.is_null() {
        return None;
    }
    let samples = unsafe { *bus.channel_buffers.add(index) }.cast::<f32>();
    (!samples.is_null()).then_some(samples)
}

/// Copies input channels to the matching output channels and silences
/// output channels without an input.
unsafe fn pass_through(
    input: Option<&AudioBusBuffers>,
    output: &mut AudioBusBuffers,
    frames: usize,
) {
    let channels = usize::try_from(output.num_channels).unwrap_or(0);
    let mut silent = 0u64;
    for index in 0..channels {
        let Some(target) = (unsafe { channel(output, index) }) else {
            continue;
        };
        match input.and_then(|bus| unsafe { channel(bus, index) }) {
            Some(source) => {
                if source != target {
                    unsafe { ptr::copy(source, target, frames) };
                }
                if index < 64 {
                    let from_input = input.map_or(0, |bus| bus.silence_flags);
                    silent |= from_input & (1 << index);
                }
            }
            None => {
                unsafe { ptr::write_bytes(target, 0, frames) };
                if index < 64 {
                    silent |= 1 << index;
                }
            }
        }
    }
    output.silence_flags = silent;
}

// Vtable thunks. Each receives the interface pointer the host holds and
// finds the component from the interface's field offset.

unsafe fn this<'a, const OFFSET: usize>(this: *mut c_void) -> &'a Component {
    unsafe { &*this.byte_sub(OFFSET).cast::<Component>() }
}

unsafe extern "system" fn query_interface<const OFFSET: usize>(
    this_: *mut c_void,
    iid: *const Tuid,
    obj: *mut *mut c_void,
) -> TResult {
    unsafe { this::<OFFSET>(this_).query_interface(iid, obj) }
}

unsafe extern "system" fn add_ref<const OFFSET: usize>(this_: *mut c_void) -> u32 {
    unsafe { this::<OFFSET>(this_).add_ref() }
}

unsafe extern "system" fn release<const OFFSET: usize>(this_: *mut c_void) -> u32 {
    unsafe { Component::release(this::<OFFSET>(this_)) }
}

const fn unknown<const OFFSET: usize>() -> FUnknownVtbl {
    FUnknownVtbl {
        query_interface: query_interface::<OFFSET>,
        add_ref: add_ref::<OFFSET>,
        release: release::<OFFSET>,
    }
}

unsafe extern "system" fn initialize<const OFFSET: usize>(
    this_: *mut c_void,
    _context: *mut c_void,
) -> TResult {
    unsafe { this::<OFFSET>(this_).initialize() }
}

unsafe extern "system" fn terminate<const OFFSET: usize>(this_: *mut c_void) -> TResult {
    unsafe { this::<OFFSET>(this_).terminate() }
}

static COMPONENT_VTBL: IComponentVtbl = IComponentVtbl {
    unknown: unknown::<COMPONENT>(),
    initialize: initialize::<COMPONENT>,
    terminate: terminate::<COMPONENT>,
    get_controller_class_id: component_get_controller_class_id,
    set_io_mode: component_set_io_mode,
    get_bus_count: component_get_bus_count,
    get_bus_info: component_get_bus_info,
    get_routing_info: component_get_routing_info,
    activate_bus: component_activate_bus,
    set_active: component_set_active,
    set_state: component_set_state,
    get_state: component_get_state,
};

unsafe extern "system" fn component_get_controller_class_id(
    _this: *mut c_void,
    class_id: *mut Tuid,
) -> TResult {
    if class_id.is_null() {
        return INVALID_ARGUMENT;
    }
    unsafe { class_id.write_unaligned(CLASS_ID) };
    OK
}

unsafe extern "system" fn component_set_io_mode(_this: *mut c_void, _mode: i32) -> TResult {
    OK
}

unsafe extern "system" fn component_get_bus_count(
    _this: *mut c_void,
    media: i32,
    _dir: i32,
) -> i32 {
    Component::bus_count(media)
}

unsafe extern "system" fn component_get_bus_info(
    _this: *mut c_void,
    media: i32,
    dir: i32,
    index: i32,
    bus: *mut BusInfo,
) -> TResult {
    unsafe { Component::bus_info(media, dir, index, bus) }
}

unsafe extern "system" fn component_get_routing_info(
    _this: *mut c_void,
    _input: *mut RoutingInfo,
    _output: *mut RoutingInfo,
) -> TResult {
    NOT_IMPLEMENTED
}

unsafe extern "system" fn component_activate_bus(
    _this: *mut c_void,
    media: i32,
    _dir: i32,
    index: i32,
    _state: TBool,
) -> TResult {
    if media == MEDIA_AUDIO && index == 0 {
        OK
    } else {
        INVALID_ARGUMENT
    }
}

unsafe extern "system" fn component_set_active(_this: *mut c_void, _state: TBool) -> TResult {
    OK
}

unsafe extern "system" fn component_set_state(this_: *mut c_void, stream: *mut c_void) -> TResult {
    unsafe { this::<COMPONENT>(this_).set_state(stream) }
}

unsafe extern "system" fn component_get_state(this_: *mut c_void, stream: *mut c_void) -> TResult {
    unsafe { this::<COMPONENT>(this_).get_state(stream) }
}

static PROCESSOR_VTBL: IAudioProcessorVtbl = IAudioProcessorVtbl {
    unknown: unknown::<PROCESSOR>(),
    set_bus_arrangements: processor_set_bus_arrangements,
    get_bus_arrangement: processor_get_bus_arrangement,
    can_process_sample_size: processor_can_process_sample_size,
    get_latency_samples: processor_zero_samples,
    setup_processing: processor_setup_processing,
    set_processing: processor_set_processing,
    process: processor_process,
    get_tail_samples: processor_zero_samples,
};

unsafe extern "system" fn processor_set_bus_arrangements(
    _this: *mut c_void,
    inputs: *mut SpeakerArrangement,
    num_inputs: i32,
    outputs: *mut SpeakerArrangement,
    num_outputs: i32,
) -> TResult {
    let stereo = |arrangements: *mut SpeakerArrangement, count: i32| {
        count == 1 && unsafe { arrangements.as_ref() } == Some(&STEREO)
    };
    if stereo(inputs, num_inputs) && stereo(outputs, num_outputs) {
        OK
    } else {
        FALSE
    }
}

unsafe extern "system" fn processor_get_bus_arrangement(
    _this: *mut c_void,
    dir: i32,
    index: i32,
    arrangement: *mut SpeakerArrangement,
) -> TResult {
    if arrangement.is_null() || index != 0 || !matches!(dir, DIRECTION_INPUT | DIRECTION_OUTPUT) {
        return INVALID_ARGUMENT;
    }
    unsafe { *arrangement = STEREO };
    OK
}

unsafe extern "system" fn processor_can_process_sample_size(
    _this: *mut c_void,
    size: i32,
) -> TResult {
    if size == SAMPLE_32 { OK } else { FALSE }
}

unsafe extern "system" fn processor_zero_samples(_this: *mut c_void) -> u32 {
    0
}

unsafe extern "system" fn processor_setup_processing(
    this_: *mut c_void,
    setup: *mut ProcessSetup,
) -> TResult {
    match unsafe { setup.as_ref() } {
        Some(setup) if setup.symbolic_sample_size == SAMPLE_32 => {
            let component = unsafe { this::<PROCESSOR>(this_) };
            component
                .sample_rate
                .store(setup.sample_rate.to_bits(), Ordering::Relaxed);
            OK
        }
        Some(_) => FALSE,
        None => INVALID_ARGUMENT,
    }
}

unsafe extern "system" fn processor_set_processing(_this: *mut c_void, _state: TBool) -> TResult {
    OK
}

unsafe extern "system" fn processor_process(this_: *mut c_void, data: *mut ProcessData) -> TResult {
    unsafe { this::<PROCESSOR>(this_).process(data) }
}

static REQUIREMENTS_VTBL: IProcessContextRequirementsVtbl = IProcessContextRequirementsVtbl {
    unknown: unknown::<REQUIREMENTS>(),
    get_process_context_requirements: requirements_get,
};

unsafe extern "system" fn requirements_get(_this: *mut c_void) -> u32 {
    requirements::SYSTEM_TIME
        | requirements::PROJECT_TIME_MUSIC
        | requirements::CYCLE_MUSIC
        | requirements::TEMPO
        | requirements::TIME_SIGNATURE
        | requirements::TRANSPORT_STATE
}

static CONTROLLER_VTBL: IEditControllerVtbl = IEditControllerVtbl {
    unknown: unknown::<CONTROLLER>(),
    initialize: initialize::<CONTROLLER>,
    terminate: terminate::<CONTROLLER>,
    set_component_state: controller_ignore_stream,
    set_state: controller_ignore_stream,
    get_state: controller_ignore_stream,
    get_parameter_count: controller_get_parameter_count,
    get_parameter_info: controller_get_parameter_info,
    get_param_string_by_value: controller_get_param_string_by_value,
    get_param_value_by_string: controller_get_param_value_by_string,
    normalized_param_to_plain: controller_convert_param,
    plain_param_to_normalized: controller_convert_param,
    get_param_normalized: controller_get_param_normalized,
    set_param_normalized: controller_set_param_normalized,
    set_component_handler: controller_set_component_handler,
    create_view: controller_create_view,
};

/// The controller shares the component's state and has none of its own.
unsafe extern "system" fn controller_ignore_stream(
    _this: *mut c_void,
    _stream: *mut c_void,
) -> TResult {
    OK
}

unsafe extern "system" fn controller_get_parameter_count(_this: *mut c_void) -> i32 {
    0
}

unsafe extern "system" fn controller_get_parameter_info(
    _this: *mut c_void,
    _index: i32,
    _info: *mut c_void,
) -> TResult {
    INVALID_ARGUMENT
}

unsafe extern "system" fn controller_get_param_string_by_value(
    _this: *mut c_void,
    _id: u32,
    _value: f64,
    _string: *mut u16,
) -> TResult {
    INVALID_ARGUMENT
}

unsafe extern "system" fn controller_get_param_value_by_string(
    _this: *mut c_void,
    _id: u32,
    _string: *mut u16,
    _value: *mut f64,
) -> TResult {
    INVALID_ARGUMENT
}

unsafe extern "system" fn controller_convert_param(
    _this: *mut c_void,
    _id: u32,
    value: f64,
) -> f64 {
    value
}

unsafe extern "system" fn controller_get_param_normalized(_this: *mut c_void, _id: u32) -> f64 {
    0.0
}

unsafe extern "system" fn controller_set_param_normalized(
    _this: *mut c_void,
    _id: u32,
    _value: f64,
) -> TResult {
    INVALID_ARGUMENT
}

unsafe extern "system" fn controller_set_component_handler(
    this_: *mut c_void,
    handler: *mut c_void,
) -> TResult {
    unsafe { this::<CONTROLLER>(this_).set_component_handler(handler) }
}

unsafe extern "system" fn controller_create_view(
    this_: *mut c_void,
    name: FIDString,
) -> *mut c_void {
    if unsafe { fid_eq(name, VIEW_EDITOR) } {
        View::create(unsafe { this::<CONTROLLER>(this_) }.backend()).cast()
    } else {
        ptr::null_mut()
    }
}

/// Reads a host `IBStream` to its end, or `None` for a null stream or one
/// larger than [`MAX_STATE_BYTES`].
unsafe fn read_stream(stream: *mut c_void) -> Option<Vec<u8>> {
    if stream.is_null() {
        return None;
    }
    let read = unsafe { vtbl::<IBStreamVtbl>(stream) }.read;
    let mut bytes = Vec::new();
    let mut chunk = vec![0u8; STREAM_CHUNK];
    loop {
        let mut count = 0;
        let result = unsafe {
            read(
                stream,
                chunk.as_mut_ptr().cast(),
                STREAM_CHUNK as i32,
                &mut count,
            )
        };
        let count = usize::try_from(count).unwrap_or(0).min(STREAM_CHUNK);
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() > MAX_STATE_BYTES {
            return None;
        }
        if result != OK || count == 0 {
            return Some(bytes);
        }
    }
}

/// Writes all of `bytes` to a host `IBStream`.
unsafe fn write_stream(stream: *mut c_void, mut bytes: &[u8]) -> bool {
    if stream.is_null() {
        return false;
    }
    let write = unsafe { vtbl::<IBStreamVtbl>(stream) }.write;
    while !bytes.is_empty() {
        let len = bytes.len().min(STREAM_CHUNK);
        let mut written = 0;
        let result = unsafe {
            write(
                stream,
                bytes.as_ptr().cast_mut().cast(),
                len as i32,
                &mut written,
            )
        };
        let written = usize::try_from(written).unwrap_or(0).min(len);
        if result != OK || written == 0 {
            return false;
        }
        bytes = &bytes[written..];
    }
    true
}

#[cfg(test)]
mod tests;
