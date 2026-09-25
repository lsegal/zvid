//! Frame timestamp statistics.

use crate::clock::HostTime;
use crate::format::Rational;
use std::fmt;

/// Interval statistics for a run of frame timestamps.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct JitterStats {
    pub frames: usize,
    /// Intervals that were zero or negative. Always 0 for session output.
    pub non_monotonic: usize,
    /// Intervals longer than 1.5 nominal frame durations.
    pub gaps: usize,
    pub mean_interval_ms: f64,
    pub min_interval_ms: f64,
    pub max_interval_ms: f64,
    /// Standard deviation of the frame interval.
    pub jitter_ms: f64,
    /// Largest distance of any interval from the nominal frame duration.
    pub max_deviation_ms: f64,
    /// Frame rate measured from the first to the last timestamp.
    pub measured_fps: f64,
}

impl JitterStats {
    pub fn from_timestamps(timestamps: &[HostTime], nominal_fps: Rational) -> Self {
        let mut stats = Self {
            frames: timestamps.len(),
            ..Self::default()
        };
        if timestamps.len() < 2 {
            return stats;
        }
        let nominal_ms = nominal_fps.frame_duration_nanos() as f64 / 1e6;
        let intervals: Vec<f64> = timestamps
            .windows(2)
            .map(|w| (w[1].as_nanos() as f64 - w[0].as_nanos() as f64) / 1e6)
            .collect();
        let n = intervals.len() as f64;
        let mean = intervals.iter().sum::<f64>() / n;
        stats.mean_interval_ms = mean;
        stats.min_interval_ms = intervals.iter().copied().fold(f64::INFINITY, f64::min);
        stats.max_interval_ms = intervals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        stats.jitter_ms = (intervals.iter().map(|i| (i - mean).powi(2)).sum::<f64>() / n).sqrt();
        stats.non_monotonic = intervals.iter().filter(|&&i| i <= 0.0).count();
        if nominal_ms > 0.0 {
            stats.gaps = intervals.iter().filter(|&&i| i > nominal_ms * 1.5).count();
            stats.max_deviation_ms = intervals
                .iter()
                .map(|i| (i - nominal_ms).abs())
                .fold(0.0, f64::max);
        }
        let span =
            timestamps[timestamps.len() - 1].as_nanos() as f64 - timestamps[0].as_nanos() as f64;
        if span > 0.0 {
            stats.measured_fps = n * 1e9 / span;
        }
        stats
    }
}

impl fmt::Display for JitterStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} frames, {:.2} fps measured, interval mean {:.3} ms (min {:.3}, max {:.3}), jitter {:.3} ms, max deviation {:.3} ms, {} gaps, {} non-monotonic",
            self.frames,
            self.measured_fps,
            self.mean_interval_ms,
            self.min_interval_ms,
            self.max_interval_ms,
            self.jitter_ms,
            self.max_deviation_ms,
            self.gaps,
            self.non_monotonic,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(nanos: &[u64]) -> Vec<HostTime> {
        nanos.iter().copied().map(HostTime::from_nanos).collect()
    }

    #[test]
    fn steady_30fps_has_no_jitter() {
        let stamps: Vec<u64> = (0..31).map(|i| i * 33_333_333).collect();
        let stats = JitterStats::from_timestamps(&ts(&stamps), Rational::new(30, 1));
        assert_eq!(stats.frames, 31);
        assert!((stats.measured_fps - 30.0).abs() < 0.01);
        assert!(stats.jitter_ms < 0.001);
        assert_eq!((stats.gaps, stats.non_monotonic), (0, 0));
    }

    #[test]
    fn counts_gaps_and_backwards_steps() {
        let stats = JitterStats::from_timestamps(
            &ts(&[0, 33_000_000, 100_000_000, 90_000_000]),
            Rational::new(30, 1),
        );
        assert_eq!(stats.gaps, 1);
        assert_eq!(stats.non_monotonic, 1);
        assert!(stats.max_deviation_ms > 40.0);
    }

    #[test]
    fn handles_short_runs() {
        assert_eq!(
            JitterStats::from_timestamps(&[], Rational::new(30, 1)).frames,
            0
        );
        assert_eq!(
            JitterStats::from_timestamps(&ts(&[5]), Rational::new(30, 1)).measured_fps,
            0.0
        );
    }
}
