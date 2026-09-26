//! The input-audio tap: stereo input-bus audio handed from the audio thread
//! to the editor backend in timed blocks.
//!
//! Each block's frames go into a sample ring, and its host time, sample rate
//! and frame count into a header ring beside it. [`TapWriter::push`] writes
//! a block whole or drops it whole, so the two rings never disagree, and it
//! never allocates, locks or blocks.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::ring::{Consumer, Producer, ring};

/// Headers the tap holds per sample frame: enough for blocks of 16 frames.
const FRAMES_PER_HEADER: usize = 16;

/// What the header ring records for each block.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Header {
    host_time: f64,
    sample_rate: f64,
    frames: usize,
}

/// A block of tapped audio.
#[derive(Clone, Debug, PartialEq)]
pub struct TapBlock {
    /// Seconds on the host clock ([`crate::clock`]) when the first frame
    /// was heard.
    pub host_time: f64,
    pub sample_rate: f64,
    /// Interleaved stereo samples.
    pub samples: Vec<f32>,
}

struct Shared {
    /// Blocks dropped because the tap was full.
    dropped: AtomicU64,
    /// The latest block's sample rate as `f64` bits; 0 before any block.
    sample_rate: AtomicU64,
}

/// Writing end of an [`audio_tap`]; owned by the audio thread.
pub struct TapWriter {
    headers: Producer<Header>,
    samples: Producer<[f32; 2]>,
    shared: Arc<Shared>,
}

/// Reading end of an [`audio_tap`].
pub struct AudioTap {
    headers: Consumer<Header>,
    samples: Consumer<[f32; 2]>,
    shared: Arc<Shared>,
}

/// Creates a tap holding up to `frames` stereo frames. Allocates only here.
pub fn audio_tap(frames: usize) -> (TapWriter, AudioTap) {
    let (headers, header_reader) = ring((frames / FRAMES_PER_HEADER).max(1));
    let (samples, sample_reader) = ring(frames);
    let shared = Arc::new(Shared {
        dropped: AtomicU64::new(0),
        sample_rate: AtomicU64::new(0),
    });
    (
        TapWriter {
            headers,
            samples,
            shared: Arc::clone(&shared),
        },
        AudioTap {
            headers: header_reader,
            samples: sample_reader,
            shared,
        },
    )
}

impl TapWriter {
    /// Appends a block of `frames` frames, first heard at `host_time`
    /// seconds on the host clock. `frame(i)` returns frame `i`. Drops the
    /// whole block and returns false when the tap is full.
    pub fn push(
        &mut self,
        host_time: f64,
        sample_rate: f64,
        frames: usize,
        mut frame: impl FnMut(usize) -> [f32; 2],
    ) -> bool {
        if frames == 0 {
            return true;
        }
        self.shared
            .sample_rate
            .store(sample_rate.to_bits(), Ordering::Relaxed);
        if self.headers.free() == 0 || self.samples.free() < frames {
            self.shared.dropped.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        for index in 0..frames {
            self.samples.push(frame(index));
        }
        // The header is published after its samples, so a reader that sees
        // it finds them all.
        self.headers.push(Header {
            host_time,
            sample_rate,
            frames,
        })
    }
}

impl AudioTap {
    /// Removes the oldest block, if any.
    pub fn pop(&mut self) -> Option<TapBlock> {
        let header = self.headers.pop()?;
        let mut samples = Vec::with_capacity(header.frames * 2);
        for _ in 0..header.frames {
            // Always present: the header was pushed after its frames.
            if let Some([left, right]) = self.samples.pop() {
                samples.extend([left, right]);
            }
        }
        Some(TapBlock {
            host_time: header.host_time,
            sample_rate: header.sample_rate,
            samples,
        })
    }

    /// Pops every block currently queued.
    pub fn drain(&mut self) -> impl Iterator<Item = TapBlock> + '_ {
        std::iter::from_fn(|| self.pop())
    }

