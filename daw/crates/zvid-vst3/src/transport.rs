//! Transport snapshots taken in `process()` and the changes the control
//! thread reads from them.

use std::sync::OnceLock;
use std::time::Instant;

use zvid_daw_core::TransportSnapshot;

use crate::abi::{ProcessContext, context};

/// Tempo and meter assumed when the host leaves them unset.
const DEFAULT_TEMPO: f64 = 120.0;
const DEFAULT_TIME_SIGNATURE: [u32; 2] = [4, 4];

/// Seconds on the plugin's monotonic clock. Reading it never allocates or
/// blocks, so `process()` may call it.
pub fn now_sec() -> f64 {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    EPOCH.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// The `ProcessContext` fields ZVID Capture reads, copied out of one
/// `process()` call. Small and `Copy` so it fits the SPSC ring.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ProcessSnapshot {
    /// Counts `process()` calls, so the reader can tell adjacent blocks
    /// from gaps left by dropped snapshots.
    pub block: u64,
    pub num_samples: i32,
    /// `ProcessContext::state` flags.
    pub state: u32,
    pub sample_rate: f64,
    pub project_time_samples: i64,
    pub project_time_music: f64,
    pub tempo: f64,
    pub time_signature: [u32; 2],
    /// Host system time in nanoseconds, when `kSystemTimeValid`.
    pub system_time_ns: Option<i64>,
    /// [`now_sec`] when the block started.
    pub host_time: f64,
}

impl ProcessSnapshot {
    pub fn new(context: &ProcessContext, block: u64, num_samples: i32, host_time: f64) -> Self {
        let has = |flag| context.state & flag != 0;
        let time_signature = if has(context::TIME_SIG_VALID)
            && context.time_sig_numerator > 0
            && context.time_sig_denominator > 0
        {
            [
                context.time_sig_numerator as u32,
                context.time_sig_denominator as u32,
            ]
        } else {
            DEFAULT_TIME_SIGNATURE
        };
        let tempo = if has(context::TEMPO_VALID) && context.tempo > 0.0 {
            context.tempo
        } else {
            DEFAULT_TEMPO
        };
        let project_time_music = if has(context::PROJECT_TIME_MUSIC_VALID) {
            context.project_time_music
        } else {
            context.project_time_samples as f64 / context.sample_rate.max(1.0) * tempo / 60.0
        };
        Self {
            block,
            num_samples,
            state: context.state,
            sample_rate: context.sample_rate,
            project_time_samples: context.project_time_samples,
            project_time_music,
            tempo,
            time_signature,
            system_time_ns: has(context::SYSTEM_TIME_VALID).then_some(context.system_time),
            host_time,
        }
    }

    pub fn playing(&self) -> bool {
        self.state & context::PLAYING != 0
    }

    pub fn recording(&self) -> bool {
        self.state & context::RECORDING != 0
    }

    pub fn cycle_active(&self) -> bool {
        self.state & context::CYCLE_ACTIVE != 0
    }

    /// Song position in seconds.
    pub fn song_sec(&self) -> f64 {
        self.project_time_samples as f64 / self.sample_rate.max(1.0)
    }

    /// The snapshot the [`zvid_daw_core::TakeTracker`] consumes.
    pub fn to_tracker(&self) -> TransportSnapshot {
        TransportSnapshot {
            playing: self.playing(),
            beats: self.project_time_music,
            song_sec: self.song_sec(),
            tempo: self.tempo,
            time_signature: self.time_signature,
            host_time: self.host_time,
        }
    }
}

/// A transport change worth logging.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Play,
    Stop,
    /// The position jumped: the user moved the playhead.
    Locate,
    /// The position jumped backwards while the loop was on.
    Loop,
    /// `kRecording` turned on or off.
    Record(bool),
}

impl Change {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Play => "play",
            Self::Stop => "stop",
            Self::Locate => "locate",
            Self::Loop => "loop",
            Self::Record(true) => "record-on",
            Self::Record(false) => "record-off",
        }
    }
}

/// Finds [`Change`]s between consecutive snapshots.
#[derive(Clone, Debug, Default)]
pub struct TransportWatch {
    last: Option<ProcessSnapshot>,
}

impl TransportWatch {
    pub fn observe(&mut self, snapshot: ProcessSnapshot) -> Vec<Change> {
        let mut changes = Vec::new();
        let Some(last) = self.last.replace(snapshot) else {
            if snapshot.playing() {
                changes.push(Change::Play);
            }
            if snapshot.recording() {
                changes.push(Change::Record(true));
            }
            return changes;
        };
        match (last.playing(), snapshot.playing()) {
            (false, true) => changes.push(Change::Play),
            (true, false) => changes.push(Change::Stop),
            (true, true) => {
                // Only adjacent blocks say where the playhead should be now;
                // after a gap from dropped snapshots, don't guess.
                let adjacent = snapshot.block == last.block + 1;
                let expected = last.project_time_samples + i64::from(last.num_samples);
                if adjacent && snapshot.project_time_samples != expected {
                    let wrapped = snapshot.project_time_samples < last.project_time_samples;
                    changes.push(if snapshot.cycle_active() && wrapped {
                        Change::Loop
                    } else {
                        Change::Locate
                    });
                }
            }
            (false, false) => {
                if snapshot.project_time_samples != last.project_time_samples {
                    changes.push(Change::Locate);
                }
            }
        }
        if snapshot.recording() != last.recording() {
            changes.push(Change::Record(snapshot.recording()));
        }
        changes
    }
}

