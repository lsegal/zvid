//! Drives the component through its vtables the way a host does.

use std::ffi::CString;

use super::*;
use crate::plugin_factory;

const FIXTURE_JSON: &str = include_str!("../../../../fixtures/state/zvid-capture-v1.json");
const FIXTURE_HEX: &str = include_str!("../../../../fixtures/state/zvid-capture-v1.hex");

/// Interface pointers a host holds for one component.
struct Host {
    component: *mut c_void,
    processor: *mut c_void,
    controller: *mut c_void,
}

impl Host {
    fn new() -> Self {
        unsafe {
            let factory = plugin_factory();
            let factory_vtbl = vtbl::<IPluginFactory2Vtbl>(factory);
            let mut component = ptr::null_mut();
            assert_eq!(
                (factory_vtbl.create_instance)(
                    factory,
                    CLASS_ID.as_ptr().cast(),
                    ICOMPONENT_IID.as_ptr().cast(),
                    &mut component,
                ),
                OK
            );
            let processor = query(component, &IAUDIO_PROCESSOR_IID).unwrap();
            let controller = query(component, &IEDIT_CONTROLLER_IID).unwrap();
            Self {
                component,
                processor,
                controller,
            }
        }
    }

    fn object(&self) -> &Component {
        unsafe { this::<COMPONENT>(self.component) }
    }

    fn component(&self) -> &IComponentVtbl {
        unsafe { vtbl(self.component) }
    }

    fn processor(&self) -> &IAudioProcessorVtbl {
        unsafe { vtbl(self.processor) }
    }

    fn controller(&self) -> &IEditControllerVtbl {
        unsafe { vtbl(self.controller) }
    }

    fn refs(&self) -> u32 {
        self.object().refs.load(Ordering::Relaxed)
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        unsafe {
            release_interface(self.controller);
            release_interface(self.processor);
            assert_eq!(release_interface(self.component), 0);
        }
    }
}

unsafe fn query(object: *mut c_void, iid: &Tuid) -> Option<*mut c_void> {
    let mut out = ptr::null_mut();
    let result = unsafe { (vtbl::<FUnknownVtbl>(object).query_interface)(object, iid, &mut out) };
    (result == OK).then_some(out)
}

unsafe fn release_interface(object: *mut c_void) -> u32 {
    unsafe { (vtbl::<FUnknownVtbl>(object).release)(object) }
}

/// In-memory `IBStream` that reads and writes at most `chunk` bytes per
/// call, like hosts that hand out data in pieces.
#[repr(C)]
struct MemoryStream {
    vtbl: &'static IBStreamVtbl,
    data: Vec<u8>,
    position: usize,
    chunk: usize,
}

impl MemoryStream {
    fn new(data: &[u8], chunk: usize) -> Self {
        Self {
            vtbl: &STREAM_VTBL,
            data: data.to_vec(),
            position: 0,
            chunk,
        }
    }

    fn as_ptr(&mut self) -> *mut c_void {
        ptr::from_mut(self).cast()
    }
}

static STREAM_VTBL: IBStreamVtbl = IBStreamVtbl {
    unknown: FUnknownVtbl {
        query_interface: stream_query_interface,
        add_ref: stream_ref,
        release: stream_ref,
    },
    read: stream_read,
    write: stream_write,
    seek: stream_seek,
    tell: stream_tell,
};

unsafe extern "system" fn stream_query_interface(
    _this: *mut c_void,
    _iid: *const Tuid,
    _obj: *mut *mut c_void,
) -> TResult {
    NO_INTERFACE
}

unsafe extern "system" fn stream_ref(_this: *mut c_void) -> u32 {
    1
}

unsafe extern "system" fn stream_read(
    this_: *mut c_void,
    buffer: *mut c_void,
    num_bytes: i32,
    num_bytes_read: *mut i32,
) -> TResult {
    let stream = unsafe { &mut *this_.cast::<MemoryStream>() };
    let count = (num_bytes as usize)
        .min(stream.chunk)
        .min(stream.data.len() - stream.position);
    unsafe {
        ptr::copy_nonoverlapping(
            stream.data[stream.position..].as_ptr(),
            buffer.cast(),
            count,
        );
        *num_bytes_read = count as i32;
    }
    stream.position += count;
    OK
}

