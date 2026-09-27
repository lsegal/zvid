//! Host integration tests: `cargo xtask fetch-test-host` and `cargo xtask
//! host-test`.
//!
//! They load the real bundles in [Plugalyzer], an open-source JUCE-based CLI
//! plugin host, pinned below by version and checksum and downloaded as a
//! prebuilt release rather than built. Each format (VST3 everywhere, AU on
//! macOS) must pass a deterministic test signal through sample for sample at
//! several block sizes, and must round-trip its state through the host: the
//! default state a fresh instance saves, and the shared fixture restored into
//! another fresh instance. A host error, crash or timeout, or a
//! `[zvid-vst3]`/`[zvid-au]` line in [`LOG_ENV`] other than the expected
//! ones, fails the run.
//!
//! [Plugalyzer]: https://github.com/CrushedPixel/Plugalyzer

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use sha2::{Digest, Sha256};
use zvid_au::component::STATE_KEY;
use zvid_daw_core::{LOG_ENV, PLUGIN_NAME, State};

/// Plugalyzer release the tests run against.
const HOST_VERSION: &str = "0.5.0";
const HOST_RELEASES: &str = "https://github.com/CrushedPixel/Plugalyzer/releases/download";

/// A pinned Plugalyzer release asset: a zip holding the one host binary.
struct HostAsset {
    os: &'static str,
    zip: &'static str,
    sha256: &'static str,
    binary: &'static str,
}

const HOST_ASSETS: &[HostAsset] = &[
    HostAsset {
        os: "macos",
        zip: "Plugalyzer_macOS.zip",
        sha256: "6f772b3d915e9303c79ae22353df8235f61a4ed5226912f9961fc2610cc7dc88",
        binary: "Plugalyzer",
    },
    HostAsset {
        os: "windows",
        zip: "Plugalyzer_Windows.zip",
        sha256: "564f95d1e797a94246c1914cbd0c41c0a13804c86f7b7be6f04d84847fd851ff",
        binary: "Plugalyzer.exe",
    },
];

/// Test signal: 48 kHz stereo, 96 × 1024 frames (about 2 s), so every tested
/// block size divides it and the host writes back exactly as many frames.
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;
const FRAMES: usize = 96 * 1024;
const BLOCK_SIZES: &[u32] = &[64, 512, 1024];
/// How long one host run may take before it counts as hung.
const HOST_TIMEOUT: Duration = Duration::from_secs(60);

/// The shared state fixture, as hex of the JSON the plugin saves.
const FIXTURE_HEX: &str = include_str!("../../fixtures/state/zvid-capture-v1.hex");

/// Plugin log lines that aren't errors, as the start and end of what
/// follows the `[zvid-…] ` prefix. Rendering faster than real time outruns
/// the control thread, so the transport ring drops snapshots by design.
const INFO_LINES: &[(&str, &str)] = &[
    ("restored state: ", ""),
    ("live companion: ", ""),
    ("dropped ", " transport snapshots"),
];

/// JUCE's `AudioProcessor::copyXmlToBinary` magic number, `VC2!`.
const JUCE_XML_MAGIC: u32 = 0x2132_4356;
/// Alphabet of JUCE's `MemoryBlock::toBase64Encoding`, which is not RFC 4648.
const JUCE_BASE64: &[u8; 64] = b".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+";

