//! Backend-to-frontend channels: the event log behind `emit` and the latest
//! preview frame. Both are long-polled by the frontend through `zvid://`,
//! so a producer on any thread reaches the webview without touching it.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::model::UiEvent;

/// Events kept for pollers that fall behind. A poller further behind than
/// this is told to resynchronize by re-reading the full state.
pub const EVENT_BACKLOG: usize = 256;

/// Set when the editor that owns a poll is torn down; wakes it early.
pub type Cancel = Arc<AtomicBool>;

/// Everything a backend pushes to the frontend.
#[derive(Default)]
pub struct Channels {
    pub events: EventLog,
    pub preview: PreviewSlot,
}

impl Channels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Wakes every poller so it can notice its cancel flag.
    pub fn wake_all(&self) {
        self.events.changed.notify_all();
        self.preview.changed.notify_all();
    }
}

#[derive(Default)]
struct EventInner {
    /// `(seq, serialized event)`, oldest first.
    events: VecDeque<(u64, Arc<str>)>,
    /// Sequence number of the most recent event; 0 before the first.
    head: u64,
}

/// A bounded, sequence-numbered log of serialized [`UiEvent`]s.
#[derive(Default)]
pub struct EventLog {
    inner: Mutex<EventInner>,
    changed: Condvar,
}

/// The answer to one event poll.
#[derive(Clone, Debug, PartialEq)]
pub struct EventBatch {
    /// Pass back as `after` on the next poll.
    pub cursor: u64,
    /// Events were dropped before the poller saw them.
    pub resync: bool,
    /// Serialized events, oldest first.
    pub events: Vec<Arc<str>>,
}

impl EventBatch {
    pub fn to_json(&self) -> String {
        let events = self
            .events
            .iter()
            .map(|event| event.as_ref())
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"cursor":{},"resync":{},"events":[{events}]}}"#,
            self.cursor, self.resync
        )
    }
}

impl EventLog {
    pub fn emit(&self, event: &UiEvent) {
        let json: Arc<str> = serde_json::to_string(event)
            .expect("events serialize")
            .into();
        let mut inner = lock(&self.inner);
        inner.head += 1;
        let seq = inner.head;
        inner.events.push_back((seq, json));
        while inner.events.len() > EVENT_BACKLOG {
            inner.events.pop_front();
        }
        drop(inner);
        self.changed.notify_all();
    }

    /// Events after `after`, waiting up to `timeout` for one to arrive.
    /// With no cursor it answers at once with the current head, which is
    /// how a newly loaded page joins the stream.
    pub fn poll(&self, after: Option<u64>, timeout: Duration, cancel: &AtomicBool) -> EventBatch {
        let deadline = Instant::now() + timeout;
        let mut inner = lock(&self.inner);
        let Some(after) = after else {
            return EventBatch {
                cursor: inner.head,
                resync: false,
                events: Vec::new(),
            };
        };
        while inner.head == after {
            let now = Instant::now();
            if now >= deadline || cancel.load(Ordering::Acquire) {
                break;
            }
            inner = self
                .changed
                .wait_timeout(inner, deadline - now)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
        // A cursor from the future (the backend restarted) or one older than
        // the backlog can't be served incrementally.
        let oldest = inner.events.front().map_or(inner.head + 1, |(seq, _)| *seq);
        let resync = after > inner.head || (inner.head > after && after + 1 < oldest);
        let events = if resync {
            Vec::new()
        } else {
            inner
                .events
                .iter()
                .filter(|(seq, _)| *seq > after)
                .map(|(_, json)| json.clone())
                .collect()
        };
        EventBatch {
            cursor: inner.head,
            resync,
            events,
        }
    }
}

/// One JPEG preview frame.
#[derive(Clone, Debug, PartialEq)]
pub struct PreviewFrame {
    pub seq: u64,
    pub jpeg: Arc<[u8]>,
}

#[derive(Default)]
struct PreviewInner {
    seq: u64,
    frame: Option<Arc<[u8]>>,
}

/// The latest downscaled camera frame. Producers overwrite it; pollers only
/// ever see the newest frame, so a slow webview drops frames instead of
/// queueing them.
#[derive(Default)]
pub struct PreviewSlot {
    inner: Mutex<PreviewInner>,
    changed: Condvar,
}

impl PreviewSlot {
    pub fn publish(&self, jpeg: impl Into<Arc<[u8]>>) {
        self.set(Some(jpeg.into()));
    }

    /// Drops the current frame, e.g. when the camera goes away.
    pub fn clear(&self) {
        self.set(None);
    }

    fn set(&self, frame: Option<Arc<[u8]>>) {
        let mut inner = lock(&self.inner);
        inner.seq += 1;
        inner.frame = frame;
        drop(inner);
        self.changed.notify_all();
    }

    pub fn latest(&self) -> Option<PreviewFrame> {
        let inner = lock(&self.inner);
        inner.frame.clone().map(|jpeg| PreviewFrame {
            seq: inner.seq,
            jpeg,
        })
    }