unsafe extern "system" fn stream_write(
    this_: *mut c_void,
    buffer: *mut c_void,
    num_bytes: i32,
    num_bytes_written: *mut i32,
) -> TResult {
    let stream = unsafe { &mut *this_.cast::<MemoryStream>() };
    let count = (num_bytes as usize).min(stream.chunk);
    let bytes = unsafe { std::slice::from_raw_parts(buffer.cast::<u8>(), count) };
    stream.data.extend_from_slice(bytes);
    unsafe { *num_bytes_written = count as i32 };
    OK
}

unsafe extern "system" fn stream_seek(
    _this: *mut c_void,
    _pos: i64,
    _mode: i32,
    _result: *mut i64,
) -> TResult {
    NOT_IMPLEMENTED
}

unsafe extern "system" fn stream_tell(this_: *mut c_void, pos: *mut i64) -> TResult {
    unsafe { *pos = (*this_.cast::<MemoryStream>()).position as i64 };
    OK
}

#[test]
fn factory_describes_one_audio_effect() {
    unsafe {
        let factory = plugin_factory();
        let v = vtbl::<IPluginFactory2Vtbl>(factory);
        assert_eq!(query(factory, &IPLUGIN_FACTORY_IID), Some(factory));
        assert_eq!(query(factory, &IPLUGIN_FACTORY2_IID), Some(factory));
        assert_eq!(query(factory, &ICOMPONENT_IID), None);

        let mut info: PFactoryInfo = std::mem::zeroed();
        assert_eq!((v.get_factory_info)(factory, &mut info), OK);
        assert_eq!(cstr(&info.vendor), "ZVID");
        assert_eq!(info.flags, FACTORY_FLAG_UNICODE);

        assert_eq!((v.count_classes)(factory), 1);
        let mut class: PClassInfo2 = std::mem::zeroed();
        assert_eq!((v.get_class_info2)(factory, 0, &mut class), OK);
        assert_eq!(class.cid, CLASS_ID);
        assert_eq!(class.cardinality, MANY_INSTANCES);
        assert_eq!(cstr(&class.category), "Audio Module Class");
        assert_eq!(cstr(&class.name), "ZVID Capture");
        assert_eq!(cstr(&class.sub_categories), "Fx|Tools");
        assert_eq!(cstr(&class.vendor), "ZVID");
        assert_eq!(
            (v.get_class_info2)(factory, 1, &mut class),
            INVALID_ARGUMENT
        );
        let mut basic: PClassInfo = std::mem::zeroed();
        assert_eq!((v.get_class_info)(factory, 0, &mut basic), OK);
        assert_eq!(basic.cid, CLASS_ID);
        assert_eq!(cstr(&basic.name), "ZVID Capture");

        let mut obj = ptr::null_mut();
        let other = [0u8; 16];
        assert_eq!(
            (v.create_instance)(
                factory,
                other.as_ptr().cast(),
                ICOMPONENT_IID.as_ptr().cast(),
                &mut obj
            ),
            NO_INTERFACE
        );
        assert!(obj.is_null());
        assert_eq!(
            (v.create_instance)(
                factory,
                CLASS_ID.as_ptr().cast(),
                IPLUG_VIEW_IID.as_ptr().cast(),
                &mut obj
            ),
            NO_INTERFACE
        );
        assert!(obj.is_null());
        // The controller can be created directly, as the controller CID is
        // the component CID.
        assert_eq!(
            (v.create_instance)(
                factory,
                CLASS_ID.as_ptr().cast(),
                IEDIT_CONTROLLER_IID.as_ptr().cast(),
                &mut obj
            ),
            OK
        );
        assert_eq!(release_interface(obj), 0);
    }
}

fn cstr(field: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = field
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    String::from_utf8(bytes).unwrap()
}

