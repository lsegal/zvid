//! Fans one capture stream out to the encoder and the UI preview.
//!
//! The encoder callback runs inline on the capture thread for every frame.
//! Preview frames are throttled, then handed to a worker thread through a
//! one-slot mailbox, so a slow JPEG encode drops previews instead of
//! stalling capture.

use crate::clock::HostTime;
use crate::frame::Frame;
use crate::preview::{self, PreviewConfig, PreviewFrame, Throttle};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

/// Receives every captured frame at full rate. It runs on the capture
/// thread, so it must hand work off rather than block.
pub type FrameCallback = Box<dyn FnMut(&Arc<Frame>) + Send>;
/// Receives preview JPEGs on the preview worker thread.
pub type PreviewCallback = Box<dyn FnMut(PreviewFrame) + Send>;

/// Counters for a running capture session.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SessionStats {
    pub frames: u64,
    /// Frames whose timestamp didn't advance and was moved forward by 1 µs
    /// to keep the stream strictly monotonic.
    pub timestamp_corrections: u64,
    /// Frames the backend dropped (reported by the platform, when known).
    pub dropped: u64,
    pub previews: u64,
    /// Preview candidates replaced by a newer frame before being encoded.
    pub previews_skipped: u64,
    pub preview_errors: u64,
}

pub(crate) struct Dispatcher {
    on_frame: Option<FrameCallback>,
    preview: Option<PreviewPipe>,
    last_pts: Option<HostTime>,
    sequence: u64,
    stats: Arc<Mutex<SessionStats>>,
}

impl Dispatcher {
    pub(crate) fn new(on_frame: Option<FrameCallback>, preview: Option<(PreviewConfig, PreviewCallback)>) -> Self {
        let stats = Arc::new(Mutex::new(SessionStats::default()));
        let preview = preview.map(|(config, callback)| PreviewPipe::spawn(config, callback, stats.clone()));
        Self {
            on_frame,
            preview,
            last_pts: None,
            sequence: 0,
            stats,
        }
    }

    pub(crate) fn stats(&self) -> Arc<Mutex<SessionStats>> {
        self.stats.clone()
    }

    pub(crate) fn record_dropped(&self, count: u64) {
        lock(&self.stats).dropped += count;
    }

    /// Stamps `frame` with its sequence number and a strictly increasing
    /// timestamp, then delivers it.
    pub(crate) fn deliver(&mut self, mut frame: Frame) {
        let mut corrected = false;
        if let Some(last) = self.last_pts {
            if frame.pts <= last {
                frame.pts = HostTime::from_nanos(last.as_nanos() + 1_000);
                corrected = true;
            }
        }
        self.last_pts = Some(frame.pts);
        frame.sequence = self.sequence;
        self.sequence += 1;
        {
            let mut stats = lock(&self.stats);
            stats.frames += 1;
            stats.timestamp_corrections += u64::from(corrected);
        }

        let frame = Arc::new(frame);
        if let Some(on_frame) = &mut self.on_frame {
            on_frame(&frame);
        }
        if let Some(preview) = &mut self.preview {
            preview.offer(frame);
        }
    }
}

struct Mailbox {
    frame: Option<Arc<Frame>>,
    closed: bool,
}

struct PreviewPipe {
    throttle: Throttle,
    shared: Arc<(Mutex<Mailbox>, Condvar)>,
    stats: Arc<Mutex<SessionStats>>,
    worker: Option<JoinHandle<()>>,
}

impl PreviewPipe {
    fn spawn(config: PreviewConfig, mut callback: PreviewCallback, stats: Arc<Mutex<SessionStats>>) -> Self {
        let shared = Arc::new((
            Mutex::new(Mailbox {
                frame: None,
                closed: false,
            }),
            Condvar::new(),
        ));
        let worker_shared = shared.clone();
        let worker_stats = stats.clone();
        let worker = std::thread::Builder::new()
            .name("zvid-capture-preview".into())
            .spawn(move || loop {
                let frame = {
                    let (mailbox, ready) = &*worker_shared;
                    let mut mailbox = lock(mailbox);
                    loop {
                        if let Some(frame) = mailbox.frame.take() {
                            break frame;
                        }
                        if mailbox.closed {
                            return;
                        }
                        mailbox = ready.wait(mailbox).unwrap_or_else(|e| e.into_inner());
                    }
                };
                match preview::render(&frame, &config) {
                    Ok(preview) => {
                        lock(&worker_stats).previews += 1;
                        callback(preview);
                    }
                    Err(_) => lock(&worker_stats).preview_errors += 1,
                }
            })
            .expect("spawn preview thread");
        Self {
            throttle: Throttle::new(config.max_fps),
            shared,
            stats,
            worker: Some(worker),
        }
    }

    fn offer(&mut self, frame: Arc<Frame>) {
        if !self.throttle.accept(frame.pts) {
            return;
        }
        let (mailbox, ready) = &*self.shared;
        if lock(mailbox).frame.replace(frame).is_some() {
            lock(&self.stats).previews_skipped += 1;
        }
        ready.notify_one();
    }
}

impl Drop for PreviewPipe {
    fn drop(&mut self) {
        let (mailbox, ready) = &*self.shared;
        lock(mailbox).closed = true;
        ready.notify_one();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::Rational;
    use crate::frame::{ColorInfo, PixelFormat, Rotation};
    use std::sync::mpsc;
    use std::time::Duration;

    fn frame(pts_ns: u64) -> Frame {
        Frame {
            width: 64,
            height: 36,
            format: PixelFormat::Nv12,
            color: ColorInfo::for_height(36),
            rotation: Rotation::None,
            pts: HostTime::from_nanos(pts_ns),
            sequence: 99,
            data: vec![128; Frame::nv12_len(64, 36)],
        }
    }

    #[test]
    fn delivers_every_frame_with_monotonic_timestamps() {
        let (tx, rx) = mpsc::channel();
        let mut dispatcher = Dispatcher::new(Some(Box::new(move |f: &Arc<Frame>| tx.send((f.sequence, f.pts)).unwrap())), None);
        for pts in [1_000_000, 2_000_000, 2_000_000, 1_500_000, 3_000_000] {
            dispatcher.deliver(frame(pts));
        }
        let got: Vec<_> = rx.try_iter().collect();
        assert_eq!(got.iter().map(|g| g.0).collect::<Vec<_>>(), vec![0, 1, 2, 3, 4]);
        assert!(got.windows(2).all(|w| w[1].1 > w[0].1));
        let stats = *lock(&dispatcher.stats());
        assert_eq!((stats.frames, stats.timestamp_corrections), (5, 2));
    }

    #[test]
    fn previews_are_throttled_and_encoded_off_thread() {
        let (tx, rx) = mpsc::channel();
        let config = PreviewConfig {
            max_edge: 32,
            max_fps: Rational::new(15, 1),
            jpeg_quality: 50,
        };
        let mut dispatcher = Dispatcher::new(None, Some((config, Box::new(move |p: PreviewFrame| tx.send(p).unwrap()))));
        // 30 fps in, 15 fps preview: every other frame is a candidate.
        for i in 0..10u64 {
            dispatcher.deliver(frame(i * 33_333_333));
            std::thread::sleep(Duration::from_millis(5));
        }
        let stats = dispatcher.stats();
        drop(dispatcher);
        let previews: Vec<PreviewFrame> = rx.iter().collect();
        let stats = *lock(&stats);
        assert_eq!(previews.len() as u64 + stats.previews_skipped, 5);
        assert!(!previews.is_empty());
        assert!(previews.iter().all(|p| p.width == 32 && p.height == 18 && p.sequence % 2 == 0));
    }
}