    /// The first frame newer than `after`, waiting up to `timeout`. `None`
    /// on timeout, cancellation, or when the newest state is "no frame".
    pub fn poll(&self, after: u64, timeout: Duration, cancel: &AtomicBool) -> Option<PreviewFrame> {
        let deadline = Instant::now() + timeout;
        let mut inner = lock(&self.inner);
        while inner.seq == after || (inner.seq > after && inner.frame.is_none()) {
            let now = Instant::now();
            if now >= deadline || cancel.load(Ordering::Acquire) {
                return None;
            }
            inner = self
                .changed
                .wait_timeout(inner, deadline - now)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
        inner.frame.clone().map(|jpeg| PreviewFrame {
            seq: inner.seq,
            jpeg,
        })
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ErrorCode, UiError};
    use std::thread;

    fn event(n: u32) -> UiEvent {
        UiEvent::TakeOpened { index: n }
    }

    const SHORT: Duration = Duration::from_millis(20);

    #[test]
    fn joins_the_stream_at_the_head() {
        let log = EventLog::default();
        log.emit(&event(0));
        let batch = log.poll(None, SHORT, &AtomicBool::new(false));
        assert_eq!(batch.cursor, 1);
        assert!(batch.events.is_empty());
        assert_eq!(
            batch.to_json(),
            r#"{"cursor":1,"resync":false,"events":[]}"#
        );
    }

    #[test]
    fn returns_events_after_the_cursor() {
        let log = EventLog::default();
        log.emit(&event(0));
        log.emit(&event(1));
        log.emit(&UiEvent::Error(UiError::new(ErrorCode::DeviceBusy, "busy")));
        let batch = log.poll(Some(1), SHORT, &AtomicBool::new(false));
        assert_eq!(batch.cursor, 3);
        assert!(!batch.resync);
        assert_eq!(batch.events.len(), 2);
        let json: serde_json::Value = serde_json::from_str(&batch.to_json()).unwrap();
        assert_eq!(json["events"][0]["payload"]["index"], 1);
        assert_eq!(json["events"][1]["event"], "error");
    }

    #[test]
    fn times_out_with_nothing_new() {
        let log = EventLog::default();
        log.emit(&event(0));
        let started = Instant::now();
        let batch = log.poll(Some(1), SHORT, &AtomicBool::new(false));
        assert!(started.elapsed() >= SHORT);
        assert_eq!(batch.cursor, 1);
        assert!(batch.events.is_empty());
    }

    #[test]
    fn wakes_when_an_event_arrives() {
        let channels = Arc::new(Channels::new());
        let producer = channels.clone();
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            producer.events.emit(&event(7));
        });
        let batch = channels
            .events
            .poll(Some(0), Duration::from_secs(10), &AtomicBool::new(false));
        handle.join().unwrap();
        assert_eq!(batch.cursor, 1);
        assert_eq!(batch.events.len(), 1);
    }

    #[test]
    fn cancel_ends_a_poll_early() {
        let channels = Arc::new(Channels::new());
        let cancel: Cancel = Arc::new(AtomicBool::new(false));
        let (waker, flag) = (channels.clone(), cancel.clone());
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            flag.store(true, Ordering::Release);
            waker.wake_all();
        });
        let started = Instant::now();
        let batch = channels
            .events
            .poll(Some(0), Duration::from_secs(10), &cancel);
        assert!(
            channels
                .preview
                .poll(0, Duration::from_secs(10), &cancel)
                .is_none()
        );
        handle.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(batch.events.is_empty());
    }

    #[test]
    fn asks_laggards_to_resync() {
        let log = EventLog::default();
        for n in 0..(EVENT_BACKLOG as u32 + 10) {
            log.emit(&event(n));
        }
        let batch = log.poll(Some(2), SHORT, &AtomicBool::new(false));
        assert!(batch.resync);
        assert!(batch.events.is_empty());
        assert_eq!(batch.cursor, EVENT_BACKLOG as u64 + 10);
        // The oldest kept event is still served incrementally.
        let batch = log.poll(Some(10), SHORT, &AtomicBool::new(false));
        assert!(!batch.resync);
        assert_eq!(batch.events.len(), EVENT_BACKLOG);
        // So is a cursor from a restarted backend, as a resync.
        let batch = log.poll(Some(10_000), SHORT, &AtomicBool::new(false));
        assert!(batch.resync);
    }

    #[test]
    fn preview_serves_only_the_newest_frame() {
        let slot = PreviewSlot::default();
        let cancel = AtomicBool::new(false);
        assert_eq!(slot.latest(), None);
        assert_eq!(slot.poll(0, SHORT, &cancel), None);
        slot.publish(vec![1_u8]);
        slot.publish(vec![2_u8]);
        let frame = slot.poll(0, SHORT, &cancel).unwrap();
        assert_eq!((frame.seq, &*frame.jpeg), (2, &[2_u8][..]));
        assert_eq!(slot.poll(2, SHORT, &cancel), None);
        slot.clear();
        assert_eq!(slot.latest(), None);
        assert_eq!(slot.poll(2, SHORT, &cancel), None);
        slot.publish(vec![3_u8]);
        assert_eq!(slot.latest().unwrap().seq, 4);
    }
}