    /// The sample rate of the latest block the audio thread pushed or
    /// dropped, or `None` before the first.
    pub fn sample_rate(&self) -> Option<f64> {
        let rate = f64::from_bits(self.shared.sample_rate.load(Ordering::Relaxed));
        (rate > 0.0).then_some(rate)
    }

    /// Blocks dropped because the tap was full.
    pub fn dropped(&self) -> u64 {
        self.shared.dropped.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(start: f32) -> impl FnMut(usize) -> [f32; 2] {
        move |index| {
            let value = start + index as f32;
            [value, -value]
        }
    }

    #[test]
    fn hands_over_timed_blocks_in_order() {
        let (mut writer, mut tap) = audio_tap(64);
        assert_eq!(tap.sample_rate(), None);
        assert_eq!(tap.pop(), None);
        assert!(writer.push(10.0, 48_000.0, 2, ramp(1.0)));
        assert!(writer.push(10.5, 44_100.0, 1, ramp(5.0)));
        // Empty blocks are skipped.
        assert!(writer.push(11.0, 44_100.0, 0, ramp(0.0)));
        assert_eq!(tap.sample_rate(), Some(44_100.0));
        assert_eq!(
            tap.drain().collect::<Vec<_>>(),
            [
                TapBlock {
                    host_time: 10.0,
                    sample_rate: 48_000.0,
                    samples: vec![1.0, -1.0, 2.0, -2.0],
                },
                TapBlock {
                    host_time: 10.5,
                    sample_rate: 44_100.0,
                    samples: vec![5.0, -5.0],
                },
            ]
        );
        assert_eq!(tap.dropped(), 0);
    }

    #[test]
    fn drops_whole_blocks_when_full() {
        let (mut writer, mut tap) = audio_tap(2 * FRAMES_PER_HEADER);
        assert!(writer.push(1.0, 48_000.0, 30, ramp(0.0)));
        // Three more frames don't fit, so none of them are written.
        assert!(!writer.push(2.0, 48_000.0, 3, ramp(10.0)));
        assert!(writer.push(3.0, 48_000.0, 1, ramp(20.0)));
        assert_eq!(tap.dropped(), 1);
        let blocks = tap.drain().collect::<Vec<_>>();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1].host_time, 3.0);
        assert_eq!(blocks[1].samples, [20.0, -20.0]);
    }

    #[test]
    fn drops_blocks_when_out_of_headers() {
        let (mut writer, mut tap) = audio_tap(FRAMES_PER_HEADER);
        assert!(writer.push(1.0, 48_000.0, 1, ramp(0.0)));
        assert!(!writer.push(2.0, 48_000.0, 1, ramp(1.0)));
        assert_eq!(tap.drain().count(), 1);
        assert_eq!(tap.dropped(), 1);
        // The dropped block's frames were never written.
        assert!(writer.push(3.0, 48_000.0, 1, ramp(7.0)));
        assert_eq!(tap.pop().unwrap().samples, [7.0, -7.0]);
    }

    #[test]
    fn hands_blocks_across_threads() {
        const BLOCKS: usize = 10_000;
        let (mut writer, mut tap) = audio_tap(256);
        let audio = std::thread::spawn(move || {
            for block in 0..BLOCKS {
                let start = (block * 3) as f32;
                while !writer.push(block as f64, 48_000.0, 3, ramp(start)) {
                    std::thread::yield_now();
                }
            }
        });
        let mut next = 0;
        while next < BLOCKS {
            match tap.pop() {
                Some(block) => {
                    let start = (next * 3) as f32;
                    assert_eq!(block.host_time, next as f64);
                    assert_eq!(
                        block.samples,
                        [
                            start,
                            -start,
                            start + 1.0,
                            -start - 1.0,
                            start + 2.0,
                            -start - 2.0
                        ]
                    );
                    next += 1;
                }
                None => std::thread::yield_now(),
            }
        }
        audio.join().unwrap();
    }
}
