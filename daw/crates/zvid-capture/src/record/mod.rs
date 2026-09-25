//! Recording: encodes an armed capture to an MP4 in the record root.
//!
//! A [`Recorder`] owns one capture file. Frames from the capture callback
//! and audio blocks from the control thread are queued without blocking and
//! encoded on the recorder's own thread:
//!
//! - **Video** is HEVC Main from the platform's hardware encoder, falling
//!   back to zvidlib's native HEVC and then AV1 encoders (see
//!   [`encoder`]). Frames are placed on a constant-frame-rate grid at the
//!   camera's rate, timed from their capture timestamps relative to the
//!   first frame (file time zero). Frames are rotated upright
//!   ([`Frame::upright`]) before encoding.
//! - **Audio** is AAC-LC of the plugin's input bus, aligned to the same
//!   clock. Without an AAC encoder the file is video only.
//! - **Muxing** writes a fragmented MP4 while recording, one synced
//!   fragment a second, so a crash leaves a playable file. [`Recorder::stop`]
//!   remuxes it with zvidlib's `Mp4Muxer` into an ordinary MP4.
//!
//! When the encoder falls behind, frames are dropped at the queue and
//! counted in [`RecordStats::frames_dropped`].

mod bitstream;
mod encoder;
mod fmp4;
mod platform;
mod poster;
mod timing;

use std::collections::VecDeque;
use std::fmt;
use std::fs::{File, OpenOptions};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};
use std::thread::JoinHandle;

use zvid_daw_core::{LocalTime, RecordRoot, next_capture_filename};
use zvidlib::mp4::{Mp4TrackConfig, Mp4TrackFormat};
use zvidlib::{AudioGapless, Codec, EncodedSample, Limits, SampleDependency, VideoDimensions};

use crate::clock::HostTime;
use crate::format::Rational;
use crate::frame::{Frame, Rotation};

pub use encoder::VideoEncoderChoice;
pub use poster::poster_jpeg;
pub use timing::{AUDIO_TOLERANCE_SEC, AudioClock, Placement, VideoClock};

use encoder::{AAC_FRAME, EncodedFrame, FrameEncoder, PcmEncoder};
use fmp4::{FragmentedWriter, Track};

/// Frames the queue holds before new ones are dropped: a few frames of
/// slack for encoder jitter, not a backlog.
const FRAME_QUEUE: usize = 8;
/// While the first frame opens the encoder (which takes a moment for
/// hardware encoders), the queue holds up to this many frames and bytes.
const WARM_UP_FRAMES: usize = 60;
const WARM_UP_BYTES: usize = 128 << 20;
/// Audio the queue holds before blocks are dropped, in seconds.
const AUDIO_QUEUE_SEC: f64 = 2.0;
/// Audio held while waiting for the first frame (file time zero).
const PRE_ROLL_SEC: f64 = 2.0;
/// How much video each crash-safe fragment holds, in seconds.
const FRAGMENT_SEC: u64 = 1;

/// The audio stream recorded with the video.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    /// 1 or 2; blocks are interleaved.
    pub channels: u16,
}

/// Settings for [`Recorder::start`].
#[derive(Clone, Debug)]
pub struct RecordConfig {
    /// Directory to record into; created if missing.
    pub root: RecordRoot,
    /// Per-instance capture counter (`NN` in the file name).
    pub counter: u32,
    /// Local wall-clock time at arm, for the file name.
    pub armed_at: LocalTime,
    /// The camera's frame rate (see [`crate::Selection`]).
    pub fps: Rational,
    /// The input bus format, or `None` to record video only.
    pub audio: Option<AudioFormat>,
    pub video_encoder: VideoEncoderChoice,
}

/// A block of input-bus audio.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AudioBlock {
    /// Host time the first frame was heard, if known. Untimed blocks follow
    /// the previous block.
    pub host_time: Option<HostTime>,
    /// Interleaved samples, `channels` per frame.
    pub samples: Vec<f32>,
}

/// Maps capture time to file time: the frame captured at `host_time` is at
/// `file_sec` in the file.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameClock {
    pub host_time: HostTime,
    pub file_sec: f64,
}

