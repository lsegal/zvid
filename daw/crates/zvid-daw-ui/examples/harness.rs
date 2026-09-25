//! Runs the plugin editor in a plain window against the mock backend, so UI
//! work doesn't need a DAW.
//!
//! ```console
//! cargo run -p zvid-daw-ui --example harness                 # embedded UI (build daw/ui first)
//! cargo run -p zvid-daw-ui --example harness -- --dev        # Vite HMR at http://localhost:5174
//! cargo run -p zvid-daw-ui --example harness -- --instances 2 --reopen-every 5
//! ```
//!
//! - `--dev [URL]` loads the UI from a dev server (`pnpm --dir daw/ui dev`).
//! - `--instances N` opens N editors, each with its own backend, like N
//!   plugin instances.
//! - `--reopen-every SECS` tears every editor down and re-attaches it on a
//!   timer, like a host closing and reopening the plugin window.
//! - `--manual-transport` stops the simulated transport; by default it plays
//!   for 4 s and stops for 2 s while a capture is armed.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tao::dpi::{LogicalSize, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::{Window, WindowBuilder, WindowId};
use zvid_daw_core::{RecordRoot, State};
use zvid_daw_ui::mock::MockBackend;
use zvid_daw_ui::{DEFAULT_SIZE, Editor, EditorOptions, MIN_SIZE, ParentWindow};

const DEFAULT_DEV_URL: &str = "http://localhost:5174/";
const DEMO_CLIP: &str = "demo-take.mp4";

struct Options {
    dev_url: Option<String>,
    instances: usize,
    reopen_every: Option<Duration>,
    auto_transport: bool,
}

fn parse_args() -> Options {
    let mut options = Options {
        dev_url: None,
        instances: 1,
        reopen_every: None,
        auto_transport: true,
    };
    let mut args = std::env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dev" => {
                let url = args
                    .next_if(|next| !next.starts_with("--"))
                    .unwrap_or_else(|| DEFAULT_DEV_URL.to_string());
                options.dev_url = Some(url);
            }
            "--instances" => {
                options.instances = args
                    .next()
                    .and_then(|count| count.parse().ok())
                    .filter(|&count| count > 0)
                    .expect("--instances needs a positive number");
            }
            "--reopen-every" => {
                let secs: f64 = args
                    .next()
                    .and_then(|secs| secs.parse().ok())
                    .expect("--reopen-every needs seconds");
                options.reopen_every = Some(Duration::from_secs_f64(secs));
            }
            "--manual-transport" => options.auto_transport = false,
            other => panic!("unknown argument {other}; see the example's docs"),
        }
    }
    options
}

/// A record root with a demo clip and two saved takes, as in the wireframe.
fn demo_root() -> (RecordRoot, State) {
    let dir = std::env::temp_dir().join("zvid-daw-ui-harness");
    let root = RecordRoot::resolve_with(Some(&dir), None).expect("a record root");
    std::fs::create_dir_all(&root.dir).expect("the record root is writable");
    let clip = root.path_of(DEMO_CLIP);
    if !clip.is_file() {
        eprintln!("writing {} ...", clip.display());
        zvid_daw_ui::poster::write_test_clip(&clip, 320, 180, 60, 30)
            .expect("the demo clip encodes");
    }
    let take = |id: &str, file: &str, created: &str, duration: f64, beats: Option<f64>| {
        serde_json::json!({
            "id": id,
            "filename": file,
            "dimensions": [1920, 1080],
            "fps": [30, 1],
            "frameStart": 0,
            "fileOffsetSec": 0.5,
            "transportStartSec": beats.map(|beats| beats / 2.0),
            "transportStartBeats": beats,
            "durationSec": duration,
            "tempo": beats.map(|_| 120.0),
            "timeSignature": beats.map(|_| [4, 4]),
            "camera": "FaceTime HD Camera",
            "createdAt": created,
        })
    };
    let state = serde_json::json!({
        "version": "1",
        "plugin": "zvid-capture",
        "recordRoot": "project",
        "recordings": [
            take("demo-3", "moved-away.mp4", "2026-09-24T18:02:00Z", 12.0, None),
            take("demo-2", DEMO_CLIP, "2026-09-25T20:31:00Z", 72.0, Some(0.0)),
            take("demo-1", DEMO_CLIP, "2026-09-25T20:36:00Z", 36.0, Some(64.0)),
        ],
    });
    let state = serde_json::from_value(state).expect("the demo state parses");
    (root, state)
}

struct Instance {
    window: Window,
    backend: Arc<MockBackend>,
    editor: Option<Editor>,
}