#[test]
fn answers_the_documented_interfaces_on_one_object() {
    let host = Host::new();
    assert_eq!(host.refs(), 3);
    unsafe {
        for (iid, expected) in [
            (FUNKNOWN_IID, host.component),
            (IPLUGIN_BASE_IID, host.component),
            (ICOMPONENT_IID, host.component),
            (IAUDIO_PROCESSOR_IID, host.processor),
            (IEDIT_CONTROLLER_IID, host.controller),
        ] {
            // Every interface reaches every other one.
            for from in [host.component, host.processor, host.controller] {
                assert_eq!(query(from, &iid), Some(expected));
                release_interface(expected);
            }
        }
        let requirements = query(host.processor, &IPROCESS_CONTEXT_REQUIREMENTS_IID).unwrap();
        let flags = (vtbl::<IProcessContextRequirementsVtbl>(requirements)
            .get_process_context_requirements)(requirements);
        assert_ne!(flags & requirements::TRANSPORT_STATE, 0);
        assert_ne!(flags & requirements::TEMPO, 0);
        release_interface(requirements);

        for missing in [ICONNECTION_POINT_IID, IPLUG_VIEW_IID, IPLUGIN_FACTORY_IID] {
            let mut out = ptr::null_mut::<c_void>().wrapping_add(1);
            let result =
                (host.component().unknown.query_interface)(host.component, &missing, &mut out);
            assert_eq!(result, NO_INTERFACE);
            assert!(out.is_null());
        }
        assert_eq!(host.refs(), 3);
        assert_eq!((host.component().unknown.add_ref)(host.component), 4);
        // Any interface pointer releases the shared count.
        assert_eq!(release_interface(host.processor), 3);

        let mut controller_id = [0u8; 16];
        assert_eq!(
            (host.component().get_controller_class_id)(host.component, &mut controller_id),
            OK
        );
        assert_eq!(controller_id, CLASS_ID);
    }
}

#[test]
fn reports_one_stereo_main_bus_each_way() {
    let host = Host::new();
    let component = host.component();
    let processor = host.processor();
    unsafe {
        for dir in [DIRECTION_INPUT, DIRECTION_OUTPUT] {
            assert_eq!(
                (component.get_bus_count)(host.component, MEDIA_AUDIO, dir),
                1
            );
            assert_eq!((component.get_bus_count)(host.component, 1, dir), 0);
            let mut bus: BusInfo = std::mem::zeroed();
            assert_eq!(
                (component.get_bus_info)(host.component, MEDIA_AUDIO, dir, 0, &mut bus),
                OK
            );
            assert_eq!(bus.direction, dir);
            assert_eq!(bus.channel_count, 2);
            assert_eq!(bus.bus_type, BUS_MAIN);
            assert_eq!(bus.flags, BUS_DEFAULT_ACTIVE);
            assert_eq!(
                (component.get_bus_info)(host.component, MEDIA_AUDIO, dir, 1, &mut bus),
                INVALID_ARGUMENT
            );
            let mut arrangement = 0;
            assert_eq!(
                (processor.get_bus_arrangement)(host.processor, dir, 0, &mut arrangement),
                OK
            );
            assert_eq!(arrangement, STEREO);
        }
        let (mut stereo_in, mut stereo_out, mut mono) = (STEREO, STEREO, 0b1);
        assert_eq!(
            (processor.set_bus_arrangements)(host.processor, &mut stereo_in, 1, &mut stereo_out, 1),
            OK
        );
        assert_eq!(
            (processor.set_bus_arrangements)(host.processor, &mut mono, 1, &mut stereo_out, 1),
            FALSE
        );
        assert_eq!(
            (processor.can_process_sample_size)(host.processor, SAMPLE_32),
            OK
        );
        assert_eq!(
            (processor.can_process_sample_size)(host.processor, 1),
            FALSE
        );
        assert_eq!((processor.get_latency_samples)(host.processor), 0);
        assert_eq!((processor.get_tail_samples)(host.processor), 0);
        let mut setup = ProcessSetup {
            process_mode: 0,
            symbolic_sample_size: SAMPLE_32,
            max_samples_per_block: 512,
            sample_rate: 48_000.0,
        };
        assert_eq!((processor.setup_processing)(host.processor, &mut setup), OK);
        assert_eq!((component.set_active)(host.component, 1), OK);
        assert_eq!((processor.set_processing)(host.processor, 1), OK);
    }
}