/// Counters for a recording, for the UI footer and logs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RecordStats {
    /// Frames handed to the recorder.
    pub frames_received: u64,
    /// Frames encoded into the file.
    pub frames_written: u64,
    /// Frames dropped because the encoder fell behind.
    pub frames_dropped: u64,
    /// Frames dropped because the camera delivered two for one grid slot.
    pub frames_skipped: u64,
    /// Audio blocks dropped because the queue was full.
    pub audio_blocks_dropped: u64,
    /// Frames of silence inserted and skipped to keep audio in sync.
    pub audio_frames_inserted: u64,
    pub audio_frames_skipped: u64,
    /// The latest frame written; `None` before the first.
    pub frame_clock: Option<FrameClock>,
    /// Video encoder in use, once the first frame arrives.
    pub video_encoder: Option<&'static str>,
    pub audio_encoder: Option<&'static str>,
    /// Problems that didn't stop the recording, such as a missing AAC
    /// encoder or skipped encoder candidates.
    pub warnings: Vec<String>,
    /// The error that stopped encoding, if any. The file keeps what was
    /// written before it.
    pub error: Option<String>,
}

/// A finished recording.
#[derive(Clone, Debug, PartialEq)]
pub struct Recorded {
    /// The file name relative to the record root: the only path to store.
    pub filename: String,
    pub dimensions: (u32, u32),
    pub fps: Rational,
    pub duration_sec: f64,
    pub codec: &'static str,
    pub has_audio: bool,
    /// Host time of file time zero.
    pub zero: HostTime,
    pub stats: RecordStats,
}

#[derive(Debug)]
pub enum RecordError {
    Io(io::Error),
    /// The file couldn't be placed in the record root.
    Path(String),
    /// No frame was ever recorded; the empty file was removed.
    NoFrames,
    /// No video encoder accepted the camera's format.
    NoEncoder(String),
    /// Decoding a poster frame failed.
    Decode(String),
    /// The recording thread panicked.
    Panicked,
}

impl fmt::Display for RecordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Path(message) => write!(f, "invalid record path: {message}"),
            Self::NoFrames => f.write_str("no frames were recorded"),
            Self::NoEncoder(reasons) => write!(f, "no video encoder is available: {reasons}"),
            Self::Decode(message) => write!(f, "could not decode a poster frame: {message}"),
            Self::Panicked => f.write_str("the recording thread panicked"),
        }
    }
}

impl std::error::Error for RecordError {}

impl From<io::Error> for RecordError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

enum Item {
    Frame(Arc<Frame>),
    Audio(AudioBlock),
}

#[derive(Default)]
struct QueueState {
    items: VecDeque<Item>,
    frames: usize,
    frame_bytes: usize,
    audio_frames: usize,
    /// Set once the encoder is open and the start-up backlog has drained.
    warm: bool,
    stopping: bool,
}

struct Shared {
    queue: Mutex<QueueState>,
    ready: Condvar,
    stats: Mutex<RecordStats>,
    audio_capacity: usize,
    channels: usize,
}

impl Shared {
    fn stats(&self) -> MutexGuard<'_, RecordStats> {
        lock(&self.stats)
    }

    fn push_frame(&self, frame: Arc<Frame>) -> bool {
        let mut queue = lock(&self.queue);
        let room = if queue.warm {
            queue.frames < FRAME_QUEUE
        } else {
            queue.frames < WARM_UP_FRAMES && queue.frame_bytes + frame.data.len() <= WARM_UP_BYTES
        };
        let accepted = !queue.stopping && room;
        if accepted {
            queue.frames += 1;
            queue.frame_bytes += frame.data.len();
            queue.items.push_back(Item::Frame(frame));
        }
        drop(queue);
        let mut stats = self.stats();
        stats.frames_received += 1;
        if accepted {
            self.ready.notify_one();
        } else {
            stats.frames_dropped += 1;
        }
        accepted
    }

    fn push_audio(&self, block: AudioBlock) -> bool {
        let frames = block.samples.len() / self.channels.max(1);
        let mut queue = lock(&self.queue);
        let accepted = !queue.stopping && queue.audio_frames + frames <= self.audio_capacity;
        if accepted {
            queue.audio_frames += frames;
            queue.items.push_back(Item::Audio(block));
        }
        drop(queue);
        if accepted {
            self.ready.notify_one();
        } else {
            self.stats().audio_blocks_dropped += 1;
        }
        accepted
    }

    /// Waits for the next item; `None` once stopping and drained.
    fn pop(&self) -> Option<Item> {
        let mut queue = lock(&self.queue);
        loop {
            if let Some(item) = queue.items.pop_front() {
                match &item {
                    Item::Frame(frame) => {
                        queue.frames -= 1;
                        queue.frame_bytes -= frame.data.len();
                    }
                    Item::Audio(block) => {
                        queue.audio_frames -= block.samples.len() / self.channels.max(1)
                    }
                }
                return Some(item);
            }
            if queue.stopping {
                return None;
            }
            queue = self.ready.wait(queue).unwrap_or_else(|e| e.into_inner());
        }
    }
}

