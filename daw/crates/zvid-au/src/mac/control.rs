//! The instance's control thread, started by `Initialize` and stopped by
//! `Uninitialize` or `Close`, as the VST3 component does on `initialize` and
//! `terminate`. It drains the transport ring render fills into the take
//! tracker, logs transport changes, and logs what the optional Live
//! companion script reports.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use zvid_daw_core::{Consumer, LiveLink, ProcessSnapshot, TransportFollower};

use super::log::log;

/// How often the control thread drains the transport ring.
const CONTROL_INTERVAL: Duration = Duration::from_millis(10);

pub struct Control {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<Consumer<ProcessSnapshot>>,
}

impl Control {
    /// Starts a thread that owns `transport` until [`Control::stop`].
    pub fn start(mut transport: Consumer<ProcessSnapshot>) -> Option<Self> {
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
                    follower.drain(&mut transport, log);
                    if let Some(live) = &mut live {
                        poll_live(live);
                    }
                    if stopping {
                        return transport;
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

    /// Stops the thread after a last drain and hands the ring back.
    pub fn stop(self) -> Option<Consumer<ProcessSnapshot>> {
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