/// One log line describing `change` at `snapshot`.
pub fn describe(change: Change, snapshot: &ProcessSnapshot) -> String {
    let system_time = snapshot
        .system_time_ns
        .map_or_else(|| "-".to_string(), |ns| ns.to_string());
    format!(
        "{} at {:.6} s ({:.4} beats, {} samples @ {} Hz, {:.2} bpm, {}/{}) \
         playing={} recording={} cycle={} block={} host={:.6} system_time_ns={}",
        change.label(),
        snapshot.song_sec(),
        snapshot.project_time_music,
        snapshot.project_time_samples,
        snapshot.sample_rate,
        snapshot.tempo,
        snapshot.time_signature[0],
        snapshot.time_signature[1],
        snapshot.playing(),
        snapshot.recording(),
        snapshot.cycle_active(),
        snapshot.block,
        snapshot.host_time,
        system_time,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOCK: i32 = 512;

    fn snapshot(block: u64, state: u32, position: i64) -> ProcessSnapshot {
        let context = ProcessContext {
            state: state | context::TEMPO_VALID | context::TIME_SIG_VALID,
            sample_rate: 48_000.0,
            project_time_samples: position,
            tempo: 90.0,
            time_sig_numerator: 3,
            time_sig_denominator: 4,
            ..ProcessContext::default()
        };
        ProcessSnapshot::new(&context, block, BLOCK, block as f64 * 0.01)
    }

    #[test]
    fn reads_the_process_context() {
        let snap = snapshot(1, context::PLAYING | context::RECORDING, 96_000);
        assert!(snap.playing());
        assert!(snap.recording());
        assert!(!snap.cycle_active());
        assert_eq!(snap.song_sec(), 2.0);
        // No musical time from the host: derived from seconds and tempo.
        assert_eq!(snap.project_time_music, 3.0);
        assert_eq!(snap.system_time_ns, None);
        let tracker = snap.to_tracker();
        assert!(tracker.playing);
        assert_eq!(tracker.beats, 3.0);
        assert_eq!(tracker.song_sec, 2.0);
        assert_eq!(tracker.tempo, 90.0);
        assert_eq!(tracker.time_signature, [3, 4]);
        assert_eq!(tracker.host_time, 0.01);
    }

    #[test]
    fn falls_back_when_fields_are_invalid() {
        let context = ProcessContext {
            state: context::SYSTEM_TIME_VALID | context::PROJECT_TIME_MUSIC_VALID,
            sample_rate: 44_100.0,
            project_time_music: 8.5,
            system_time: 42,
            tempo: 150.0,
            ..ProcessContext::default()
        };
        let snap = ProcessSnapshot::new(&context, 1, BLOCK, 0.0);
        assert_eq!(snap.tempo, DEFAULT_TEMPO);
        assert_eq!(snap.time_signature, DEFAULT_TIME_SIGNATURE);
        assert_eq!(snap.project_time_music, 8.5);
        assert_eq!(snap.system_time_ns, Some(42));
    }

    #[test]
    fn detects_play_stop_locate_loop_and_record() {
        let play = context::PLAYING;
        let mut watch = TransportWatch::default();
        assert_eq!(watch.observe(snapshot(1, 0, 0)), []);
        assert_eq!(watch.observe(snapshot(2, 0, 0)), []);
        assert_eq!(watch.observe(snapshot(3, 0, 48_000)), [Change::Locate]);
        assert_eq!(watch.observe(snapshot(4, play, 48_000)), [Change::Play]);
        let next = 48_000 + i64::from(BLOCK);
        assert_eq!(watch.observe(snapshot(5, play, next)), []);
        assert_eq!(
            watch.observe(snapshot(6, play, 1_000_000)),
            [Change::Locate]
        );
        let cycling = play | context::CYCLE_ACTIVE;
        assert_eq!(watch.observe(snapshot(7, cycling, 1_000_512)), []);
        assert_eq!(watch.observe(snapshot(8, cycling, 0)), [Change::Loop]);
        // A forward jump with the loop on is still a locate.
        assert_eq!(
            watch.observe(snapshot(9, cycling, 2_000_000)),
            [Change::Locate]
        );
        // A gap in block numbers means dropped snapshots, not a jump.
        assert_eq!(watch.observe(snapshot(20, cycling, 9_000_000)), []);
        let recording = cycling | context::RECORDING;
        assert_eq!(
            watch.observe(snapshot(21, recording, 9_000_512)),
            [Change::Record(true)]
        );
        assert_eq!(
            watch.observe(snapshot(22, 0, 9_001_024)),
            [Change::Stop, Change::Record(false)]
        );
    }

    #[test]
    fn first_snapshot_reports_a_running_transport() {
        let mut watch = TransportWatch::default();
        assert_eq!(
            watch.observe(snapshot(1, context::PLAYING | context::RECORDING, 0)),
            [Change::Play, Change::Record(true)]
        );
    }

    #[test]
    fn describes_changes() {
        let line = describe(Change::Play, &snapshot(4, context::PLAYING, 96_000));
        assert!(line.starts_with("play at 2.000000 s (3.0000 beats, 96000 samples @ 48000 Hz"));
        assert!(line.contains("90.00 bpm, 3/4"));
        assert!(line.contains("recording=false"));
        assert!(line.ends_with("system_time_ns=-"));
    }

    #[test]
    fn clock_is_monotonic() {
        let first = now_sec();
        assert!(now_sec() >= first);
    }
}