/// Records one capture file. Dropping it without [`Recorder::stop`] still
/// finishes the file.
pub struct Recorder {
    filename: String,
    path: PathBuf,
    shared: Arc<Shared>,
    worker: Option<JoinHandle<Result<Recorded, RecordError>>>,
}

impl Recorder {
    /// Creates the next free capture file in the record root and starts the
    /// recording thread. The file gets content once the first frame arrives.
    pub fn start(config: RecordConfig) -> Result<Self, RecordError> {
        std::fs::create_dir_all(&config.root.dir)?;
        let (file, path) = create_capture_file(&config.root, config.counter, config.armed_at)?;
        let filename = config
            .root
            .relative_filename(&path)
            .ok_or_else(|| RecordError::Path(path.display().to_string()))?;
        let fps = if config.fps.num > 0 && config.fps.den > 0 {
            config.fps.reduced()
        } else {
            Rational::new(30, 1)
        };
        let channels = config.audio.map_or(1, |audio| usize::from(audio.channels));
        let audio_capacity = config.audio.map_or(0, |audio| {
            (f64::from(audio.sample_rate) * AUDIO_QUEUE_SEC) as usize
        });
        let shared = Arc::new(Shared {
            queue: Mutex::new(QueueState::default()),
            ready: Condvar::new(),
            stats: Mutex::new(RecordStats::default()),
            audio_capacity,
            channels,
        });
        let worker = Worker {
            path: path.clone(),
            filename: filename.clone(),
            fps,
            audio: config.audio,
            choice: config.video_encoder,
            shared: Arc::clone(&shared),
        };
        let spawned = std::thread::Builder::new()
            .name("zvid-record".to_string())
            .spawn(move || worker.run(file));
        let worker = match spawned {
            Ok(worker) => worker,
            Err(error) => {
                let _ = std::fs::remove_file(&path);
                return Err(error.into());
            }
        };
        Ok(Self {
            filename,
            path,
            shared,
            worker: Some(worker),
        })
    }

    /// The capture file name relative to the record root.
    pub fn filename(&self) -> &str {
        &self.filename
    }

    /// The capture file's absolute path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Queues a frame; returns false when it was dropped because the
    /// encoder is behind. Never blocks.
    pub fn push_frame(&self, frame: Arc<Frame>) -> bool {
        self.shared.push_frame(frame)
    }

    /// A callback for [`crate::CaptureConfig::on_frame`] that feeds this
    /// recorder.
    pub fn frame_sink(&self) -> impl FnMut(&Arc<Frame>) + Send + 'static {
        let shared = Arc::clone(&self.shared);
        move |frame| {
            shared.push_frame(Arc::clone(frame));
        }
    }

    /// Queues input-bus audio; returns false when it was dropped because
    /// the queue is full. Never blocks. Ignored for video-only recordings.
    pub fn push_audio(&self, block: AudioBlock) -> bool {
        self.shared.push_audio(block)
    }

    pub fn stats(&self) -> RecordStats {
        self.shared.stats().clone()
    }

    /// Stops recording, encodes what is queued and finalizes the file.
    pub fn stop(mut self) -> Result<Recorded, RecordError> {
        self.finish()
    }

    fn finish(&mut self) -> Result<Recorded, RecordError> {
        lock(&self.shared.queue).stopping = true;
        self.shared.ready.notify_all();
        match self.worker.take() {
            Some(worker) => worker.join().map_err(|_| RecordError::Panicked)?,
            None => Err(RecordError::Panicked),
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        if self.worker.is_some() {
            let _ = self.finish();
        }
    }
}

