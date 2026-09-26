//! The instance's control thread, started by `Initialize` and stopped by
//! `Uninitialize` or `Close`, as the VST3 component does on `initialize` and
//! `terminate`. It drains the transport ring render fills and the capture
//! layer's [`Command`]s into the take log, which appends every take to the
//! plugin state as it opens, and tells the host the state changed. It also
//! logs transport changes and what the optional Live companion script
//! reports.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use zvid_daw_core::{Command, Consumer, LiveLink, ProcessSnapshot, State, TransportFollower};

use super::log::log;

/// How often the control thread drains the transport ring.
const CONTROL_INTERVAL: Duration = Duration::from_millis(10);

/// What the control thread reads from.
pub struct Inputs {
    pub transport: Consumer<ProcessSnapshot>,
    pub commands: Receiver<Command>,
}

pub struct Control {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<Inputs>,
}

impl Control {
    /// Starts a thread that owns `inputs` until [`Control::stop`]. It calls
    /// `state_changed` after a take opens or closes in `state`.
    pub fn start(
        mut inputs: Inputs,
        state: Arc<Mutex<State>>,
        state_changed: impl Fn() + Send + 'static,
    ) -> Option<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let spawned = thread::Builder::new()
            .name("zvid-au-control".to_string())
            .spawn(move || {
                let mut follower = TransportFollower::default();
                let mut live = LiveLink::connect()
                    .inspect_err(|error| log(&format!("could not open the Live link: {error}")))
                    .ok();
                loop {
                    let stopping = stopping.load(Ordering::Acquire);
                    if follower.drain(&mut inputs.transport, &inputs.commands, &state, log) {
                        state_changed();
                    }
                    if let Some(live) = &mut live {
                        poll_live(live);
                    }
                    if stopping {
                        return inputs;
                    }
                    thread::park_timeout(CONTROL_INTERVAL);
                }
            });
        match spawned {
            Ok(thread) => Some(Self { stop, thread }),
            Err(error) => {
                log(&format!("could not start the control thread: {error}"));
                None
            }
        }
    }

    /// Stops the thread after a last drain and hands its inputs back.
    pub fn stop(self) -> Option<Inputs> {
        self.stop.store(true, Ordering::Release);
        self.thread.thread().unpark();
        self.thread
            .join()
            .inspect_err(|_| log("the control thread panicked"))
            .ok()
    }
}

/// Logs changes to what the Live companion reports.
fn poll_live(live: &mut LiveLink) {
    if live.poll(Instant::now()) {
        match live.status() {
            Some(status) => log(&format!("live companion: {status}")),
            None => log("live companion: gone"),
        }
    }
}
