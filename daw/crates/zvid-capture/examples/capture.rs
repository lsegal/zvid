//! Lists cameras, watches hot-plug, captures frames and logs timestamp
//! jitter, or records a camera to an MP4.
//!
//! ```text
//! cargo run --example capture -- list
//! cargo run --example capture -- watch [SECONDS]
//! cargo run --example capture -- capture [DEVICE] [SECONDS] [--preview DIR]
//! cargo run --example capture -- record [DEVICE] [SECONDS] [--dir DIR] [--click]
//! ```
//!
//! `DEVICE` is an index from `list` or a device ID; it defaults to the first
//! camera. `--preview DIR` also writes each preview JPEG into `DIR`. `record`
//! writes to the Documents record root unless `--dir` names another; see
//! `record` below for `--click`.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zvid_capture::record::{
    AudioBlock, AudioFormat, RecordConfig, Recorder, VideoEncoderChoice, poster_jpeg,
};
use zvid_capture::{
    CaptureConfig, CaptureError, CaptureSession, Device, DeviceEvent, DeviceWatcher, HostTime,
    JitterStats, PreviewConfig, list_devices, permission, supported_formats,
};
use zvid_daw_core::{LocalTime, RecordRoot, RecordRootKind};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("list") => list(),
        Some("watch") => watch(seconds(args.get(1), 30)),
        Some("capture") => capture(&args[1..]),
        Some("record") => record(&args[1..]).map_err(|error| CaptureError::Platform {
            context: "record",
            message: error.to_string(),
        }),
        Some(other) => {
            eprintln!("unknown command {other:?}; use list, watch, capture, or record");
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
    println!(
        "[{index}] {} ({})\n    id: {}",
        device.name, device.transport, device.id
    );
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
            DeviceEvent::Added(d) => {
                println!("{elapsed:7.3}s  + {} ({}) {}", d.name, d.transport, d.id)
            }
            DeviceEvent::Removed(d) => {
                println!("{elapsed:7.3}s  - {} ({}) {}", d.name, d.transport, d.id)
            }
            DeviceEvent::Changed(d) => {
                println!("{elapsed:7.3}s  ~ {} ({}) {}", d.name, d.transport, d.id)
            }
        }
    })?;
    println!(
        "watching for {}s (platform notifications: {}); connect or disconnect a camera",
        duration.as_secs(),
        if watcher.has_notifications() {
            "on"
        } else {
            "off, polling"
        }
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
        None => devices
            .first()
            .ok_or_else(|| CaptureError::DeviceNotFound("(no cameras connected)".into()))?,
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
            if stamps.len() < 5 || stamps.len().is_multiple_of(30) {
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
                let _ = std::fs::write(
                    dir.join(format!("preview-{:05}.jpg", preview.sequence)),
                    &preview.jpeg,
                );
            }
        });

    println!(
        "capturing {} ({}) for {}s",
        device.name,
        device.transport,
        duration.as_secs()
    );
    let session = CaptureSession::start(&device.id, config)?;
    let selection = session.selection();
    println!(
        "format: {} (requested {} fps)",
        selection.format, selection.fps
    );
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

/// Records a camera to an MP4 in the record root (or `--dir DIR`), with a
/// synthetic click track when `--click` is given: a 10 ms click on every
/// whole second of host time, to check A/V sync against an on-screen clock.
fn record(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut positional = Vec::new();
    let mut dir = None;
    let mut click = false;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--dir" => dir = iter.next().map(PathBuf::from),
            "--click" => click = true,
            _ => positional.push(arg.clone()),
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
        None => devices
            .first()
            .ok_or_else(|| CaptureError::DeviceNotFound("(no cameras connected)".into()))?,
    };
    let duration = seconds(positional.get(1), 10);
    let root = match dir {
        Some(dir) => RecordRoot {
            kind: RecordRootKind::Documents,
            dir,
        },
        None => RecordRoot::resolve(None).ok_or("no Documents directory")?,
    };

    // The recorder needs the camera's frame rate, known once capture starts;
    // frames before that are not recorded.
    let recorder = Arc::new(Mutex::new(None::<Recorder>));
    let sink = recorder.clone();
    let config = CaptureConfig::new().on_frame(move |frame| {
        if let Some(recorder) = sink.lock().unwrap().as_ref() {
            recorder.push_frame(frame.clone());
        }
    });
    let session = CaptureSession::start(&device.id, config)?;
    let selection = session.selection();
    let audio = click.then_some(AudioFormat {
        sample_rate: 48_000,
        channels: 2,
    });
    *recorder.lock().unwrap() = Some(Recorder::start(RecordConfig {
        root: root.clone(),
        counter: 1,
        armed_at: utc_now(),
        fps: selection.fps,
        audio,
        video_encoder: VideoEncoderChoice::Auto,
    })?);
    println!(
        "recording {} ({}) at {} for {}s",
        device.name,
        selection.format,
        selection.fps,
        duration.as_secs()
    );

    let started = Instant::now();
    let mut next_block = HostTime::now();
    while started.elapsed() < duration {
        if click {
            // 10 ms blocks timed on the host clock, like a plugin's input bus.
            while next_block <= HostTime::now() {
                let mut samples = Vec::with_capacity(960);
                for frame in 0..480u64 {
                    let at = next_block.as_nanos() + frame * 1_000_000_000 / 48_000;
                    let value = if at % 1_000_000_000 < 10_000_000 {
                        0.5
                    } else {
                        0.0
                    };
                    samples.extend([value, value]);
                }
                if let Some(recorder) = recorder.lock().unwrap().as_ref() {
                    recorder.push_audio(AudioBlock {
                        host_time: Some(next_block),
                        samples,
                    });
                }
                next_block = HostTime::from_nanos(next_block.as_nanos() + 10_000_000);
            }
        }
        zvid_capture::run_main_loop_for(Duration::from_millis(5));
    }
    session.stop();
    let recorder = recorder.lock().unwrap().take().expect("started above");
    let recorded = recorder.stop()?;
    let path = root.path_of(&recorded.filename);
    println!("wrote {}", path.display());
    println!("{recorded:#?}");
    let poster = path.with_extension("jpg");
    std::fs::write(&poster, poster_jpeg(&path, 0.0, 480)?)?;
    println!("poster frame: {}", poster.display());
    Ok(())
}

/// The current UTC time for the file name. The plugin passes local time.
fn utc_now() -> LocalTime {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    LocalTime {
        month: (if mp < 10 { mp + 3 } else { mp - 9 }) as u8,
        day: (doy - (153 * mp + 2) / 5 + 1) as u8,
        hour: (rest / 3600) as u8,
        minute: (rest / 60 % 60) as u8,
        second: (rest % 60) as u8,
    }
}