/// Owns the channel pointer arrays a host passes in `AudioBusBuffers`.
struct Bus {
    channels: Vec<*mut c_void>,
}

impl Bus {
    fn new(channels: &mut [Vec<f32>]) -> Self {
        Self {
            channels: channels
                .iter_mut()
                .map(|channel| channel.as_mut_ptr().cast())
                .collect(),
        }
    }

    fn buffers(&mut self, silence_flags: u64) -> AudioBusBuffers {
        AudioBusBuffers {
            num_channels: self.channels.len() as i32,
            silence_flags,
            channel_buffers: self.channels.as_mut_ptr(),
        }
    }
}

fn process(
    host: &Host,
    inputs: Option<&mut AudioBusBuffers>,
    outputs: &mut AudioBusBuffers,
    frames: i32,
    context: Option<&mut ProcessContext>,
) -> TResult {
    let (num_inputs, inputs) = match inputs {
        Some(bus) => (1, ptr::from_mut(bus)),
        None => (0, ptr::null_mut()),
    };
    let mut data = ProcessData {
        process_mode: 0,
        symbolic_sample_size: SAMPLE_32,
        num_samples: frames,
        num_inputs,
        num_outputs: 1,
        inputs,
        outputs: ptr::from_mut(outputs),
        input_parameter_changes: ptr::null_mut(),
        output_parameter_changes: ptr::null_mut(),
        input_events: ptr::null_mut(),
        output_events: ptr::null_mut(),
        process_context: context.map_or(ptr::null_mut(), ptr::from_mut),
    };
    unsafe { (host.processor().process)(host.processor, &mut data) }
}

#[test]
fn passes_audio_through_unchanged() {
    let host = Host::new();
    let mut input_samples = vec![vec![0.25f32, -0.5, 0.75, 1.0], vec![-1.0, 0.5, 0.0, 0.125]];
    let mut output_samples = vec![vec![9.0f32; 4], vec![9.0; 4]];
    let mut input = Bus::new(&mut input_samples);
    let mut output = Bus::new(&mut output_samples);
    let mut input_buffers = input.buffers(0b10);
    let mut output_buffers = output.buffers(0);
    assert_eq!(
        process(
            &host,
            Some(&mut input_buffers),
            &mut output_buffers,
            4,
            None
        ),
        OK
    );
    assert_eq!(output_samples, input_samples);
    assert_eq!(output_buffers.silence_flags, 0b10);

    // In place: input and output share buffers.
    let mut shared = Bus::new(&mut input_samples);
    let mut in_place_in = shared.buffers(0);
    let mut in_place_out = shared.buffers(0);
    assert_eq!(
        process(&host, Some(&mut in_place_in), &mut in_place_out, 4, None),
        OK
    );
    assert_eq!(input_samples[0], [0.25, -0.5, 0.75, 1.0]);

    // No input bus: the output is silenced.
    let mut output_buffers = output.buffers(0);
    assert_eq!(process(&host, None, &mut output_buffers, 4, None), OK);
    assert_eq!(output_samples, vec![vec![0.0f32; 4]; 2]);
    assert_eq!(output_buffers.silence_flags, 0b11);

    // A parameter flush with no samples leaves buffers alone.
    let mut output_buffers = output.buffers(0);
    assert_eq!(process(&host, None, &mut output_buffers, 0, None), OK);
}

