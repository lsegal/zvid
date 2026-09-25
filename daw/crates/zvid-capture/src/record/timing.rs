//! Maps capture timestamps onto the file's timelines.
//!
//! Both clocks count from the file's zero: the host time of the first video
//! frame written. Video is constant frame rate: each frame lands on the
//! nearest free slot of the camera's frame grid no more than a frame after it
//! was captured (or is dropped), and a missed slot lengthens the frame before
//! it.
//! Audio is sample-accurate: blocks are written back to back, and silence is
//! inserted or samples skipped only when a block's host time drifts more
//! than [`AUDIO_TOLERANCE_SEC`] from where the running sample count puts it.

use crate::clock::HostTime;
use crate::format::Rational;

/// How far audio may drift from the capture clock before it is corrected.
/// Well under one frame at 60 fps, and above the jitter of host block times.
pub const AUDIO_TOLERANCE_SEC: f64 = 0.010;

/// Places video frames on a constant-frame-rate grid.
#[derive(Clone, Debug)]
pub struct VideoClock {
    fps: Rational,
    zero: Option<HostTime>,
    last_slot: Option<u64>,
}

impl VideoClock {
    /// A clock for `fps`, which must be positive.
    pub fn new(fps: Rational) -> Self {
        assert!(fps.num > 0 && fps.den > 0, "frame rate must be positive");
        Self {
            fps,
            zero: None,
            last_slot: None,
        }
    }

    pub fn fps(&self) -> Rational {
        self.fps
    }

    /// Host time of file time zero, once the first frame is placed.
    pub fn zero(&self) -> Option<HostTime> {
        self.zero
    }

    /// The grid slot for a frame captured at `pts`, or `None` when it must
    /// be dropped. The first frame defines zero and takes slot 0. A frame
    /// whose nearest slot is taken moves to the next slot if that is less
    /// than one frame after it was captured (cameras that deliver in uneven
    /// pairs), and is dropped otherwise, as is a frame from before zero.
    pub fn place(&mut self, pts: HostTime) -> Option<u64> {
        let zero = *self.zero.get_or_insert(pts);
        if pts < zero {
            return None;
        }
        let elapsed = pts.as_nanos() - zero.as_nanos();
        let mut slot = self.slot_at(elapsed);
        if let Some(last) = self.last_slot
            && slot <= last
        {
            // Slot `last + 1` starts (last + 1) * den / num seconds in; take
            // it if the frame was captured less than one frame before that.
            let next = u128::from(last + 1) * u128::from(self.fps.den) * 1_000_000_000;
            let captured = u128::from(elapsed) * u128::from(self.fps.num);
            let frame = u128::from(self.fps.den) * 1_000_000_000;
            if next.saturating_sub(captured) >= frame {
                return None;
            }
            slot = last + 1;
        }
        self.last_slot = Some(slot);
        Some(slot)
    }

    /// Nearest slot to `elapsed_nanos` after zero.
    fn slot_at(&self, elapsed_nanos: u64) -> u64 {
        // slot = elapsed * num / (den * 1e9), rounded to nearest.
        let numer = u128::from(elapsed_nanos) * u128::from(self.fps.num);
        let denom = u128::from(self.fps.den) * 1_000_000_000;
        ((numer + denom / 2) / denom) as u64
    }

    /// File time of `slot`, in seconds.
    pub fn slot_sec(&self, slot: u64) -> f64 {
        slot as f64 * f64::from(self.fps.den) / f64::from(self.fps.num)
    }
}

/// What to do with an audio block before encoding it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Placement {
    /// Frames of silence to write before the block.
    pub silence: u64,
    /// Frames to drop from the start of the block.
    pub skip: usize,
}

/// Keeps audio aligned to the capture clock.
#[derive(Clone, Debug)]
pub struct AudioClock {
    sample_rate: u32,
    /// Frames written so far; the index of the next frame in the file.
    written: u64,
    tolerance: u64,
}