/// Downloads the pinned host into `target/test-host`, unless a verified copy
/// is already there, and returns the path of its binary.
pub fn fetch_test_host(target: &Path) -> Result<PathBuf, String> {
    let os = std::env::consts::OS;
    let asset = HOST_ASSETS
        .iter()
        .find(|asset| asset.os == os)
        .ok_or_else(|| format!("no test host is pinned for {os}"))?;
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    let dir = target
        .join("test-host")
        .join(format!("plugalyzer-{HOST_VERSION}"));
    let binary = dir.join(asset.binary);
    // The stamp records which archive the binary came from.
    let stamp = dir.join("sha256");
    if binary.is_file() && fs::read_to_string(&stamp).is_ok_and(|sum| sum == asset.sha256) {
        return Ok(binary);
    }
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| io(&dir, error))?;
    }
    fs::create_dir_all(&dir).map_err(|error| io(&dir, error))?;
    let zip = dir.join(asset.zip);
    let url = format!("{HOST_RELEASES}/v{HOST_VERSION}/{}", asset.zip);
    run_quiet(
        Command::new("curl")
            .args(["--silent", "--show-error", "--fail", "--location"])
            .args(["--retry", "3", "--output"])
            .arg(&zip)
            .arg(&url),
        &format!("downloading {url}"),
    )?;
    let bytes = fs::read(&zip).map_err(|error| io(&zip, error))?;
    let sum = sha256_hex(&bytes);
    if sum != asset.sha256 {
        return Err(format!(
            "{url} has SHA-256 {sum}, expected {}; refusing to run it",
            asset.sha256
        ));
    }
    // bsdtar, which macOS and Windows 10+ ship as `tar`, reads zips.
    run_quiet(
        Command::new("tar").arg("-xf").arg(&zip).arg("-C").arg(&dir),
        &format!("unpacking {}", zip.display()),
    )?;
    fs::remove_file(&zip).map_err(|error| io(&zip, error))?;
    if !binary.is_file() {
        return Err(format!("{} has no {}", asset.zip, asset.binary));
    }
    fs::write(&stamp, asset.sha256).map_err(|error| io(&stamp, error))?;
    Ok(binary)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Plugin format under test.
#[derive(Clone, Copy)]
enum Format {
    Vst3,
    Au,
}

impl Format {
    fn name(self) -> &'static str {
        match self {
            Format::Vst3 => "VST3",
            Format::Au => "AU",
        }
    }

    /// Prefix the format layer puts on its log lines.
    fn log_prefix(self) -> &'static str {
        match self {
            Format::Vst3 => "[zvid-vst3] ",
            Format::Au => "[zvid-au] ",
        }
    }
}

/// Runs the host tests against `vst3` and, when given, the `.component`
/// bundle `component`, printing each check as it passes. Fails listing
/// every check that didn't.
pub fn host_test(target: &Path, vst3: &Path, component: Option<&Path>) -> Result<(), String> {
    let host = fetch_test_host(target)?;
    println!("host: Plugalyzer {HOST_VERSION} ({})", host.display());
    let work = target.join("host-test");
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    if work.exists() {
        fs::remove_dir_all(&work).map_err(|error| io(&work, error))?;
    }
    fs::create_dir_all(&work).map_err(|error| io(&work, error))?;
    let signal = test_signal();
    let input = work.join("input.wav");
    fs::write(&input, write_wav(&signal)).map_err(|error| io(&input, error))?;

    let mut plugins = vec![(Format::Vst3, vst3.to_path_buf())];
    if let Some(component) = component {
        plugins.push((Format::Au, install_component(component)?));
    }
    let host = Host { binary: host, work };
    let mut failures = Vec::new();
    for (format, plugin) in &plugins {
        for &block_size in BLOCK_SIZES {
            let check = format!(
                "{} pass-through at {block_size}-sample blocks",
                format.name()
            );
            report(
                &check,
                host.pass_through(*format, plugin, &input, &signal, block_size),
                &mut failures,
            );
        }
        let check = format!("{} default state", format.name());
        let saved = host.save_default_state(*format, plugin);
        report(
            &check,
            saved.as_ref().map(|_| ()).map_err(String::clone),
            &mut failures,
        );
        if let Ok(saved) = saved {
            let check = format!("{} state round trip", format.name());
            report(
                &check,
                host.restore_fixture(*format, plugin, &saved),
                &mut failures,
            );
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} host test(s) failed:\n  {}",
            failures.len(),
            failures.join("\n  ")
        ))
    }
}