#[test]
fn taps_input_audio_once_taken() {
    let host = Host::new();
    let mut setup = ProcessSetup {
        process_mode: 0,
        symbolic_sample_size: SAMPLE_32,
        max_samples_per_block: 512,
        sample_rate: 48_000.0,
    };
    assert_eq!(
        unsafe { (host.processor().setup_processing)(host.processor, &mut setup) },
        OK
    );
    let mut input_samples = vec![vec![0.1f32, 0.2, 0.3]];
    let mut output_samples = vec![vec![0.0f32; 3], vec![0.0; 3]];
    let mut input = Bus::new(&mut input_samples);
    let mut output = Bus::new(&mut output_samples);
    let mut input_buffers = input.buffers(0);
    let mut output_buffers = output.buffers(0);

    process(
        &host,
        Some(&mut input_buffers),
        &mut output_buffers,
        3,
        None,
    );
    let mut tap = host.object().take_audio_tap().unwrap();
    assert!(host.object().take_audio_tap().is_none());
    assert_eq!(tap.pop(), None, "nothing is tapped before the tap is taken");

    let before = clock::now_sec();
    process(
        &host,
        Some(&mut input_buffers),
        &mut output_buffers,
        3,
        None,
    );
    let after = clock::now_sec();
    let block = tap.pop().unwrap();
    // Mono input is duplicated to both sides.
    assert_eq!(block.samples, [0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
    // Without a process context, the rate comes from `setupProcessing`.
    assert_eq!(block.sample_rate, 48_000.0);
    assert!((before..=after).contains(&block.host_time));

    // With one, the block has the context's rate and the snapshot's time.
    let mut context = ProcessContext {
        sample_rate: 44_100.0,
        ..ProcessContext::default()
    };
    process(
        &host,
        Some(&mut input_buffers),
        &mut output_buffers,
        3,
        Some(&mut context),
    );
    let block = tap.pop().unwrap();
    assert_eq!(block.sample_rate, 44_100.0);
    assert_eq!(tap.sample_rate(), Some(44_100.0));
    let snapshot = lock(&host.object().lifecycle)
        .inputs
        .as_mut()
        .unwrap()
        .transport
        .pop()
        .unwrap();
    assert_eq!(block.host_time, snapshot.host_time);
    assert_eq!(tap.pop(), None);
    // The missing right input channel is silenced on output.
    assert_eq!(output_samples[1], [0.0; 3]);
    assert_eq!(output_buffers.silence_flags, 0b10);
}

#[test]
fn pushes_a_transport_snapshot_per_block() {
    let host = Host::new();
    let mut output_samples = vec![vec![0.0f32; 8]; 2];
    let mut output = Bus::new(&mut output_samples);
    let mut output_buffers = output.buffers(0);
    let mut context = ProcessContext {
        state: context::PLAYING | context::RECORDING | context::TEMPO_VALID,
        sample_rate: 48_000.0,
        project_time_samples: 4_800,
        tempo: 128.0,
        ..ProcessContext::default()
    };
    process(&host, None, &mut output_buffers, 8, Some(&mut context));
    process(&host, None, &mut output_buffers, 8, None);
    context.project_time_samples += 8;
    process(&host, None, &mut output_buffers, 8, Some(&mut context));

    let snapshots: Vec<ProcessSnapshot> = lock(&host.object().lifecycle)
        .inputs
        .as_mut()
        .unwrap()
        .transport
        .drain()
        .collect();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0].block, 1);
    assert_eq!(snapshots[1].block, 3);
    assert!(snapshots[0].playing && snapshots[0].recording);
    assert_eq!(snapshots[0].song_sec(), 0.1);
    assert_eq!(snapshots[1].project_time_samples, 4_808);
    assert_eq!(snapshots[1].tempo, 128.0);
    assert_eq!(snapshots[0].num_samples, 8);
    assert!(snapshots[1].host_time >= snapshots[0].host_time);
}

