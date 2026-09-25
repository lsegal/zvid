//! Keeps the plugin state's `recordings` in step with the take tracker.
//!
//! The control thread feeds a [`TakeLog`] the transport snapshots from the
//! audio thread and the [`Command`]s the capture layer sends when it arms,
//! disarms and writes frames. Every take becomes a [`Recording`] in the
//! state as soon as it opens, so a set saved mid-take still lists it, and
//! the recording's duration keeps running until the take closes.

use crate::state::{Recording, RecordingMeta, State};
use crate::tracker::{Event, Input, Take, TakeTracker, TransportSnapshot};

/// The capture file an arm records to. Every take of that capture shares
/// these details.
#[derive(Clone, Debug, PartialEq)]
pub struct Capture {
    /// File name relative to the record root.
    pub filename: String,
    /// `[width, height]` in pixels.
    pub dimensions: [u32; 2],
    /// Frame rate as a `[numerator, denominator]` fraction.
    pub fps: [u32; 2],
    pub camera: String,
    /// RFC 3339 UTC timestamp of the arm.
    pub created_at: String,
}

/// What the capture layer tells the control thread. Times are seconds on
/// the host clock ([`crate::clock::now_sec`]).
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Capture started recording to `capture`, whose file time zero is
    /// host time `at` until frame clocks refine it.
    Arm { capture: Capture, at: f64 },
    /// Capture stopped at host time `at`.
    Disarm { at: f64 },
    /// The frame captured at `host_time` was written at `file_sec` in the
    /// capture file.
    FrameClock { host_time: f64, file_sec: f64 },
}

impl Command {
    /// The host time the command applies at.
    pub fn at(&self) -> f64 {
        match *self {
            Self::Arm { at, .. } | Self::Disarm { at } => at,
            Self::FrameClock { host_time, .. } => host_time,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TakeLog {
    tracker: TakeTracker,
    capture: Option<Capture>,
    /// Takes opened in the current capture, for take IDs.
    takes: u32,
    /// State entry of the open take.
    open: Option<String>,
}

impl TakeLog {
    pub fn is_armed(&self) -> bool {
        self.tracker.is_armed()
    }

    /// Applies a capture-layer command. Returns the take events it caused;
    /// each one added or finished a recording in `state`.
    pub fn command(&mut self, command: Command, state: &mut State) -> Vec<Event> {
        let input = match command {
            Command::Arm { capture, at } => {
                if self.is_armed() {
                    return Vec::new();
                }
                self.capture = Some(capture);
                self.takes = 0;
                Input::Arm { at }
            }
            Command::Disarm { at } => Input::Disarm { at },
            Command::FrameClock {
                host_time,
                file_sec,
            } => Input::FrameClock {
                host_time,
                file_sec,
            },
        };
        let events = self.apply(input, state);
        if !self.is_armed() {
            self.capture = None;
        }
        events
    }

    /// Applies a transport snapshot. Returns the take events it caused, as
    /// [`TakeLog::command`] does, and brings the open take's duration up to
    /// the snapshot either way.
    pub fn transport(&mut self, snapshot: TransportSnapshot, state: &mut State) -> Vec<Event> {
        let events = self.apply(Input::Transport(snapshot), state);
        if let Some(take) = self.tracker.open_take_until(snapshot.host_time)
            && let Some(recording) = self.open_recording(state)
        {
            recording.duration_sec = take.duration_sec;
        }
        events
    }

    fn apply(&mut self, input: Input, state: &mut State) -> Vec<Event> {
        let events = self.tracker.handle(input);
        for event in &events {
            match event {
                Event::TakeOpened(take) => {
                    let Some(recording) = self.recording(take) else {
                        continue;
                    };
                    self.open = Some(recording.id.clone());
                    state.recordings.push(recording);
                }
                Event::TakeClosed(take) => {
                    let Some(finished) = self.recording(take) else {
                        continue;
                    };
                    match self.open_recording(state) {
                        // Keep the ID and any keys another version added.
                        Some(recording) => {
                            *recording = Recording {
                                id: recording.id.clone(),
                                extra: std::mem::take(&mut recording.extra),
                                ..finished
                            };
                        }
                        // The state was replaced mid-take (a preset or undo
                        // load); the take still belongs in it.
                        None => state.recordings.push(finished),
                    }
                    self.open = None;
                }
            }
        }
        events
    }

    /// The state entry for `take`, or `None` without a capture.
    fn recording(&mut self, take: &Take) -> Option<Recording> {
        let capture = self.capture.as_ref()?;
        let id = match &self.open {
            Some(id) => id.clone(),
            None => {
                self.takes += 1;
                let stem = capture
                    .filename
                    .strip_suffix(".mp4")
                    .unwrap_or(&capture.filename);
                format!("{stem}-take-{}", self.takes)
            }
        };
        Some(Recording::from_take(
            take,
            RecordingMeta {
                id,
                filename: capture.filename.clone(),
                dimensions: capture.dimensions,
                fps: capture.fps,
                camera: capture.camera.clone(),
                created_at: capture.created_at.clone(),
            },
        ))
    }

    fn open_recording<'a>(&self, state: &'a mut State) -> Option<&'a mut Recording> {
        let id = self.open.as_ref()?;
        state
            .recordings
            .iter_mut()
            .rev()
            .find(|recording| recording.id == *id)
    }
}

#[cfg(test)]
mod tests;