fn report(check: &str, result: Result<(), String>, failures: &mut Vec<String>) {
    match result {
        Ok(()) => println!("ok: {check}"),
        Err(error) => {
            println!("FAILED: {check}: {error}");
            failures.push(format!("{check}: {error}"));
        }
    }
}

/// Installs the `.component` bundle for the current user, where the
/// AudioComponent registry finds it, and returns the installed path.
fn install_component(component: &Path) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    let components = PathBuf::from(home).join("Library/Audio/Plug-Ins/Components");
    let installed = components.join(format!("{PLUGIN_NAME}.component"));
    let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
    fs::create_dir_all(&components).map_err(|error| io(&components, error))?;
    if installed.exists() {
        fs::remove_dir_all(&installed).map_err(|error| io(&installed, error))?;
    }
    // ditto keeps the bundle's signature intact.
    run_quiet(
        Command::new("ditto").arg(component).arg(&installed),
        &format!("installing {}", component.display()),
    )?;
    // The registrar caches the component list; restarting it rescans.
    let _ = Command::new("killall")
        .args(["-9", "AudioComponentRegistrar"])
        .stderr(Stdio::null())
        .status();
    println!("installed {}", installed.display());
    Ok(installed)
}

struct Host {
    binary: PathBuf,
    work: PathBuf,
}

impl Host {
    /// Renders the test signal through `plugin` at `block_size` and checks
    /// that it comes back unchanged.
    fn pass_through(
        &self,
        format: Format,
        plugin: &Path,
        input: &Path,
        signal: &[f32],
        block_size: u32,
    ) -> Result<(), String> {
        let name = format!("{}-{block_size}", format.name().to_lowercase());
        let output = self.work.join(format!("{name}.wav"));
        self.run(
            format,
            &name,
            &[
                "process".into(),
                format!("--plugin={}", plugin.display()),
                format!("--input={}", input.display()),
                format!("--output={}", output.display()),
                format!("--blockSize={block_size}"),
                "--overwrite".into(),
            ],
        )?;
        let rendered = read_wav(&read(&output)?)?;
        compare_signals(signal, &rendered)
    }

    /// Saves the state of a fresh instance through the host, checks it is
    /// the default state and returns the file the host saved it to.
    fn save_default_state(&self, format: Format, plugin: &Path) -> Result<PathBuf, String> {
        let name = format!("{}-default-state", format.name().to_lowercase());
        let path = self.work.join(format!("{name}.bin"));
        self.run(
            format,
            &name,
            &[
                "state".into(),
                format!("--plugin={}", plugin.display()),
                format!("--output={}", path.display()),
                "--format=binary".into(),
                "--overwrite".into(),
            ],
        )?;
        let json = match format {
            Format::Vst3 => vst3_state(&read(&path)?)?,
            Format::Au => plist_state(&plist_to_xml(&path)?)?,
        };
        let expected = State::default().to_json();
        if json != expected.as_bytes() {
            return Err(format!(
                "a fresh instance saved {}, expected {expected}",
                String::from_utf8_lossy(&json)
            ));
        }
        Ok(path)
    }

    /// Puts the fixture state into the state the host `saved`, restores it
    /// into a fresh instance and checks the plugin read every take back.
    fn restore_fixture(&self, format: Format, plugin: &Path, saved: &Path) -> Result<(), String> {
        let fixture = State::from_hex(FIXTURE_HEX).map_err(|error| error.to_string())?;
        let json = fixture.to_json();
        let name = format!("{}-fixture-state", format.name().to_lowercase());
        let path = self.work.join(format!("{name}.bin"));
        let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
        match format {
            Format::Vst3 => {
                let blob = with_vst3_state(&read(saved)?, json.as_bytes())?;
                fs::write(&path, blob).map_err(|error| io(&path, error))?;
            }
            Format::Au => {
                let xml = with_plist_state(&plist_to_xml(saved)?, json.as_bytes())?;
                let xml_path = self.work.join(format!("{name}.plist"));
                fs::write(&xml_path, xml).map_err(|error| io(&xml_path, error))?;
                // Hosts hand AU binary property lists, as JUCE saves them.
                run_quiet(
                    Command::new("plutil")
                        .args(["-convert", "binary1", "-o"])
                        .arg(&path)
                        .arg(&xml_path),
                    "converting the fixture state",
                )?;
            }
        }
        let lines = self.run(
            format,
            &name,
            &[
                "state".into(),
                format!("--plugin={}", plugin.display()),
                format!("--input={}", path.display()),
            ],
        )?;
        let expected = format!(
            "{}restored state: {}",
            format.log_prefix(),
            fixture.summary()
        );
        if lines.contains(&expected) {
            Ok(())
        } else {
            Err(format!(
                "the plugin did not log `{expected}`; it logged {lines:?}"
            ))
        }
    }