#[test]
fn control_thread_follows_initialize_and_terminate() {
    let host = Host::new();
    let component = host.component();
    let controller = host.controller();
    unsafe {
        assert_eq!((component.initialize)(host.component, ptr::null_mut()), OK);
        assert!(lock(&host.object().lifecycle).control.is_some());
        // The controller side may be initialized too; it is the same object.
        assert_eq!(
            (controller.initialize)(host.controller, ptr::null_mut()),
            OK
        );
        assert_eq!((controller.terminate)(host.controller), OK);
        assert!(lock(&host.object().lifecycle).control.is_some());

        let mut output_samples = vec![vec![0.0f32; 4]; 2];
        let mut output = Bus::new(&mut output_samples);
        let mut output_buffers = output.buffers(0);
        let mut context = ProcessContext {
            state: context::PLAYING,
            sample_rate: 48_000.0,
            ..ProcessContext::default()
        };
        process(&host, None, &mut output_buffers, 4, Some(&mut context));

        assert_eq!((component.terminate)(host.component), OK);
        let mut lifecycle = lock(&host.object().lifecycle);
        assert!(lifecycle.control.is_none());
        // The control thread drained the ring before handing it back.
        let transport = &mut lifecycle.inputs.as_mut().unwrap().transport;
        assert_eq!(transport.pop(), None);
        drop(lifecycle);
        // Extra terminates are harmless, and the thread restarts.
        assert_eq!((component.terminate)(host.component), OK);
        assert_eq!((component.initialize)(host.component, ptr::null_mut()), OK);
        assert!(lock(&host.object().lifecycle).control.is_some());
        assert_eq!((component.terminate)(host.component), OK);
    }
}

#[test]
fn state_round_trips_as_raw_json() {
    let host = Host::new();
    let component = host.component();
    unsafe {
        let mut empty = MemoryStream::new(&[], 7);
        let default = State::default().to_json();
        assert_eq!((component.get_state)(host.component, empty.as_ptr()), OK);
        assert_eq!(empty.data, default.as_bytes());

        let mut saved = MemoryStream::new(FIXTURE_JSON.as_bytes(), 100);
        assert_eq!((component.set_state)(host.component, saved.as_ptr()), OK);
        assert_eq!(
            *host.object().state(),
            State::from_json(FIXTURE_JSON).unwrap()
        );

        let mut written = MemoryStream::new(&[], 100);
        assert_eq!((component.get_state)(host.component, written.as_ptr()), OK);
        // Live hex-encodes these bytes into `<ProcessorState>`; the result is
        // the fixture `/app`'s importer tests decode.
        let hex: String = written
            .data
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect();
        assert_eq!(hex, FIXTURE_HEX.trim());

        // A second instance restores it exactly.
        let other = Host::new();
        let mut reopened = MemoryStream::new(&written.data, 1 << 20);
        assert_eq!(
            (other.component().set_state)(other.component, reopened.as_ptr()),
            OK
        );
        assert_eq!(*other.object().state(), *host.object().state());

        // Unreadable state is rejected and the current state kept.
        let mut garbage = MemoryStream::new(b"not json", 100);
        assert_eq!(
            (component.set_state)(host.component, garbage.as_ptr()),
            FALSE
        );
        let mut not_utf8 = MemoryStream::new(&[0xFF, 0xFE], 100);
        assert_eq!(
            (component.set_state)(host.component, not_utf8.as_ptr()),
            FALSE
        );
        assert_eq!(
            *host.object().state(),
            State::from_json(FIXTURE_JSON).unwrap()
        );
        assert_eq!(
            (component.set_state)(host.component, ptr::null_mut()),
            INVALID_ARGUMENT
        );

        // The controller keeps no state of its own.
        let controller = host.controller();
        let mut controller_state = MemoryStream::new(&[], 100);
        assert_eq!(
            (controller.get_state)(host.controller, controller_state.as_ptr()),
            OK
        );
        assert!(controller_state.data.is_empty());
        assert_eq!(
            (controller.set_component_state)(host.controller, saved.as_ptr()),
            OK
        );
    }
}

#[test]
fn controller_has_no_parameters_and_an_editor_view() {
    let host = Host::new();
    let controller = host.controller();
    unsafe {
        assert_eq!((controller.get_parameter_count)(host.controller), 0);
        let editor = CString::new("editor").unwrap();
        let view = (controller.create_view)(host.controller, editor.as_ptr());
        assert!(!view.is_null());
        assert!(query(view, &IPLUG_VIEW_IID).is_some());
        release_interface(view);
        assert_eq!(release_interface(view), 0);
        let other = CString::new("other").unwrap();
        assert!((controller.create_view)(host.controller, other.as_ptr()).is_null());
        assert!((controller.create_view)(host.controller, ptr::null()).is_null());
    }
}

