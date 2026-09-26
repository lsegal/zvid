//! Transport-following take tracker.
//!
//! While a capture is armed, every span of transport playback becomes a take:
//! a slice of the capture file anchored to the transport position where play
//! started. The tracker is a pure state machine fed from the control thread;
//! all times are seconds on one monotonic host clock.

/// How far the transport may drift from its expected position between two
/// snapshots before the change is treated as a jump (loop wrap or locate).
pub const JUMP_TOLERANCE_SEC: f64 = 0.05;

/// A transport snapshot from the host's process callback.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransportSnapshot {
    pub playing: bool,
    /// Song position in quarter-note beats.
    pub beats: f64,
    /// Song position in seconds.
    pub song_sec: f64,
    pub tempo: f64,
    pub time_signature: [u32; 2],
    /// Host clock time the snapshot describes.
    pub host_time: f64,
}

/// Inputs to [`TakeTracker::handle`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Input {
    /// Capture armed at a host time; the capture file starts here.
    Arm {
        at: f64,
    },
    /// Capture disarmed at a host time; the capture file ends here.
    Disarm {
        at: f64,
    },
    Transport(TransportSnapshot),
    /// A captured frame at `host_time` was written at `file_sec` in the
    /// capture file. Refines the host-to-file clock mapping.
    FrameClock {
        host_time: f64,
        file_sec: f64,
    },
}

/// Transport position a take is anchored to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub transport_start_sec: f64,
    pub transport_start_beats: f64,
    pub tempo: f64,
    pub time_signature: [u32; 2],
}

/// One take: a slice of the capture file.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Take {
    /// Zero-based take number within the tracker's lifetime.
    pub index: u32,
    /// Seconds into the capture file where the take starts.
    pub file_offset_sec: f64,
    /// Where the take sits on the transport, or `None` for a capture that
    /// never saw playback.
    pub anchor: Option<Anchor>,
    /// Take length in seconds; 0 until the take is closed.
    pub duration_sec: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    TakeOpened(Take),
    TakeClosed(Take),
}

#[derive(Clone, Copy, Debug)]
struct Armed {
    at: f64,
    /// Latest `(host_time, file_sec)` frame clock pair.
    clock: Option<(f64, f64)>,
    takes: u32,
}

/// Turns arm, transport and frame-clock inputs into take events.
#[derive(Clone, Debug, Default)]
pub struct TakeTracker {
    armed: Option<Armed>,
    last: Option<TransportSnapshot>,
    open: Option<Take>,
    next_index: u32,
}

impl TakeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_armed(&self) -> bool {
        self.armed.is_some()
    }

    /// The take currently being recorded, if any.
    pub fn open_take(&self) -> Option<&Take> {
        self.open.as_ref()
    }

    /// The open take with its duration running up to host time `at`.
    pub fn open_take_until(&self, at: f64) -> Option<Take> {
        self.open.map(|take| Take {
            duration_sec: (self.file_time(at) - take.file_offset_sec).max(0.0),
            ..take
        })
    }

    pub fn handle(&mut self, input: Input) -> Vec<Event> {
        let mut events = Vec::new();
        match input {
            Input::Arm { at } => {
                if self.armed.is_some() {
                    return events;
                }
                self.armed = Some(Armed {
                    at,
                    clock: None,
                    takes: 0,
                });
                // Arming while the transport already plays starts a take at
                // arm, anchored where the transport is at that moment.
                if let Some(last) = self.last.filter(|last| last.playing) {
                    let elapsed = (at - last.host_time).max(0.0);
                    let anchor = Anchor {
                        transport_start_sec: last.song_sec + elapsed,
                        transport_start_beats: last.beats + elapsed * last.tempo / 60.0,
                        tempo: last.tempo,
                        time_signature: last.time_signature,
                    };
                    self.start_take(self.file_time(at), Some(anchor), &mut events);
                }
            }
            Input::Disarm { at } => {
                let Some(armed) = self.armed else {
                    return events;
                };
                self.finish_take(at, &mut events);
                if armed.takes == 0 {
                    // A capture that never saw playback becomes one
                    // unanchored entry covering the whole file.
                    self.start_take(0.0, None, &mut events);
                    self.finish_take(at, &mut events);
                }
                self.armed = None;
            }
            Input::Transport(snapshot) => {
                let previous = self.last.replace(snapshot);
                if self.armed.is_none() {
                    return events;
                }
                if !snapshot.playing {
                    self.finish_take(snapshot.host_time, &mut events);
                    return events;
                }
                let jumped = match (self.open, previous) {
                    (Some(_), Some(previous)) => {
                        let expected =
                            previous.song_sec + (snapshot.host_time - previous.host_time);
                        (snapshot.song_sec - expected).abs() > JUMP_TOLERANCE_SEC
                    }
                    _ => false,
                };
                if jumped {
                    self.finish_take(snapshot.host_time, &mut events);
                }
                if self.open.is_none() {
                    let anchor = Anchor {
                        transport_start_sec: snapshot.song_sec,
                        transport_start_beats: snapshot.beats,
                        tempo: snapshot.tempo,
                        time_signature: snapshot.time_signature,
                    };
                    self.start_take(
                        self.file_time(snapshot.host_time),
                        Some(anchor),
                        &mut events,
                    );
                }
            }
            Input::FrameClock {
                host_time,
                file_sec,
            } => {
                if let Some(armed) = self.armed.as_mut() {
                    armed.clock = Some((host_time, file_sec));
                }
            }
        }
        events
    }

    /// Seconds into the capture file at host time `at`.
    fn file_time(&self, at: f64) -> f64 {
        let Some(armed) = self.armed else {
            return 0.0;
        };
        let time = match armed.clock {
            Some((host_time, file_sec)) => file_sec + (at - host_time),
            None => at - armed.at,
        };
        time.max(0.0)
    }

    fn start_take(
        &mut self,
        file_offset_sec: f64,
        anchor: Option<Anchor>,
        events: &mut Vec<Event>,
    ) {
        let take = Take {
            index: self.next_index,
            file_offset_sec,
            anchor,
            duration_sec: 0.0,
        };
        self.next_index += 1;
        if let Some(armed) = self.armed.as_mut() {
            armed.takes += 1;
        }
        self.open = Some(take);
        events.push(Event::TakeOpened(take));
    }

    fn finish_take(&mut self, at: f64, events: &mut Vec<Event>) {
        let end = self.file_time(at);
        if let Some(mut take) = self.open.take() {
            take.duration_sec = (end - take.file_offset_sec).max(0.0);
            events.push(Event::TakeClosed(take));
        }
    }
}

#[cfg(test)]
mod tests;