    /// Runs the host with `args`, failing on a non-zero exit, a crash, a
    /// timeout or a plugin error in the log, and returns the plugin's log
    /// lines. Output goes to `<name>.stdout` and `<name>.stderr`.
    fn run(&self, format: Format, name: &str, args: &[String]) -> Result<Vec<String>, String> {
        let io = |path: &Path, error: std::io::Error| format!("{}: {error}", path.display());
        let log = self.work.join(format!("{name}.log"));
        let stdout_path = self.work.join(format!("{name}.stdout"));
        let stderr_path = self.work.join(format!("{name}.stderr"));
        let stdout = fs::File::create(&stdout_path).map_err(|error| io(&stdout_path, error))?;
        let stderr = fs::File::create(&stderr_path).map_err(|error| io(&stderr_path, error))?;
        let mut child = Command::new(&self.binary)
            .args(args)
            .env(LOG_ENV, &log)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .map_err(|error| format!("could not run {}: {error}", self.binary.display()))?;
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() > HOST_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "the host timed out after {} s (see {})",
                        HOST_TIMEOUT.as_secs(),
                        stderr_path.display()
                    ));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(error) => return Err(format!("waiting for the host: {error}")),
            }
        };
        let lines = plugin_log_lines(&fs::read_to_string(&log).unwrap_or_default());
        if !status.success() {
            let stderr = fs::read_to_string(&stderr_path).unwrap_or_default();
            return Err(format!(
                "the host failed ({status}): {}{}",
                stderr.trim(),
                if lines.is_empty() {
                    String::new()
                } else {
                    format!("; plugin log: {lines:?}")
                }
            ));
        }
        let errors = plugin_errors(&lines, format);
        if !errors.is_empty() {
            return Err(format!("the plugin logged errors: {errors:?}"));
        }
        Ok(lines)
    }
}

/// The format layers' lines in a `ZVID_DAW_LOG` file.
fn plugin_log_lines(log: &str) -> Vec<String> {
    log.lines()
        .filter(|line| line.starts_with("[zvid-vst3] ") || line.starts_with("[zvid-au] "))
        .map(str::to_string)
        .collect()
}

/// The `lines` that report problems: every format layer line other than
/// the expected [`INFO_LINES`] of `format`'s own layer.
fn plugin_errors(lines: &[String], format: Format) -> Vec<String> {
    lines
        .iter()
        .filter(|line| {
            let info = line.strip_prefix(format.log_prefix()).is_some_and(|rest| {
                INFO_LINES
                    .iter()
                    .any(|(start, end)| rest.starts_with(start) && rest.ends_with(end))
            });
            !info
        })
        .cloned()
        .collect()
}