/// Opens the first unused capture file name for exclusive writing.
fn create_capture_file(
    root: &RecordRoot,
    counter: u32,
    at: LocalTime,
) -> Result<(File, PathBuf), RecordError> {
    loop {
        let name = next_capture_filename(counter, at, |name| {
            let path = root.path_of(name);
            path.exists() || fmp4::finalizing_path(&path).exists()
        });
        let path = root.path_of(&name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            // Another instance took the name between the check and here.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
}

struct Worker {
    path: PathBuf,
    filename: String,
    fps: Rational,
    audio: Option<AudioFormat>,
    choice: VideoEncoderChoice,
    shared: Arc<Shared>,
}

/// The video stream once the first frame has opened an encoder.
struct Video {
    encoder: Box<dyn FrameEncoder>,
    clock: VideoClock,
    /// Grid slots of frames submitted to the encoder and not yet returned.
    in_flight: VecDeque<u64>,
    /// The last encoded frame, held until the next one gives its duration.
    pending: Option<(u64, EncodedFrame)>,
    written_slots: u64,
}

struct Audio {
    encoder: Box<dyn PcmEncoder>,
    format: AudioFormat,
    clock: AudioClock,
    packets: u64,
    pre_roll: VecDeque<AudioBlock>,
    pre_roll_frames: usize,
}

/// The MP4 once its header can be written, or samples waiting for it.
enum Output {
    Waiting {
        file: File,
        /// The audio track, when an AAC encoder opened.
        audio_track: Option<Track>,
        video: Vec<EncodedSample>,
        audio: Vec<EncodedSample>,
    },
    Writing(FragmentedWriter),
    Failed,
}

impl Worker {
    fn run(self, file: File) -> Result<Recorded, RecordError> {
        let mut audio = self.audio.and_then(|format| self.open_audio(format));
        let audio_track = audio.as_ref().map(|audio| Track {
            config: Mp4TrackConfig {
                encoder: encoder::encoder_config(
                    Codec::Aac,
                    audio.format.sample_rate,
                    audio.encoder.decoder_config(),
                ),
                format: Mp4TrackFormat::Audio {
                    channels: audio.format.channels,
                },
            },
            priming: audio.encoder.priming(),
        });
        let mut video: Option<Video> = None;
        let mut output = Output::Waiting {
            file,
            audio_track,
            video: Vec::new(),
            audio: Vec::new(),
        };
        let mut failed = false;
        while let Some(item) = self.shared.pop() {
            if failed {
                continue;
            }
            let result = match item {
                Item::Frame(frame) => self.on_frame(&frame, &mut video, &mut audio, &mut output),
                Item::Audio(block) => match (&mut audio, &video) {
                    (Some(audio), Some(video)) => self.on_audio(block, video, audio, &mut output),
                    (Some(audio), None) => {
                        audio.hold(block);
                        Ok(())
                    }
                    (None, _) => Ok(()),
                },
            };
            if let Err(error) = result {
                self.shared.stats().error = Some(error);
                failed = true;
            }
        }
        self.finish(video, audio, output)
    }

    fn open_audio(&self, format: AudioFormat) -> Option<Audio> {
        match encoder::open_audio(format.sample_rate, format.channels) {
            Ok(encoder) => {
                self.shared.stats().audio_encoder = Some(encoder.name());
                Some(Audio {
                    encoder,
                    format,
                    clock: AudioClock::new(format.sample_rate),
                    packets: 0,
                    pre_roll: VecDeque::new(),
                    pre_roll_frames: 0,
                })
            }
            Err(reason) => {
                let warning = format!("recording video only: no AAC encoder ({reason})");
                log(&warning);
                self.shared.stats().warnings.push(warning);
                None
            }
        }
    }

    fn on_frame(
        &self,
        frame: &Frame,
        video: &mut Option<Video>,
        audio: &mut Option<Audio>,
        output: &mut Output,
    ) -> Result<(), String> {
        // Encoders take pixels as they are, so turn portrait captures
        // upright here: the file then plays upright everywhere and its
        // dimensions are the displayed ones.
        let upright;
        let frame = if frame.rotation == Rotation::None {
            frame
        } else {
            upright = frame.upright();
            &upright
        };
        if video.is_none() {
            let (encoder, skipped) =
                encoder::open_video(frame.width, frame.height, self.fps, self.choice)
                    .map_err(|reasons| RecordError::NoEncoder(reasons.join("; ")).to_string())?;
            let mut stats = self.shared.stats();
            stats.video_encoder = Some(encoder.name());
            for reason in skipped {
                log(&format!("skipped video encoder: {reason}"));
                stats
                    .warnings
                    .push(format!("skipped video encoder: {reason}"));
            }
            drop(stats);
            log(&format!(
                "recording {} at {}x{} {} fps with {}",
                self.filename,
                encoder.dimensions().0,
                encoder.dimensions().1,
                self.fps,
                encoder.name()
            ));
            *video = Some(Video {
                encoder,
                clock: VideoClock::new(self.fps),
                in_flight: VecDeque::new(),
                pending: None,
                written_slots: 0,
            });
        }
        let video = video.as_mut().expect("opened above");
        let Some(slot) = video.clock.place(frame.pts) else {
            self.shared.stats().frames_skipped += 1;
            return Ok(());
        };
        let zero = video.clock.zero().expect("set by the first frame");
        video.in_flight.push_back(slot);
        let encoded = video.encoder.encode(frame)?;
        let mut queue = lock(&self.shared.queue);
        // Keep the start-up allowance until its backlog has drained.
        queue.warm |= queue.frames < FRAME_QUEUE;
        drop(queue);
        self.shared.stats().frame_clock = Some(FrameClock {
            host_time: frame.pts,
            file_sec: video.clock.slot_sec(slot),
        });
        self.on_encoded(video, encoded, false, output)?;
        // Audio that arrived before the first frame can be placed now.
        if let Some(audio) = audio {
            for block in std::mem::take(&mut audio.pre_roll) {
                self.encode_audio(block, zero, audio, output)?;
            }
            audio.pre_roll_frames = 0;
        }
        Ok(())
    }

    /// Turns encoder output into timed samples. The last frame is held
    /// until the next one gives its duration, or `last` ends the stream.
    fn on_encoded(
        &self,
        video: &mut Video,
        frames: Vec<EncodedFrame>,
        last: bool,
        output: &mut Output,
    ) -> Result<(), String> {
        for frame in frames {
            let mut slot = video
                .in_flight
                .pop_front()
                .ok_or("the video encoder returned more frames than it was given")?;
            if frame.data.is_empty() {
                // Dropped by the encoder: the frame before covers its slot.
                self.shared.stats().frames_dropped += 1;
                continue;
            }
            if video.pending.is_none() && video.written_slots == 0 {
                // The file starts at the first frame the encoder kept.
                slot = 0;
            }
            if let Some((previous, data)) = video.pending.replace((slot, frame)) {
                self.write_video(video, previous, slot, data, output)?;
            }
        }
        if last && let Some((slot, data)) = video.pending.take() {
            self.write_video(video, slot, slot + 1, data, output)?;
        }
        Ok(())
    }

    fn write_video(
        &self,
        video: &mut Video,
        slot: u64,
        next: u64,
        frame: EncodedFrame,
        output: &mut Output,
    ) -> Result<(), String> {
        let den = u64::from(self.fps.den);
        let sample = EncodedSample {
            data: frame.data,
            dts: (slot * den) as i64,
            pts: (slot * den) as i64,
            duration: u32::try_from((next - slot) * den).map_err(|_| "frame gap too long")?,
            is_sync: frame.is_sync,
            dependency: if frame.is_sync {
                SampleDependency::INDEPENDENT
            } else {
                SampleDependency::DEPENDENT
            },
        };
        video.written_slots = next;
        self.shared.stats().frames_written += 1;
        self.write(0, sample, Some(video), output)
    }

    fn on_audio(
        &self,
        block: AudioBlock,
        video: &Video,
        audio: &mut Audio,
        output: &mut Output,
    ) -> Result<(), String> {
        let zero = video.clock.zero().expect("set by the first frame");
        self.encode_audio(block, zero, audio, output)
    }

    fn encode_audio(
        &self,
        block: AudioBlock,
        zero: HostTime,
        audio: &mut Audio,
        output: &mut Output,
    ) -> Result<(), String> {
        let channels = usize::from(audio.format.channels);
        let frames = block.samples.len() / channels;
        let placement = audio.clock.place(zero, block.host_time, frames);
        {
            let mut stats = self.shared.stats();
            stats.audio_frames_inserted += placement.silence;
            stats.audio_frames_skipped += placement.skip as u64;
        }
        let mut pcm = vec![0.0; placement.silence as usize * channels];
        pcm.extend_from_slice(&block.samples[placement.skip * channels..frames * channels]);
        let packets = audio.encoder.encode(&pcm)?;
        for data in packets {
            self.write_audio(audio, data, output)?;
        }
        Ok(())
    }

    fn write_audio(
        &self,
        audio: &mut Audio,
        data: Vec<u8>,
        output: &mut Output,
    ) -> Result<(), String> {
        let dts = (audio.packets * u64::from(AAC_FRAME)) as i64;
        audio.packets += 1;
        let sample = EncodedSample {
            data,
            dts,
            pts: dts,
            duration: AAC_FRAME,
            is_sync: true,
            dependency: SampleDependency::INDEPENDENT,
        };
        self.write(1, sample, None, output)
    }

    /// Writes a sample, creating the file header once the video encoder's
    /// configuration is known, and flushing a fragment each second.
    fn write(
        &self,
        track: usize,
        sample: EncodedSample,
        video: Option<&Video>,
        output: &mut Output,
    ) -> Result<(), String> {
        match output {
            Output::Waiting {
                video: early_video,
                audio: early_audio,
                ..
            } => {
                if track == 0 {
                    early_video.push(sample);
                } else {
                    early_audio.push(sample);
                }
                let Some(video) = video else { return Ok(()) };
                let Some(config) = video.encoder.decoder_config() else {
                    if early_video.len() as u64
                        > 2 * FRAGMENT_SEC * u64::from(self.fps.num.div_ceil(self.fps.den))
                    {
                        return Err(format!(
                            "{} never reported its codec configuration",
                            video.encoder.name()
                        ));
                    }
                    return Ok(());
                };
                let Output::Waiting {
                    file,
                    audio_track,
                    video: early_video,
                    audio: early_audio,
                } = std::mem::replace(output, Output::Failed)
                else {
                    unreachable!()
                };
                let tracks = self.tracks(video, config, audio_track)?;
                let mut writer =
                    FragmentedWriter::create(file, tracks).map_err(|e| e.to_string())?;
                for sample in early_video {
                    writer.push(0, sample).map_err(|e| e.to_string())?;
                }
                if writer.tracks().len() > 1 {
                    for sample in early_audio {
                        writer.push(1, sample).map_err(|e| e.to_string())?;
                    }
                }
                *output = Output::Writing(writer);
                Ok(())
            }
            Output::Writing(writer) => {
                if track >= writer.tracks().len() {
                    return Ok(());
                }
                writer.push(track, sample).map_err(|e| e.to_string())?;
                // A fragment a second of either track, so audio still
                // reaches the disk if the camera goes away.
                let timescale = writer.tracks()[track].config.encoder.timescale;
                if writer.queued_ticks(track) >= FRAGMENT_SEC * u64::from(timescale) {
                    writer.flush_fragment().map_err(|e| e.to_string())?;
                }
                Ok(())
            }
            Output::Failed => Err("the capture file could not be written".to_string()),
        }
    }

    fn tracks(
        &self,
        video: &Video,
        decoder_config: Vec<u8>,
        audio: Option<Track>,
    ) -> Result<Vec<Track>, String> {
        let (width, height) = video.encoder.dimensions();
        let dimensions =
            VideoDimensions::new(width, height, &Limits::default()).map_err(|e| e.to_string())?;
        let video = Track {
            config: Mp4TrackConfig {
                encoder: encoder::encoder_config(
                    video.encoder.codec(),
                    self.fps.num,
                    decoder_config,
                ),
                format: Mp4TrackFormat::Video(dimensions),
            },
            priming: 0,
        };
        Ok(std::iter::once(video).chain(audio).collect())
    }

    fn finish(
        self,
        mut video: Option<Video>,
        mut audio: Option<Audio>,
        mut output: Output,
    ) -> Result<Recorded, RecordError> {
        let mut gapless = None;
        let error = self.shared.stats().error.clone();
        if error.is_none()
            && let Some(video) = &mut video
        {
            let result = video
                .encoder
                .finish()
                .and_then(|frames| self.on_encoded(video, frames, true, &mut output));
            if let Err(error) = result {
                self.shared.stats().error = Some(error);
            }
        }
        if let (Some(audio), Some(_)) = (&mut audio, &video) {
            match audio.encoder.finish() {
                Ok((packets, value)) => {
                    for data in packets {
                        if let Err(error) = self.write_audio(audio, data, &mut output) {
                            self.shared.stats().error = Some(error);
                            break;
                        }
                    }
                    // Padding is whatever the packets hold beyond the delay
                    // and the audio actually recorded. Encoders don't all
                    // report it consistently with what they emit.
                    let encoded = audio.packets * u64::from(AAC_FRAME);
                    let padding =
                        encoded.saturating_sub(u64::from(value.priming) + audio.clock.written());
                    gapless = Some(AudioGapless {
                        priming: value.priming,
                        padding: u32::try_from(padding).unwrap_or(u32::MAX),
                    });
                }
                Err(error) => self
                    .shared
                    .stats()
                    .warnings
                    .push(format!("AAC flush failed: {error}")),
            }
        }
        let stats = self.shared.stats().clone();
        let Some(video) = video else {
            drop(output);
            let _ = std::fs::remove_file(&self.path);
            return Err(stats
                .error
                .map_or(RecordError::NoFrames, RecordError::NoEncoder));
        };
        let Output::Writing(writer) = output else {
            drop(output);
            let _ = std::fs::remove_file(&self.path);
            return Err(RecordError::NoFrames);
        };
        let has_audio = writer.tracks().len() > 1;
        let written = writer.finish()?;
        let gapless: Vec<_> = gapless
            .filter(|_| has_audio)
            .map(|g| (1, g))
            .into_iter()
            .collect();
        if let Err(error) = fmp4::finalize(&self.path, &written, &gapless) {
            // The fragmented file is still complete and playable.
            let warning = format!("kept the fragmented file: finalizing failed: {error}");
            log(&warning);
            self.shared.stats().warnings.push(warning);
        }
        let (width, height) = video.encoder.dimensions();
        Ok(Recorded {
            filename: self.filename.clone(),
            dimensions: (width, height),
            fps: self.fps,
            duration_sec: video.clock.slot_sec(video.written_slots),
            codec: match video.encoder.codec() {
                Codec::Av1 => "av1",
                _ => "hevc",
            },
            has_audio,
            zero: video.clock.zero().unwrap_or_default(),
            stats: self.shared.stats().clone(),
        })
    }
}

impl Audio {
    /// Keeps a block until file time zero is known, dropping the oldest
    /// beyond the pre-roll limit.
    fn hold(&mut self, block: AudioBlock) {
        let channels = usize::from(self.format.channels);
        self.pre_roll_frames += block.samples.len() / channels;
        self.pre_roll.push_back(block);
        let limit = (f64::from(self.format.sample_rate) * PRE_ROLL_SEC) as usize;
        while self.pre_roll_frames > limit {
            let Some(old) = self.pre_roll.pop_front() else {
                break;
            };
            self.pre_roll_frames -= old.samples.len() / channels;
        }
    }
}

/// Drives a zvidlib future to completion. zvidlib's native codecs and our
/// file sink finish their futures without waiting on anything.
pub(crate) fn block_on<T>(future: impl Future<Output = T>) -> T {
    let mut context = Context::from_waker(Waker::noop());
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::yield_now();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Logs to stderr and, when `ZVID_DAW_LOG` names a file, appends there too,
/// as the format layers do.
fn log(message: &str) {
    use std::io::Write;
    let line = format!("[zvid-record] {message}\n");
    let _ = io::stderr().write_all(line.as_bytes());
    if let Some(path) = std::env::var_os("ZVID_DAW_LOG")
        && let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests;