/// A component handler that counts its references.
#[repr(C)]
struct Handler {
    vtbl: &'static FUnknownVtbl,
    refs: AtomicU32,
}

static HANDLER_VTBL: FUnknownVtbl = FUnknownVtbl {
    query_interface: stream_query_interface,
    add_ref: handler_add_ref,
    release: handler_release,
};

unsafe extern "system" fn handler_add_ref(this_: *mut c_void) -> u32 {
    unsafe { &*this_.cast::<Handler>() }
        .refs
        .fetch_add(1, Ordering::Relaxed)
        + 1
}

unsafe extern "system" fn handler_release(this_: *mut c_void) -> u32 {
    unsafe { &*this_.cast::<Handler>() }
        .refs
        .fetch_sub(1, Ordering::Relaxed)
        - 1
}

#[test]
fn holds_a_reference_to_the_component_handler() {
    let mut first = Handler {
        vtbl: &HANDLER_VTBL,
        refs: AtomicU32::new(1),
    };
    let mut second = Handler {
        vtbl: &HANDLER_VTBL,
        refs: AtomicU32::new(1),
    };
    let first_ptr = ptr::from_mut(&mut first).cast::<c_void>();
    let second_ptr = ptr::from_mut(&mut second).cast::<c_void>();
    {
        let host = Host::new();
        let controller = host.controller();
        unsafe {
            (controller.initialize)(host.controller, ptr::null_mut());
            assert_eq!(
                (controller.set_component_handler)(host.controller, first_ptr),
                OK
            );
            assert_eq!(first.refs.load(Ordering::Relaxed), 2);
            (controller.set_component_handler)(host.controller, second_ptr);
            assert_eq!(first.refs.load(Ordering::Relaxed), 1);
            assert_eq!(second.refs.load(Ordering::Relaxed), 2);
            // terminate drops the handler.
            (controller.terminate)(host.controller);
            assert_eq!(second.refs.load(Ordering::Relaxed), 1);
            (controller.set_component_handler)(host.controller, first_ptr);
        }
    }
    // Destroying the component releases the handler too.
    assert_eq!(first.refs.load(Ordering::Relaxed), 1);
}

/// A host `IComponentHandler2` that counts `setDirty` calls.
#[repr(C)]
struct DirtyHandler {
    vtbl: &'static IComponentHandler2Vtbl,
    dirty: AtomicU32,
}

static DIRTY_HANDLER_VTBL: IComponentHandler2Vtbl = IComponentHandler2Vtbl {
    unknown: FUnknownVtbl {
        query_interface: dirty_handler_query_interface,
        add_ref: stream_ref,
        release: stream_ref,
    },
    set_dirty: dirty_handler_set_dirty,
    request_open_editor: dirty_handler_request_open_editor,
    start_group_edit: dirty_handler_group_edit,
    finish_group_edit: dirty_handler_group_edit,
};

unsafe extern "system" fn dirty_handler_query_interface(
    this_: *mut c_void,
    iid: *const Tuid,
    obj: *mut *mut c_void,
) -> TResult {
    if unsafe { *iid } == ICOMPONENT_HANDLER2_IID {
        unsafe { *obj = this_ };
        OK
    } else {
        NO_INTERFACE
    }
}

unsafe extern "system" fn dirty_handler_set_dirty(this_: *mut c_void, state: TBool) -> TResult {
    assert_eq!(state, 1);
    unsafe { &*this_.cast::<DirtyHandler>() }
        .dirty
        .fetch_add(1, Ordering::Relaxed);
    OK
}

unsafe extern "system" fn dirty_handler_request_open_editor(
    _this: *mut c_void,
    _name: FIDString,
) -> TResult {
    NOT_IMPLEMENTED
}

unsafe extern "system" fn dirty_handler_group_edit(_this: *mut c_void) -> TResult {
    NOT_IMPLEMENTED
}