/// The deterministic test signal, interleaved stereo: a different tone in
/// each channel, low-level pseudo-random noise so that no two samples
/// repeat, and full-scale impulses at offsets no block size lines up with.
fn test_signal() -> Vec<f32> {
    let mut noise: u32 = 0x2545_f491;
    let mut signal = Vec::with_capacity(FRAMES * CHANNELS);
    for frame in 0..FRAMES {
        let t = frame as f64 / f64::from(SAMPLE_RATE);
        for (channel, hz) in [440.0, 1_000.0].into_iter().enumerate() {
            noise ^= noise << 13;
            noise ^= noise >> 17;
            noise ^= noise << 5;
            let dither = (f64::from(noise) / f64::from(u32::MAX) - 0.5) * 0.01;
            let impulse = (frame + channel * 331) % 997 == 0;
            let sample = if impulse {
                if channel == 0 { 1.0 } else { -1.0 }
            } else {
                0.25 * (std::f64::consts::TAU * hz * t).sin() + dither
            };
            signal.push(sample as f32);
        }
    }
    signal
}

/// Checks `rendered` matches `expected` sample for sample, naming the first
/// difference.
fn compare_signals(expected: &[f32], rendered: &[f32]) -> Result<(), String> {
    if rendered.len() != expected.len() {
        return Err(format!(
            "rendered {} frames, expected {}",
            rendered.len() / CHANNELS,
            expected.len() / CHANNELS
        ));
    }
    match expected
        .iter()
        .zip(rendered)
        .position(|(a, b)| a.to_bits() != b.to_bits())
    {
        None => Ok(()),
        Some(index) => Err(format!(
            "frame {} channel {} is {}, expected {}",
            index / CHANNELS,
            index % CHANNELS,
            rendered[index],
            expected[index]
        )),
    }
}

/// A 32-bit float WAV file of the interleaved stereo `samples`.
fn write_wav(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 4) as u32;
    let block_align = (CHANNELS * 4) as u16;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&3u16.to_le_bytes()); // WAVE_FORMAT_IEEE_FLOAT
    wav.extend_from_slice(&(CHANNELS as u16).to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * u32::from(block_align)).to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&32u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

/// The interleaved samples of a 48 kHz stereo 32-bit float WAV file, plain
/// or `WAVE_FORMAT_EXTENSIBLE`.
fn read_wav(wav: &[u8]) -> Result<Vec<f32>, String> {
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("the output is not a WAV file".into());
    }
    let u16_at = |bytes: &[u8], at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let mut format = None;
    let mut rest = &wav[12..];
    while rest.len() >= 8 {
        let id = &rest[..4];
        let len = u32::from_le_bytes(rest[4..8].try_into().unwrap()) as usize;
        let body = rest.get(8..8 + len).ok_or("the output WAV is truncated")?;
        match id {
            b"fmt " if len >= 16 => {
                let mut tag = u16_at(body, 0);
                if tag == 0xFFFE && len >= 26 {
                    // WAVE_FORMAT_EXTENSIBLE: the tag opens the subformat GUID.
                    tag = u16_at(body, 24);
                }
                let channels = usize::from(u16_at(body, 2));
                let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                let bits = u16_at(body, 14);
                format = Some((tag, channels, rate, bits));
            }
            b"data" => {
                let Some((tag, channels, rate, bits)) = format else {
                    return Err("the output WAV has no fmt chunk before its data".into());
                };
                if (tag, channels, rate, bits) != (3, CHANNELS, SAMPLE_RATE, 32) {
                    return Err(format!(
                        "the output WAV is format {tag}, {channels} channels, {rate} Hz, \
                         {bits} bits; expected 32-bit float stereo at {SAMPLE_RATE} Hz"
                    ));
                }
                return Ok(body
                    .chunks_exact(4)
                    .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
                    .collect());
            }
            _ => {}
        }
        // Chunks are padded to an even length.
        rest = rest.get(8 + len + (len & 1)..).unwrap_or_default();
    }
    Err("the output WAV has no data chunk".into())
}

/// The XML inside a JUCE `copyXmlToBinary` blob.
fn juce_xml(blob: &[u8]) -> Result<&str, String> {
    let header = |at: usize| {
        blob.get(at..at + 4)
            .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
    };
    if header(0) != Some(JUCE_XML_MAGIC) {
        return Err("the host's VST3 state is not a JUCE XML blob".into());
    }
    let len = header(4).unwrap_or(0) as usize;
    let xml = blob
        .get(8..8 + len)
        .ok_or("the host's VST3 state is truncated")?;
    std::str::from_utf8(xml)
        .map(|xml| xml.trim_end_matches('\0'))
        .map_err(|error| format!("the host's VST3 state is not UTF-8: {error}"))
}