impl AudioClock {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate,
            written: 0,
            tolerance: (f64::from(sample_rate) * AUDIO_TOLERANCE_SEC).round() as u64,
        }
    }

    /// Frames written so far.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// Places a block of `frames` frames whose first frame was heard at
    /// `start` (host time), given the file's `zero`. Blocks without a time
    /// continue from the previous one. The first block is aligned exactly;
    /// later ones only once they drift past the tolerance.
    pub fn place(&mut self, zero: HostTime, start: Option<HostTime>, frames: usize) -> Placement {
        let mut placement = Placement::default();
        if let Some(start) = start {
            let target = self.frame_at(zero, start);
            let drift = target - self.written as i64;
            let tolerance = if self.written == 0 { 0 } else { self.tolerance };
            if drift > tolerance as i64 {
                placement.silence = drift as u64;
            } else if drift < -(tolerance as i64) {
                placement.skip = usize::try_from(-drift).unwrap_or(usize::MAX).min(frames);
            }
        }
        self.written += placement.silence + (frames - placement.skip) as u64;
        placement
    }

    /// File frame index of host time `at` (negative before zero).
    fn frame_at(&self, zero: HostTime, at: HostTime) -> i64 {
        let sign = if at >= zero { 1 } else { -1 };
        let nanos = at.as_nanos().abs_diff(zero.as_nanos());
        let frames =
            (u128::from(nanos) * u128::from(self.sample_rate) + 500_000_000) / 1_000_000_000;
        sign * frames as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(value: f64) -> HostTime {
        HostTime::from_nanos((5_000_000_000 + (value * 1_000_000.0).round() as i64) as u64)
    }

    #[test]
    fn places_frames_on_the_grid() {
        let mut clock = VideoClock::new(Rational::new(30, 1));
        assert_eq!(clock.place(ms(0.0)), Some(0));
        assert_eq!(clock.zero(), Some(ms(0.0)));
        // Jitter within half a frame still lands on the next slot.
        assert_eq!(clock.place(ms(36.0)), Some(1));
        assert_eq!(clock.place(ms(64.0)), Some(2));
        // A late camera skips a slot; the gap is the previous frame's.
        assert_eq!(clock.place(ms(133.3)), Some(4));
        // A second frame for slot 4 moves to slot 5, 0.8 frames late...
        assert_eq!(clock.place(ms(140.0)), Some(5));
        // ...which pushes the next frame to slot 6, just under a frame late,
        // until one would be a whole frame late: that one is dropped.
        assert_eq!(clock.place(ms(166.7)), Some(6));
        assert_eq!(clock.place(ms(200.0)), None);
        assert_eq!(clock.place(ms(233.4)), Some(7));
        // Frames before zero are dropped.
        assert_eq!(clock.place(ms(-10.0)), None);
        assert!((clock.slot_sec(5) - 5.0 / 30.0).abs() < 1e-12);
    }

    #[test]
    fn keeps_frames_delivered_in_uneven_pairs() {
        // A 30 fps camera timestamping on a 60 fps grid, two frames at a time.
        let mut clock = VideoClock::new(Rational::new(30, 1));
        let slots: Vec<_> = (0..300)
            .map(|index| {
                let pair = (index / 2) as f64 * 1000.0 / 15.0;
                let offset = if index % 2 == 0 { 0.0 } else { 1000.0 / 60.0 };
                clock.place(ms(pair + offset))
            })
            .collect();
        assert_eq!(slots, (0..300).map(Some).collect::<Vec<_>>());
    }

    #[test]
    fn handles_fractional_rates_without_drift() {
        let fps = Rational::new(30_000, 1001);
        let mut clock = VideoClock::new(fps);
        let frame_ns = fps.frame_duration_nanos() as f64 / 1e6;
        // Ten minutes of frames exactly on the NTSC grid.
        let frames = 10 * 60 * 30;
        for index in 0..frames {
            assert_eq!(
                clock.place(ms(index as f64 * frame_ns)),
                Some(index),
                "frame {index}"
            );
        }
    }

    #[test]
    fn aligns_the_first_audio_block_exactly() {
        let mut clock = AudioClock::new(48_000);
        // Starts 5 ms after zero: 240 frames of silence first.
        let placement = clock.place(ms(0.0), Some(ms(5.0)), 480);
        assert_eq!(
            placement,
            Placement {
                silence: 240,
                skip: 0
            }
        );
        assert_eq!(clock.written(), 720);

        // A block that starts before zero loses its head.
        let mut clock = AudioClock::new(48_000);
        let placement = clock.place(ms(0.0), Some(ms(-2.0)), 480);
        assert_eq!(
            placement,
            Placement {
                silence: 0,
                skip: 96
            }
        );
        assert_eq!(clock.written(), 384);
    }

    #[test]
    fn ignores_jitter_and_corrects_drift() {
        let zero = ms(0.0);
        let mut clock = AudioClock::new(48_000);
        clock.place(zero, Some(ms(0.0)), 480);
        // 4 ms of jitter is within tolerance: written back to back.
        assert_eq!(clock.place(zero, Some(ms(14.0)), 480), Placement::default());
        // Untimed blocks continue.
        assert_eq!(clock.place(zero, None, 480), Placement::default());
        assert_eq!(clock.written(), 1440);
        // A 20 ms gap (dropped audio) is filled with silence.
        assert_eq!(
            clock.place(zero, Some(ms(50.0)), 480),
            Placement {
                silence: 960,
                skip: 0
            }
        );
        assert_eq!(clock.written(), 2880);
        // Audio running 15 ms ahead is trimmed back: this block is dropped
        // whole, which leaves the next one 5 ms ahead, within tolerance.
        assert_eq!(
            clock.place(zero, Some(ms(45.0)), 480),
            Placement {
                silence: 0,
                skip: 480
            }
        );
        assert_eq!(clock.written(), 2880);
        assert_eq!(clock.place(zero, Some(ms(55.0)), 480), Placement::default());
        assert_eq!(clock.written(), 3360);
    }

    #[test]
    fn bounds_long_term_drift_to_the_tolerance() {
        // An audio device running 200 ppm slow against the host clock for
        // ten minutes: every block is 480 frames but arrives slightly late.
        let zero = ms(0.0);
        let mut clock = AudioClock::new(48_000);
        let block_ms = 10.0 * 1.0002;
        let mut worst = 0.0_f64;
        for index in 0..60_000 {
            let start = index as f64 * block_ms;
            let placement = clock.place(zero, Some(ms(start)), 480);
            // File time and host time of the block's first kept frame.
            let head = (clock.written() - 480 + placement.skip as u64) as f64 / 48.0;
            let heard = start + placement.skip as f64 / 48.0;
            worst = worst.max((head - heard).abs());
        }
        assert!(
            worst <= AUDIO_TOLERANCE_SEC * 1000.0 + 0.05,
            "drift {worst} ms"
        );
    }
}
