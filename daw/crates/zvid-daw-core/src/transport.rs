//! Transport snapshots the audio thread takes each process or render call,
//! and the changes the control thread reads from them. Shared by the VST3
//! and AU format layers so both report the transport the same way.

use crate::ring::Consumer;
use crate::tracker::{Input, TakeTracker, TransportSnapshot};

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
    tracker: TakeTracker,
    dropped: u64,
}

impl TransportFollower {
    /// Feeds queued snapshots to the take tracker and passes a log line for
    /// every transport change, take event and newly dropped batch to `log`.
    pub fn drain(&mut self, transport: &mut Consumer<ProcessSnapshot>, mut log: impl FnMut(&str)) {
        while let Some(snapshot) = transport.pop() {
            for change in self.watch.observe(snapshot) {
                log(&describe(change, &snapshot));
            }
            for event in self.tracker.handle(Input::Transport(snapshot.to_tracker())) {
                log(&format!("{event:?}"));
            }
        }
        let total = transport.dropped();
        if total != self.dropped {
            log(&format!(
                "dropped {} transport snapshots",
                total - self.dropped
            ));
            self.dropped = total;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ring::ring;

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
        let mut follower = TransportFollower::default();
        let mut lines = Vec::new();
        follower.drain(&mut consumer, |line| lines.push(line.to_string()));
        assert!(lines.is_empty());

        producer.push(snapshot(1, 0, 0));
        producer.push(snapshot(2, PLAY, 0));
        // The ring is full: this one is dropped.
        producer.push(snapshot(3, PLAY, 512));
        follower.drain(&mut consumer, |line| lines.push(line.to_string()));
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("play at 0.000000 s"));
        assert_eq!(lines[1], "dropped 1 transport snapshots");
        assert_eq!(consumer.pop(), None);

        // Drops are reported once.
        lines.clear();
        producer.push(snapshot(4, 0, 1_024));
        follower.drain(&mut consumer, |line| lines.push(line.to_string()));
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("stop at "));
    }
}
