//! Lists cameras, watches hot-plug, or captures frames and logs timestamp jitter.
//!
//! ```text
//! cargo run --example capture -- list
//! cargo run --example capture -- watch [SECONDS]
//! cargo run --example capture -- capture [DEVICE] [SECONDS] [--preview DIR]
//! ```
//!
//! `DEVICE` is an index from `list` or a device ID; it defaults to the first
//! camera. `--preview DIR` also writes each preview JPEG into `DIR`.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zvid_capture::{
    list_devices, permission, supported_formats, CaptureConfig, CaptureError, CaptureSession, Device, DeviceEvent, DeviceWatcher, HostTime,
    JitterStats, PreviewConfig,
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("list") => list(),
        Some("watch") => watch(seconds(args.get(1), 30)),
        Some("capture") => capture(&args[1..]),
        Some(other) => {
            eprintln!("unknown command {other:?}; use list, watch, or capture");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn seconds(arg: Option<&String>, default: u64) -> Duration {
    Duration::from_secs(arg.and_then(|s| s.parse().ok()).unwrap_or(default))
}

fn print_device(index: usize, device: &Device) {
    println!("[{index}] {} ({})\n    id: {}", device.name, device.transport, device.id);
}

fn list() -> Result<(), CaptureError> {
    println!("camera permission: {:?}", permission());
    let devices = list_devices()?;
    if devices.is_empty() {
        println!("no cameras found");
    }
    for (index, device) in devices.iter().enumerate() {
        print_device(index, device);
        match supported_formats(&device.id) {
            Ok(formats) => {
                for format in formats {
                    println!("    {format}");
                }
            }
            Err(error) => println!("    formats unavailable: {error}"),
        }
    }
    Ok(())
}

fn watch(duration: Duration) -> Result<(), CaptureError> {
    let started = Instant::now();
    let watcher = DeviceWatcher::start(move |event| {
        let elapsed = started.elapsed().as_secs_f64();
        match event {
            DeviceEvent::Added(d) => println!("{elapsed:7.3}s  + {} ({}) {}", d.name, d.transport, d.id),
            DeviceEvent::Removed(d) => println!("{elapsed:7.3}s  - {} ({}) {}", d.name, d.transport, d.id),
            DeviceEvent::Changed(d) => println!("{elapsed:7.3}s  ~ {} ({}) {}", d.name, d.transport, d.id),
        }
    })?;
    println!(
        "watching for {}s (platform notifications: {}); connect or disconnect a camera",
        duration.as_secs(),
        if watcher.has_notifications() { "on" } else { "off, polling" }
    );
    for (index, device) in watcher.devices().iter().enumerate() {
        print_device(index, device);
    }
    zvid_capture::run_main_loop_for(duration);
    Ok(())
}

fn capture(args: &[String]) -> Result<(), CaptureError> {
    let mut positional = Vec::new();
    let mut preview_dir = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--preview" {
            preview_dir = iter.next().map(PathBuf::from);
        } else {
            positional.push(arg.clone());
        }
    }
    let devices = list_devices()?;
    let device = match positional.first() {
        Some(choice) => choice
            .parse::<usize>()
            .ok()
            .and_then(|index| devices.get(index))
            .or_else(|| devices.iter().find(|d| d.id.0 == *choice))
            .ok_or_else(|| CaptureError::DeviceNotFound(choice.clone()))?,
        None => devices.first().ok_or_else(|| CaptureError::DeviceNotFound("(no cameras connected)".into()))?,
    };
    let duration = seconds(positional.get(1), 5);
    if let Some(dir) = &preview_dir {
        std::fs::create_dir_all(dir).map_err(|e| CaptureError::Platform {
            context: "create preview dir",
            message: e.to_string(),
        })?;
    }

    let timestamps = Arc::new(Mutex::new(Vec::<HostTime>::new()));
    let frame_stamps = timestamps.clone();
    let preview_bytes = Arc::new(Mutex::new(0usize));
    let preview_total = preview_bytes.clone();
    let config = CaptureConfig::new()
        .on_frame(move |frame| {
            let mut stamps = frame_stamps.lock().unwrap();
            let lag = HostTime::now() - frame.pts;
            if stamps.len() < 5 || stamps.len() % 30 == 0 {
                println!(
                    "frame {:5}  pts {}  {}x{} {:?} rot {}°  delivery latency {:.2} ms",
                    frame.sequence,
                    frame.pts,
                    frame.width,
                    frame.height,
                    frame.format,
                    frame.rotation.degrees(),
                    lag.as_secs_f64() * 1e3
                );
            }
            stamps.push(frame.pts);
        })
        .on_preview(PreviewConfig::default(), move |preview| {
            *preview_total.lock().unwrap() += preview.jpeg.len();
            if let Some(dir) = &preview_dir {
                let _ = std::fs::write(dir.join(format!("preview-{:05}.jpg", preview.sequence)), &preview.jpeg);
            }
        });

    println!("capturing {} ({}) for {}s", device.name, device.transport, duration.as_secs());
    let session = CaptureSession::start(&device.id, config)?;
    let selection = session.selection();
    println!("format: {} (requested {} fps)", selection.format, selection.fps);
    zvid_capture::run_main_loop_for(duration);
    let stats = session.stop();

    let stamps = timestamps.lock().unwrap();
    let jitter = JitterStats::from_timestamps(&stamps, selection.fps);
    println!("session: {stats:?}");
    println!("timestamps: {jitter}");
    println!(
        "previews: {} ({} KiB total)",
        stats.previews,
        *preview_bytes.lock().unwrap() / 1024
    );
    if jitter.non_monotonic > 0 {
        return Err(CaptureError::Platform {
            context: "timestamps",
            message: "not monotonic".into(),
        });
    }
    Ok(())
}