/// Waits for the control thread to catch up with `done`.
fn wait_for(mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(Instant::now() < deadline, "timed out");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn play_spans_while_armed_become_saved_takes() {
    let mut handler = DirtyHandler {
        vtbl: &DIRTY_HANDLER_VTBL,
        dirty: AtomicU32::new(0),
    };
    let handler_ptr = ptr::from_mut(&mut handler).cast::<c_void>();
    let host = Host::new();
    let component = host.component();
    let mut output_samples = vec![vec![0.0f32; 480]; 2];
    let mut output = Bus::new(&mut output_samples);
    let mut output_buffers = output.buffers(0);
    let mut context = ProcessContext {
        state: context::TEMPO_VALID | context::TIME_SIG_VALID,
        sample_rate: 48_000.0,
        tempo: 120.0,
        time_sig_numerator: 4,
        time_sig_denominator: 4,
        ..ProcessContext::default()
    };
    unsafe {
        assert_eq!((component.initialize)(host.component, ptr::null_mut()), OK);
        (host.controller().set_component_handler)(host.controller, handler_ptr);
    }
    let commands = host.object().commands();
    let takes = host.object().take_changes();
    commands
        .send(Command::Arm {
            capture: zvid_daw_core::Capture {
                filename: "video-01-9-25-20-36-12-0.mp4".to_string(),
                dimensions: [1280, 720],
                fps: [30, 1],
                camera: "Cam".to_string(),
                created_at: "2026-09-25T20:36:12Z".to_string(),
            },
            at: clock::now_sec(),
        })
        .unwrap();
    wait_for(|| lock(&host.object().lifecycle).control.is_some());

    let mut block = |playing: bool, context: &mut ProcessContext| {
        context.state = if playing {
            context.state | context::PLAYING
        } else {
            context.state & !context::PLAYING
        };
        process(&host, None, &mut output_buffers, 480, Some(context));
        if playing {
            context.project_time_samples += 480;
        }
    };
    // Two play spans starting at bar 3 and bar 9 (4 s and 16 s at 120 BPM).
    for start in [192_000, 768_000] {
        context.project_time_samples = start;
        for _ in 0..5 {
            block(true, &mut context);
            thread::sleep(Duration::from_millis(2));
        }
        block(false, &mut context);
    }
    commands
        .send(Command::Disarm {
            at: clock::now_sec(),
        })
        .unwrap();
    wait_for(|| {
        let state = host.object().state();
        state.recordings.len() == 2 && state.recordings.iter().all(|take| take.duration_sec > 0.0)
    });

    let mut saved = MemoryStream::new(&[], 7);
    assert_eq!(
        unsafe { (component.get_state)(host.component, saved.as_ptr()) },
        OK
    );
    let state = State::from_json(std::str::from_utf8(&saved.data).unwrap()).unwrap();
    assert_eq!(state.recordings.len(), 2);
    for (take, start_sec) in state.recordings.iter().zip([4.0, 16.0]) {
        assert_eq!(take.filename, "video-01-9-25-20-36-12-0.mp4");
        assert_eq!(take.transport_start_sec, Some(start_sec));
        assert_eq!(take.transport_start_beats, Some(start_sec * 2.0));
        assert_eq!(take.tempo, Some(120.0));
        assert_eq!(take.time_signature, Some([4, 4]));
        assert!(take.file_offset_sec >= 0.0);
        assert!(take.duration_sec > 0.0);
    }
    assert!(state.recordings[1].file_offset_sec > state.recordings[0].file_offset_sec);
    // The host heard about the takes, and so did the editor.
    assert!(handler.dirty.load(Ordering::Relaxed) >= 1);
    let mut changes: Vec<TakeChange> = Vec::new();
    wait_for(|| {
        changes.extend(takes.try_iter());
        changes.len() == 4
    });
    assert!(matches!(changes[0], TakeChange::Opened { index: 0, .. }));
    assert!(matches!(&changes[3], TakeChange::Closed(take) if take.id == state.recordings[1].id));
    unsafe { (component.terminate)(host.component) };
}
