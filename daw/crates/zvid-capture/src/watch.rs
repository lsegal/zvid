//! Hot-plug notifications.
//!
//! The platform notification (AVFoundation connect/disconnect, or the
//! Windows device watcher) wakes a watcher thread that re-enumerates and
//! diffs the device list. The thread also rescans every second, so a missed
//! or coalesced notification still shows up well within two seconds.

use crate::backend;
use crate::fanout::lock;
use crate::{CaptureError, Device};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// A change to the connected camera list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeviceEvent {
    Added(Device),
    Removed(Device),
    /// Same ID, but the name or transport changed.
    Changed(Device),
}

/// Returns the events that turn `old` into `new`, matching devices by ID.
pub fn diff(old: &[Device], new: &[Device]) -> Vec<DeviceEvent> {
    let mut events: Vec<DeviceEvent> = old
        .iter()
        .filter(|d| !new.iter().any(|n| n.id == d.id))
        .cloned()
        .map(DeviceEvent::Removed)
        .collect();
    for device in new {
        match old.iter().find(|o| o.id == device.id) {
            None => events.push(DeviceEvent::Added(device.clone())),
            Some(previous) if previous != device => {
                events.push(DeviceEvent::Changed(device.clone()))
            }
            Some(_) => {}
        }
    }
    events
}

#[derive(Default)]
struct State {
    devices: Vec<Device>,
    rescan: bool,
    stopped: bool,
}

/// Watches for cameras being connected and disconnected until dropped.
pub struct DeviceWatcher {
    shared: Arc<(Mutex<State>, Condvar)>,
    thread: Option<JoinHandle<()>>,
    _notifier: Option<backend::Notifier>,
}

impl DeviceWatcher {
    /// Starts watching. `on_event` runs on the watcher thread for each change
    /// after the initial list, which [`DeviceWatcher::devices`] returns.
    pub fn start(
        mut on_event: impl FnMut(DeviceEvent) + Send + 'static,
    ) -> Result<Self, CaptureError> {
        let initial = backend::list_devices()?;
        let shared = Arc::new((
            Mutex::new(State {
                devices: initial,
                ..State::default()
            }),
            Condvar::new(),
        ));

        let nudge_shared = Arc::downgrade(&shared);
        let nudge: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Some(shared) = nudge_shared.upgrade() {
                lock(&shared.0).rescan = true;
                shared.1.notify_one();
            }
        });
        // Polling still catches changes if notifications can't be registered.
        let notifier = backend::Notifier::register(nudge).ok();

        let thread_shared = shared.clone();
        let thread = std::thread::Builder::new()
            .name("zvid-capture-watch".into())
            .spawn(move || {
                let (state, wake) = &*thread_shared;
                loop {
                    {
                        let mut guard = lock(state);
                        if !guard.rescan && !guard.stopped {
                            guard = wake
                                .wait_timeout(guard, POLL_INTERVAL)
                                .unwrap_or_else(|e| e.into_inner())
                                .0;
                        }
                        if guard.stopped {
                            return;
                        }
                        guard.rescan = false;
                    }
                    let Ok(current) = backend::list_devices() else {
                        continue;
                    };
                    let events = {
                        let mut guard = lock(state);
                        let events = diff(&guard.devices, &current);
                        guard.devices = current;
                        events
                    };
                    for event in events {
                        on_event(event);
                    }
                }
            })
            .map_err(|e| CaptureError::platform("spawn watcher thread", e))?;

        Ok(Self {
            shared,
            thread: Some(thread),
            _notifier: notifier,
        })
    }

    /// The device list as of the last scan.
    pub fn devices(&self) -> Vec<Device> {
        lock(&self.shared.0).devices.clone()
    }

    /// Whether platform notifications are active (otherwise only polling is).
    pub fn has_notifications(&self) -> bool {
        self._notifier.is_some()
    }
}

impl Drop for DeviceWatcher {
    fn drop(&mut self) {
        lock(&self.shared.0).stopped = true;
        self.shared.1.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DeviceId, Transport};

    fn device(id: &str, name: &str) -> Device {
        Device {
            id: DeviceId(id.into()),
            name: name.into(),
            transport: Transport::Usb,
        }
    }

    #[test]
    fn diff_reports_added_removed_and_changed() {
        let old = [device("a", "Cam A"), device("b", "Cam B")];
        let new = [device("b", "Cam B (renamed)"), device("c", "iPhone")];
        assert_eq!(
            diff(&old, &new),
            vec![
                DeviceEvent::Removed(device("a", "Cam A")),
                DeviceEvent::Changed(device("b", "Cam B (renamed)")),
                DeviceEvent::Added(device("c", "iPhone")),
            ]
        );
        assert!(diff(&new, &new).is_empty());
    }
}