impl Instance {
    fn attach(&mut self, dev_url: Option<String>) {
        let parent = match self
            .window
            .window_handle()
            .expect("the window has a handle")
            .as_raw()
        {
            RawWindowHandle::Win32(handle) => ParentWindow::Win32(handle.hwnd),
            RawWindowHandle::AppKit(handle) => ParentWindow::AppKit(handle.ns_view),
            other => panic!("the harness can't host a webview in {other:?}"),
        };
        let scale = self.window.scale_factor();
        let size: LogicalSize<f64> = self.window.inner_size().to_logical(scale);
        let options = EditorOptions {
            dev_url,
            devtools: true,
            ..EditorOptions::default()
        };
        // SAFETY: the window outlives the editor (it is dropped first in
        // `detach` and when the instance goes) and this runs on the UI thread.
        let editor = unsafe {
            Editor::attach(
                parent,
                zvid_daw_ui::dpi::LogicalSize::new(size.width, size.height),
                scale,
                self.backend.clone(),
                options,
            )
        }
        .expect("the editor attaches");
        self.editor = Some(editor);
    }

    fn resize(&self, size: PhysicalSize<u32>) {
        if let Some(editor) = &self.editor {
            let logical: LogicalSize<f64> = size.to_logical(self.window.scale_factor());
            let _ = editor.set_size(zvid_daw_ui::dpi::LogicalSize::new(
                logical.width,
                logical.height,
            ));
        }
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.editor = None;
    }
}

fn main() {
    let options = parse_args();
    let event_loop = EventLoop::new();
    let (root, state) = demo_root();
    let running = Arc::new(AtomicBool::new(true));

    let mut instances: Vec<Instance> = (0..options.instances)
        .map(|index| {
            let window = WindowBuilder::new()
                .with_title(format!("ZVID Capture (harness {})", index + 1))
                .with_inner_size(LogicalSize::new(DEFAULT_SIZE.width, DEFAULT_SIZE.height))
                .with_min_inner_size(LogicalSize::new(MIN_SIZE.width, MIN_SIZE.height))
                .build(&event_loop)
                .expect("the window opens");
            let backend = Arc::new(MockBackend::new(
                root.clone(),
                state.clone(),
                Some(DEMO_CLIP.to_string()),
            ));
            spawn_simulation(backend.clone(), running.clone(), options.auto_transport);
            let mut instance = Instance {
                window,
                backend,
                editor: None,
            };
            instance.attach(options.dev_url.clone());
            instance
        })
        .collect();

    let dev_url = options.dev_url.clone();
    let reopen_every = options.reopen_every;
    let mut next_reopen = reopen_every.map(|every| Instant::now() + every);
    event_loop.run(move |event, _, control_flow| {
        *control_flow = match next_reopen {
            Some(at) => ControlFlow::WaitUntil(at),
            None => ControlFlow::Wait,
        };
        match event {
            Event::WindowEvent {
                window_id, event, ..
            } => {
                let Some(position) = find(&instances, window_id) else {
                    return;
                };
                match event {
                    WindowEvent::Resized(size) => instances[position].resize(size),
                    WindowEvent::ScaleFactorChanged {
                        scale_factor,
                        new_inner_size,
                    } => {
                        if let Some(editor) = &instances[position].editor {
                            let _ = editor.set_scale_factor(scale_factor);
                        }
                        instances[position].resize(*new_inner_size);
                    }
                    WindowEvent::CloseRequested => {
                        instances.remove(position);
                        if instances.is_empty() {
                            running.store(false, Ordering::Release);
                            *control_flow = ControlFlow::Exit;
                        }
                    }
                    _ => {}
                }
            }
            Event::NewEvents(_) if next_reopen.is_some_and(|at| Instant::now() >= at) => {
                for instance in &mut instances {
                    instance.editor = None;
                    instance.attach(dev_url.clone());
                }
                eprintln!("reopened {} editor(s)", instances.len());
                next_reopen = reopen_every.map(|every| Instant::now() + every);
            }
            _ => {}
        }
    });
}

fn find(instances: &[Instance], id: WindowId) -> Option<usize> {
    instances
        .iter()
        .position(|instance| instance.window.id() == id)
}

/// Publishes preview frames at 15 fps and, when `auto_transport` is set,
/// plays the transport for 4 s and stops it for 2 s while armed.
fn spawn_simulation(backend: Arc<MockBackend>, running: Arc<AtomicBool>, auto_transport: bool) {
    std::thread::spawn(move || {
        let mut armed_since: Option<Instant> = None;
        while running.load(Ordering::Acquire) {
            backend.publish_frame();
            if auto_transport {
                armed_since = match (backend.is_armed(), armed_since) {
                    (true, None) => Some(Instant::now()),
                    (true, since) => since,
                    (false, _) => None,
                };
                if let Some(since) = armed_since {
                    let phase = since.elapsed().as_secs_f64() % 6.0;
                    backend.set_playing((1.0..5.0).contains(&phase));
                }
            }
            std::thread::sleep(Duration::from_millis(66));
        }
    });
}
