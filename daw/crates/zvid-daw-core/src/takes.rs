//! Keeps the plugin state's `recordings` in step with the take tracker.
//!
//! The control thread feeds a [`TakeLog`] the transport snapshots from the
//! audio thread and the [`Command`]s the capture layer sends when it arms,
//! disarms and writes frames. Every take becomes a [`Recording`] in the
//! state as soon as it opens, so a set saved mid-take still lists it, and
//! the recording's duration keeps running until the take closes.
//!
//! The log also records each take that opens or closes as a
//! [`TakeChange`], which the control thread forwards to the editor through
//! a [`TakeFeed`].

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::paths::RecordRootKind;
use crate::state::{Recording, RecordingMeta, State};
use crate::tracker::{Event, Input, Take, TakeTracker, TransportSnapshot};

/// The capture file an arm records to. Every take of that file shares
/// these details.
#[derive(Clone, Debug, PartialEq)]
pub struct Capture {
    /// File name relative to the record root.
    pub filename: String,
    /// The record root chosen at arm.
    pub record_root: RecordRootKind,
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
    /// The capture file's picture is `dimensions` (`[width, height]`),
    /// known at host time `at` once its first frame was encoded. It
    /// replaces the size the capture armed with, which can't tell a
    /// portrait camera from a landscape one.
    Dimensions { dimensions: [u32; 2], at: f64 },
    /// Capture continues in the new file `capture` from host time `at`,
    /// because the camera turned. The open take moves to it, so each file
    /// has one orientation and its own takes.
    NextFile { capture: Capture, at: f64 },
}

impl Command {
    /// The host time the command applies at.
    pub fn at(&self) -> f64 {
        match *self {
            Self::Arm { at, .. }
            | Self::Disarm { at }
            | Self::Dimensions { at, .. }
            | Self::NextFile { at, .. } => at,
            Self::FrameClock { host_time, .. } => host_time,
        }
    }
}

/// A take that opened or closed, after the log updated the state.
#[derive(Clone, Debug, PartialEq)]
pub enum TakeChange {
    /// A take opened and its entry was appended to the state. `index`
    /// counts the capture's takes from 0.
    Opened { index: u32, id: String },
    /// A take closed; this is its final entry in the state.
    Closed(Recording),
}

/// Carries [`TakeChange`]s from the control thread to one listener, the
/// editor backend. Clones share the listener.
#[derive(Clone, Debug, Default)]
pub struct TakeFeed {
    listener: Arc<Mutex<Option<Sender<TakeChange>>>>,
}

impl TakeFeed {
    /// Starts receiving changes, replacing any earlier listener.
    pub fn subscribe(&self) -> Receiver<TakeChange> {
        let (sender, receiver) = mpsc::channel();
        *self.lock() = Some(sender);
        receiver
    }

    /// Sends `change` to the listener, if one is still receiving. Never
    /// blocks.
    pub fn publish(&self, change: TakeChange) {
        let mut listener = self.lock();
        if let Some(sender) = listener.as_ref()
            && sender.send(change).is_err()
        {
            *listener = None;
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<Sender<TakeChange>>> {
        self.listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    /// Changes not yet taken by [`TakeLog::take_changes`].
    changes: Vec<TakeChange>,
}

impl TakeLog {
    pub fn is_armed(&self) -> bool {
        self.tracker.is_armed()
    }

    /// The takes that opened or closed since the last call, oldest first.
    pub fn take_changes(&mut self) -> Vec<TakeChange> {
        std::mem::take(&mut self.changes)
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
            Command::Dimensions { dimensions, .. } => {
                self.set_dimensions(dimensions, state);
                return Vec::new();
            }
            Command::NextFile { capture, at } => return self.next_file(capture, at, state),
        };
        let clock = matches!(input, Input::FrameClock { .. });
        let events = self.apply(input, state);
        if clock {
            // The first frame of a new file places the take moved to it.
            self.update_open(state);
        }
        if !self.is_armed() {
            self.capture = None;
        }
        events
    }

    /// Moves the open take to the new file `capture`. The previous file
    /// keeps the takes that closed in it, or becomes an unanchored entry
    /// without any.
    fn next_file(&mut self, capture: Capture, at: f64, state: &mut State) -> Vec<Event> {
        if !self.is_armed() || self.capture.is_none() {
            return Vec::new();
        }
        let moved = self.open.take();
        let changes = self.changes.len();
        let events = self.apply(Input::NextFile { at }, state);
        // The previous file's entry isn't a take the capture opened.
        let added = self.changes.split_off(changes);
        self.changes.extend(
            added
                .into_iter()
                .filter(|change| !matches!(change, TakeChange::Opened { .. })),
        );
        self.capture = Some(capture);
        self.open = moved;
        self.update_open(state);
        events
    }

    /// Brings the open take's entry up to its file and place in it.
    fn update_open(&mut self, state: &mut State) {
        let Some(take) = self.tracker.open_take().copied() else {
            return;
        };
        let Some(updated) = self.recording(&take) else {
            return;
        };
        if let Some(recording) = self.open_recording(state)
            && (recording.filename != updated.filename
                || recording.transport_start_sec != updated.transport_start_sec)
        {
            *recording = Recording {
                id: recording.id.clone(),
                duration_sec: recording.duration_sec,
                extra: std::mem::take(&mut recording.extra),
                ..updated
            };
        }
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
                    self.changes.push(TakeChange::Opened {
                        index: self.takes - 1,
                        id: recording.id.clone(),
                    });
                    state.record_root = recording.record_root_or(state.record_root);
                    state.recordings.push(recording);
                }
                Event::TakeClosed(take) => {
                    let Some(finished) = self.recording(take) else {
                        continue;
                    };
                    let closed = match self.open_recording(state) {
                        // Keep the ID and any keys another version added.
                        Some(recording) => {
                            *recording = Recording {
                                id: recording.id.clone(),
                                extra: std::mem::take(&mut recording.extra),
                                ..finished
                            };
                            recording.clone()
                        }
                        // The state was replaced mid-take (a preset or undo
                        // load); the take still belongs in it.
                        None => {
                            state.record_root = finished.record_root_or(state.record_root);
                            state.recordings.push(finished.clone());
                            finished
                        }
                    };
                    self.changes.push(TakeChange::Closed(closed));
                    self.open = None;
                }
            }
        }
        events
    }

    /// Gives the capture, and every take of it already in `state`, the
    /// size its file was recorded at.
    fn set_dimensions(&mut self, dimensions: [u32; 2], state: &mut State) {
        let Some(capture) = self.capture.as_mut() else {
            return;
        };
        capture.dimensions = dimensions;
        for recording in &mut state.recordings {
            if recording.filename == capture.filename
                && recording.record_root_or(state.record_root) == capture.record_root
            {
                recording.dimensions = dimensions;
            }
        }
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
                record_root: capture.record_root,
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