/// A JUCE `copyXmlToBinary` blob of `xml`.
fn juce_blob(xml: &str) -> Vec<u8> {
    let mut blob = Vec::with_capacity(xml.len() + 9);
    blob.extend_from_slice(&JUCE_XML_MAGIC.to_le_bytes());
    blob.extend_from_slice(&(xml.len() as u32 + 1).to_le_bytes());
    blob.extend_from_slice(xml.as_bytes());
    blob.push(0);
    blob
}

/// Where the text of `<tag>` sits in `xml`.
fn element_text(xml: &str, tag: &str) -> Result<std::ops::Range<usize>, String> {
    let open = format!("<{tag}>");
    let start = xml
        .find(&open)
        .map(|at| at + open.len())
        .ok_or_else(|| format!("the host's state has no <{tag}>"))?;
    let end = xml[start..]
        .find(&format!("</{tag}>"))
        .map(|at| start + at)
        .ok_or_else(|| format!("the host's state has an unclosed <{tag}>"))?;
    Ok(start..end)
}

/// The component state inside the state blob JUCE's VST3 host saves, a
/// `VST3PluginState` element with the `IComponent` stream in JUCE base64.
fn vst3_state(blob: &[u8]) -> Result<Vec<u8>, String> {
    let xml = juce_xml(blob)?;
    juce_base64_decode(&xml[element_text(xml, "IComponent")?])
}

/// `blob` with its component state replaced by `state`.
fn with_vst3_state(blob: &[u8], state: &[u8]) -> Result<Vec<u8>, String> {
    let xml = juce_xml(blob)?;
    let range = element_text(xml, "IComponent")?;
    let mut replaced = xml.to_string();
    replaced.replace_range(range, &juce_base64_encode(state));
    Ok(juce_blob(&replaced))
}

/// `MemoryBlock::toBase64Encoding`: the byte count, a dot, then six bits a
/// character, least significant bits first.
fn juce_base64_encode(bytes: &[u8]) -> String {
    let bits = bytes.len() * 8;
    let mut text = format!("{}.", bytes.len());
    for start in (0..bits).step_by(6) {
        let mut value = 0usize;
        for bit in 0..6.min(bits - start) {
            let at = start + bit;
            value |= usize::from(bytes[at / 8] >> (at % 8) & 1) << bit;
        }
        text.push(JUCE_BASE64[value] as char);
    }
    text
}

/// `MemoryBlock::fromBase64Encoding`, the inverse of [`juce_base64_encode`].
fn juce_base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let text = text.trim();
    let (len, digits) = text
        .split_once('.')
        .ok_or("JUCE base64 lacks its length prefix")?;
    let len: usize = len
        .parse()
        .map_err(|_| format!("JUCE base64 has a bad length: {len}"))?;
    let mut bytes = vec![0u8; len];
    let mut at = 0;
    for digit in digits.bytes() {
        let value = JUCE_BASE64
            .iter()
            .position(|&c| c == digit)
            .ok_or_else(|| format!("JUCE base64 has a bad character: {}", digit as char))?;
        for bit in 0..6 {
            if at / 8 < len && value >> bit & 1 == 1 {
                bytes[at / 8] |= 1 << (at % 8);
            }
            at += 1;
        }
    }
    if at < len * 8 {
        return Err(format!("JUCE base64 holds {at} bits, expected {}", len * 8));
    }
    Ok(bytes)
}

