//! Transport snapshots the audio thread takes each process or render call,
//! and the changes the control thread reads from them. Shared by the VST3
//! and AU format layers so both report the transport the same way.

use std::collections::VecDeque;
use std::sync::mpsc::Receiver;
use std::sync::{Mutex, MutexGuard};

use crate::ring::Consumer;
use crate::state::State;
use crate::takes::{Command, TakeLog};
use crate::tracker::TransportSnapshot;

/// The host transport as seen by one process or render call. Small and
/// `Copy` so it fits the SPSC ring.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ProcessSnapshot {
    /// Counts process calls, so the reader can tell adjacent blocks from
    /// gaps left by dropped snapshots or calls without a transport.
    pub block: u64,
    pub num_samples: u32,
    pub playing: bool,
    pub recording: bool,
    /// The host's loop is on.
    pub cycle_active: bool,
    pub sample_rate: f64,
    pub project_time_samples: i64,
    /// Song position in quarter-note beats.
    pub project_time_music: f64,
    pub tempo: f64,
    pub time_signature: [u32; 2],
    /// Host system time in nanoseconds, when the host reports one.
    pub system_time_ns: Option<i64>,
    /// Host clock time when the block started.
    pub host_time: f64,
}

impl ProcessSnapshot {
    /// Song position in seconds.
    pub fn song_sec(&self) -> f64 {
        self.project_time_samples as f64 / self.sample_rate.max(1.0)
    }