/// The property list at `path` as XML.
fn plist_to_xml(path: &Path) -> Result<String, String> {
    let output = Command::new("plutil")
        .args(["-convert", "xml1", "-o", "-"])
        .arg(path)
        .output()
        .map_err(|error| format!("could not run plutil: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{} is not a property list: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

/// Where the base64 of the ZVID state sits in an XML ClassInfo plist.
fn plist_state_range(xml: &str) -> Result<std::ops::Range<usize>, String> {
    let key = format!("<key>{STATE_KEY}</key>");
    let after_key = xml
        .find(&key)
        .map(|at| at + key.len())
        .ok_or_else(|| format!("the host's ClassInfo has no {STATE_KEY} key"))?;
    let data = element_text(&xml[after_key..], "data")?;
    if !xml[after_key..after_key + data.start - "<data>".len()]
        .trim()
        .is_empty()
    {
        return Err(format!("{STATE_KEY} in the host's ClassInfo is not data"));
    }
    Ok(after_key + data.start..after_key + data.end)
}

/// The ZVID state in an XML ClassInfo plist.
fn plist_state(xml: &str) -> Result<Vec<u8>, String> {
    let text: String = xml[plist_state_range(xml)?]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    BASE64
        .decode(text)
        .map_err(|error| format!("{STATE_KEY} is not base64: {error}"))
}

/// The XML ClassInfo plist `xml` with its ZVID state replaced by `state`.
fn with_plist_state(xml: &str, state: &[u8]) -> Result<String, String> {
    let range = plist_state_range(xml)?;
    let mut replaced = xml.to_string();
    replaced.replace_range(range, &BASE64.encode(state));
    Ok(replaced)
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("{}: {error}", path.display()))
}

/// Runs `command`, keeping its output unless it fails.
fn run_quiet(command: &mut Command, what: &str) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let output = command
        .output()
        .map_err(|error| format!("{what}: could not run {program}: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{what} failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_a_host_for_every_platform_ci_tests() {
        for os in ["macos", "windows"] {
            let asset = HOST_ASSETS.iter().find(|asset| asset.os == os).unwrap();
            assert_eq!(asset.sha256.len(), 64);
            assert!(asset.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
        }
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_signal_fits_every_block_size_and_never_repeats_a_frame() {
        let signal = test_signal();
        assert_eq!(signal, test_signal(), "the signal is deterministic");
        assert_eq!(signal.len(), FRAMES * CHANNELS);
        for block in BLOCK_SIZES {
            assert_eq!(FRAMES % *block as usize, 0);
        }
        assert!(signal.iter().all(|sample| sample.abs() <= 1.0));
        // A host that repeats or drops a block, or swaps the channels, can't
        // produce the same samples.
        let frames: Vec<&[f32]> = signal.chunks(CHANNELS).collect();
        assert!(frames.windows(2).all(|pair| pair[0] != pair[1]));
        assert!(frames.iter().any(|frame| frame[0] != frame[1]));
    }

    #[test]
    fn round_trips_wav_files() {
        let signal = test_signal();
        let wav = write_wav(&signal);
        assert_eq!(read_wav(&wav).unwrap(), signal);
        assert_eq!(compare_signals(&signal, &read_wav(&wav).unwrap()), Ok(()));

        // JUCE writes a WAVE_FORMAT_EXTENSIBLE header and extra chunks.
        let mut extensible = wav[..12].to_vec();
        extensible.extend_from_slice(b"JUNK\x03\x00\x00\x00abc\x00");
        extensible.extend_from_slice(b"fmt \x28\x00\x00\x00");
        extensible.extend_from_slice(&0xFFFEu16.to_le_bytes());
        extensible.extend_from_slice(&wav[22..36]);
        extensible.extend_from_slice(&[22, 0, 32, 0, 3, 0, 0, 0]);
        extensible.extend_from_slice(&3u16.to_le_bytes());
        extensible.extend_from_slice(&[0; 14]);
        extensible.extend_from_slice(&wav[36..]);
        assert_eq!(read_wav(&extensible).unwrap(), signal);

        let mut pcm = wav.clone();
        pcm[20] = 1;
        assert!(read_wav(&pcm).unwrap_err().contains("format 1"));
        assert!(read_wav(b"not a wav").is_err());
    }

    #[test]
    fn names_the_first_differing_sample() {
        let signal = test_signal();
        let mut shifted = signal.clone();
        shifted.rotate_right(CHANNELS);
        let error = compare_signals(&signal, &shifted).unwrap_err();
        assert!(error.starts_with("frame 0 channel 0"), "{error}");
        assert!(compare_signals(&signal, &signal[CHANNELS..]).is_err());
    }

    #[test]
    fn juce_base64_round_trips() {
        for len in 0..40 {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let text = juce_base64_encode(&bytes);
            assert!(text.starts_with(&format!("{len}.")));
            assert_eq!(juce_base64_decode(&text).unwrap(), bytes);
        }
        // Six bits a character, least significant first, from an alphabet
        // that starts at `.`: 0x01 is 1 then 0.
        assert_eq!(juce_base64_encode(&[1]), "1.A.");
        assert_eq!(juce_base64_encode(&[0x40]), "1..A");
        assert_eq!(juce_base64_encode(&[0xFF, 0xFF, 0xFF]), "3.++++");
        assert!(juce_base64_decode("no length").is_err());
        assert!(juce_base64_decode("4.AB").is_err());
    }

    #[test]
    fn swaps_the_component_state_in_a_vst3_blob() {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?> <VST3PluginState><IComponent>{}</IComponent><IEditController>0.</IEditController></VST3PluginState>",
            juce_base64_encode(b"{}")
        );
        let blob = juce_blob(&xml);
        assert_eq!(&blob[..4], b"VC2!");
        assert_eq!(vst3_state(&blob).unwrap(), b"{}");

        let swapped = with_vst3_state(&blob, b"{\"version\":\"1\"}").unwrap();
        assert_eq!(vst3_state(&swapped).unwrap(), b"{\"version\":\"1\"}");
        let swapped_xml = juce_xml(&swapped).unwrap();
        assert!(swapped_xml.ends_with("<IEditController>0.</IEditController></VST3PluginState>"));

        assert!(vst3_state(b"VC2!").is_err());
        assert!(vst3_state(&juce_blob("<VST3PluginState/>")).is_err());
    }

    #[test]
    fn swaps_the_zvid_state_in_a_class_info_plist() {
        let xml = format!(
            "<plist version=\"1.0\">\n<dict>\n\t<key>name</key>\n\t<string>Untitled</string>\n\t<key>{STATE_KEY}</key>\n\t<data>\n\te30=\n\t</data>\n</dict>\n</plist>\n"
        );
        assert_eq!(plist_state(&xml).unwrap(), b"{}");
        let swapped = with_plist_state(&xml, b"{\"version\":\"1\"}").unwrap();
        assert_eq!(plist_state(&swapped).unwrap(), b"{\"version\":\"1\"}");
        assert!(swapped.contains("<string>Untitled</string>"));
        assert!(plist_state("<dict/>").is_err());
        let not_data = format!("<key>{STATE_KEY}</key><string>x</string><data>e30=</data>");
        assert!(plist_state(&not_data).is_err());
    }

    #[test]
    fn flags_every_plugin_line_but_the_expected_ones() {
        let log = "\
[zvid-vst3] restored state: 2 takes, 900 bytes
[zvid-vst3] live companion: connected
[zvid-vst3] dropped 311 transport snapshots
[zvid-vst3] dropped the editor
[zvid-vst3] ignoring unreadable state: expected value
[zvid-au] restored state: 0 takes, 60 bytes
[zvid-capture] recording at 30 fps
";
        let lines = plugin_log_lines(log);
        assert_eq!(lines.len(), 6);
        assert_eq!(
            plugin_errors(&lines, Format::Vst3),
            [
                "[zvid-vst3] dropped the editor",
                "[zvid-vst3] ignoring unreadable state: expected value",
                "[zvid-au] restored state: 0 takes, 60 bytes"
            ]
        );
    }
}