    /// The snapshot the [`TakeTracker`] consumes.
    pub fn to_tracker(&self) -> TransportSnapshot {
        TransportSnapshot {
            playing: self.playing,
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
    /// Recording turned on or off.
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
            if snapshot.playing {
                changes.push(Change::Play);
            }
            if snapshot.recording {
                changes.push(Change::Record(true));
            }
            return changes;
        };
        match (last.playing, snapshot.playing) {
            (false, true) => changes.push(Change::Play),
            (true, false) => changes.push(Change::Stop),
            (true, true) => {
                // Only adjacent blocks say where the playhead should be now;
                // after a gap from dropped snapshots, don't guess.
                let adjacent = snapshot.block == last.block + 1;
                let expected = last.project_time_samples + i64::from(last.num_samples);
                if adjacent && snapshot.project_time_samples != expected {
                    let wrapped = snapshot.project_time_samples < last.project_time_samples;
                    changes.push(if snapshot.cycle_active && wrapped {
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
        if snapshot.recording != last.recording {
            changes.push(Change::Record(snapshot.recording));
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
        snapshot.playing,
        snapshot.recording,
        snapshot.cycle_active,
        snapshot.block,
        snapshot.host_time,
        system_time,
    )
}

/// What a control thread keeps between drains of the transport ring.
#[derive(Clone, Debug, Default)]
pub struct TransportFollower {
    watch: TransportWatch,
    takes: TakeLog,
    dropped: u64,
}

impl TransportFollower {
    /// Feeds queued snapshots and capture commands to the take log in host
    /// time order, so the log keeps the recordings in `state` in step with
    /// the takes. Passes a log line for every transport change, take event
    /// and newly dropped batch to `log`.
    ///
    /// Returns `true` when a take opened or closed, so the caller can tell
    /// the host that the state changed.
    pub fn drain(
        &mut self,
        transport: &mut Consumer<ProcessSnapshot>,
        commands: &Receiver<Command>,
        state: &Mutex<State>,
        mut log: impl FnMut(&str),
    ) -> bool {
        let mut pending: VecDeque<Command> = commands.try_iter().collect();
        let mut changed = false;
        let command = |takes: &mut TakeLog, command: Command, log: &mut dyn FnMut(&str)| {
            let events = takes.command(command, &mut lock(state));
            for event in &events {
                log(&format!("{event:?}"));
            }
            !events.is_empty()
        };
        while let Some(snapshot) = transport.pop() {
            while let Some(next) = pending.pop_front_if(|next| next.at() <= snapshot.host_time) {
                changed |= command(&mut self.takes, next, &mut log);
            }
            for change in self.watch.observe(snapshot) {
                log(&describe(change, &snapshot));
            }
            let events = self
                .takes
                .transport(snapshot.to_tracker(), &mut lock(state));
            for event in &events {
                log(&format!("{event:?}"));
            }
            changed |= !events.is_empty();
        }
        for next in pending {
            changed |= command(&mut self.takes, next, &mut log);
        }
        let total = transport.dropped();
        if total != self.dropped {
            log(&format!(
                "dropped {} transport snapshots",
                total - self.dropped
            ));
            self.dropped = total;
        }
        changed
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::*;
    use crate::ring::ring;
    use crate::takes::Capture;

    const BLOCK: u32 = 512;
    const PLAY: u8 = 1;
    const RECORD: u8 = 2;
    const CYCLE: u8 = 4;

    fn snapshot(block: u64, flags: u8, position: i64) -> ProcessSnapshot {
        ProcessSnapshot {
            block,
            num_samples: BLOCK,
            playing: flags & PLAY != 0,
            recording: flags & RECORD != 0,
            cycle_active: flags & CYCLE != 0,
            sample_rate: 48_000.0,
            project_time_samples: position,
            project_time_music: position as f64 / 48_000.0 * 1.5,
            tempo: 90.0,
            time_signature: [3, 4],
            system_time_ns: None,
            host_time: block as f64 * 0.01,
        }
    }

    #[test]
    fn converts_for_the_tracker() {
        let snap = snapshot(1, PLAY | RECORD, 96_000);
        assert_eq!(snap.song_sec(), 2.0);
        assert_eq!(
            snap.to_tracker(),
            TransportSnapshot {
                playing: true,
                beats: 3.0,
                song_sec: 2.0,
                tempo: 90.0,
                time_signature: [3, 4],
                host_time: 0.01,
            }
        );
    }

    #[test]
    fn detects_play_stop_locate_loop_and_record() {
        let mut watch = TransportWatch::default();
        assert_eq!(watch.observe(snapshot(1, 0, 0)), []);
        assert_eq!(watch.observe(snapshot(2, 0, 0)), []);
        assert_eq!(watch.observe(snapshot(3, 0, 48_000)), [Change::Locate]);
        assert_eq!(watch.observe(snapshot(4, PLAY, 48_000)), [Change::Play]);
        let next = 48_000 + i64::from(BLOCK);
        assert_eq!(watch.observe(snapshot(5, PLAY, next)), []);
        assert_eq!(
            watch.observe(snapshot(6, PLAY, 1_000_000)),
            [Change::Locate]
        );
        let cycling = PLAY | CYCLE;
        assert_eq!(watch.observe(snapshot(7, cycling, 1_000_512)), []);
        assert_eq!(watch.observe(snapshot(8, cycling, 0)), [Change::Loop]);
        // A forward jump with the loop on is still a locate.
        assert_eq!(
            watch.observe(snapshot(9, cycling, 2_000_000)),
            [Change::Locate]
        );
        // A gap in block numbers means dropped snapshots, not a jump.
        assert_eq!(watch.observe(snapshot(20, cycling, 9_000_000)), []);
        assert_eq!(
            watch.observe(snapshot(21, cycling | RECORD, 9_000_512)),
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
            watch.observe(snapshot(1, PLAY | RECORD, 0)),
            [Change::Play, Change::Record(true)]
        );
    }

    #[test]
    fn describes_changes() {
        let line = describe(Change::Play, &snapshot(4, PLAY, 96_000));
        assert!(line.starts_with("play at 2.000000 s (3.0000 beats, 96000 samples @ 48000 Hz"));
        assert!(line.contains("90.00 bpm, 3/4"));
        assert!(line.contains("recording=false"));
        assert!(line.contains("block=4 host=0.040000"));
        assert!(line.ends_with("system_time_ns=-"));
        let timed = ProcessSnapshot {
            system_time_ns: Some(42),
            ..snapshot(4, 0, 0)
        };
        assert!(describe(Change::Stop, &timed).ends_with("system_time_ns=42"));
    }

    #[test]
    fn follower_logs_changes_takes_and_drops() {
        let (mut producer, mut consumer) = ring(2);
        let (_sender, commands) = mpsc::channel();
        let state = Mutex::new(State::default());
        let mut follower = TransportFollower::default();
        let mut lines = Vec::new();
        follower.drain(&mut consumer, &commands, &state, |line| {
            lines.push(line.to_string())
        });
        assert!(lines.is_empty());

        producer.push(snapshot(1, 0, 0));
        producer.push(snapshot(2, PLAY, 0));
        // The ring is full: this one is dropped.
        producer.push(snapshot(3, PLAY, 512));
        let changed = follower.drain(&mut consumer, &commands, &state, |line| {
            lines.push(line.to_string())
        });
        // Not armed, so no take.
        assert!(!changed);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("play at 0.000000 s"));
        assert_eq!(lines[1], "dropped 1 transport snapshots");
        assert_eq!(consumer.pop(), None);

        // Drops are reported once.
        lines.clear();
        producer.push(snapshot(4, 0, 1_024));
        follower.drain(&mut consumer, &commands, &state, |line| {
            lines.push(line.to_string())
        });
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("stop at "));
    }

    #[test]
    fn follower_records_takes_into_the_state() {
        let (mut producer, mut consumer) = ring(16);
        let (sender, commands) = mpsc::channel();
        let state = Mutex::new(State::default());
        let mut follower = TransportFollower::default();
        let drain = |follower: &mut TransportFollower, consumer: &mut Consumer<_>| {
            follower.drain(consumer, &commands, &state, |_| {})
        };

        sender
            .send(Command::Arm {
                capture: Capture {
                    filename: "video-01-9-25-20-36-12-0.mp4".to_string(),
                    dimensions: [1280, 720],
                    fps: [30, 1],
                    camera: "Cam".to_string(),
                    created_at: "2026-09-25T20:36:12Z".to_string(),
                },
                at: 0.0,
            })
            .unwrap();
        assert!(!drain(&mut follower, &mut consumer));
        // Snapshot `n` is at host time `n / 100` s.
        producer.push(snapshot(10, PLAY, 96_000));
        assert!(drain(&mut follower, &mut consumer));
        producer.push(snapshot(11, PLAY, 96_512));
        assert!(!drain(&mut follower, &mut consumer));
        producer.push(snapshot(12, 0, 97_024));
        assert!(drain(&mut follower, &mut consumer));
        sender.send(Command::Disarm { at: 0.2 }).unwrap();
        assert!(!drain(&mut follower, &mut consumer));

        let state = state.lock().unwrap();
        assert_eq!(state.recordings.len(), 1);
        let take = &state.recordings[0];
        assert_eq!(take.transport_start_sec, Some(2.0));
        assert!((take.file_offset_sec - 0.1).abs() < 1e-9);
        assert!((take.duration_sec - 0.02).abs() < 1e-9);
    }

    #[test]
    fn follower_applies_commands_and_snapshots_in_host_time_order() {
        let (mut producer, mut consumer) = ring(16);
        let (sender, commands) = mpsc::channel();
        let state = Mutex::new(State::default());
        let mut follower = TransportFollower::default();
        // Play starts at host time 0.1 s; the arm at 0.05 s reaches the
        // control thread after the snapshot is queued.
        producer.push(snapshot(10, PLAY, 96_000));
        sender
            .send(Command::Arm {
                capture: Capture {
                    filename: "video-01-9-25-20-36-12-0.mp4".to_string(),
                    dimensions: [1280, 720],
                    fps: [30, 1],
                    camera: "Cam".to_string(),
                    created_at: "2026-09-25T20:36:12Z".to_string(),
                },
                at: 0.05,
            })
            .unwrap();
        assert!(follower.drain(&mut consumer, &commands, &state, |_| {}));
        let state = state.lock().unwrap();
        // The take opens at the play edge, not at arm.
        assert_eq!(state.recordings[0].transport_start_sec, Some(2.0));
        assert!((state.recordings[0].file_offset_sec - 0.05).abs() < 1e-9);
    }
}
