//! The host monotonic clock shared with transport sync.
//!
//! macOS uses `mach_absolute_time` (the `CMClockGetHostTimeClock` timebase)
//! and Windows uses `QueryPerformanceCounter`. Both are exposed as
//! nanoseconds so frame timestamps and transport events compare directly.

use std::fmt;
use std::ops::Sub;
use std::time::Duration;

/// A point on the host monotonic clock, in nanoseconds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct HostTime(u64);

impl HostTime {
    pub const fn from_nanos(nanos: u64) -> Self {
        Self(nanos)
    }

    pub const fn as_nanos(self) -> u64 {
        self.0
    }

    /// The current host time.
    pub fn now() -> Self {
        Self(platform::now_nanos())
    }

    /// Converts a raw host clock reading (mach ticks or QPC counts).
    pub fn from_ticks(ticks: u64) -> Self {
        Self(platform::ticks_to_nanos(ticks))
    }

    pub fn saturating_sub(self, other: Self) -> Duration {
        Duration::from_nanos(self.0.saturating_sub(other.0))
    }
}

impl Sub for HostTime {
    type Output = Duration;

    fn sub(self, rhs: Self) -> Duration {
        self.saturating_sub(rhs)
    }
}

impl fmt::Display for HostTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{:09}", self.0 / 1_000_000_000, self.0 % 1_000_000_000)
    }
}

/// Scales `value * numer / denom` without overflowing for large tick counts.
pub(crate) fn scale(value: u64, numer: u64, denom: u64) -> u64 {
    if denom == 0 {
        return 0;
    }
    ((u128::from(value) * u128::from(numer)) / u128::from(denom)) as u64
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::OnceLock;

    #[repr(C)]
    #[derive(Default)]
    struct MachTimebaseInfo {
        numer: u32,
        denom: u32,
    }

    extern "C" {
        fn mach_absolute_time() -> u64;
        fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    }

    fn timebase() -> (u64, u64) {
        static TIMEBASE: OnceLock<(u64, u64)> = OnceLock::new();
        *TIMEBASE.get_or_init(|| {
            let mut info = MachTimebaseInfo::default();
            // SAFETY: `info` is a valid out pointer.
            unsafe { mach_timebase_info(&mut info) };
            if info.denom == 0 {
                (1, 1)
            } else {
                (u64::from(info.numer), u64::from(info.denom))
            }
        })
    }

    pub fn ticks_to_nanos(ticks: u64) -> u64 {
        let (numer, denom) = timebase();
        super::scale(ticks, numer, denom)
    }

    pub fn now_nanos() -> u64 {
        // SAFETY: no preconditions.
        ticks_to_nanos(unsafe { mach_absolute_time() })
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::OnceLock;
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

    fn frequency() -> u64 {
        static FREQUENCY: OnceLock<u64> = OnceLock::new();
        *FREQUENCY.get_or_init(|| {
            let mut freq = 0i64;
            // SAFETY: `freq` is a valid out pointer; this cannot fail on XP+.
            let _ = unsafe { QueryPerformanceFrequency(&mut freq) };
            freq.max(1) as u64
        })
    }

    pub fn ticks_to_nanos(ticks: u64) -> u64 {
        super::scale(ticks, 1_000_000_000, frequency())
    }

    pub fn now_nanos() -> u64 {
        let mut count = 0i64;
        // SAFETY: `count` is a valid out pointer.
        let _ = unsafe { QueryPerformanceCounter(&mut count) };
        ticks_to_nanos(count.max(0) as u64)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use std::sync::OnceLock;
    use std::time::Instant;

    fn origin() -> Instant {
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        *ORIGIN.get_or_init(Instant::now)
    }

    pub fn ticks_to_nanos(ticks: u64) -> u64 {
        ticks
    }

    pub fn now_nanos() -> u64 {
        origin().elapsed().as_nanos() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_is_monotonic() {
        let a = HostTime::now();
        std::thread::sleep(Duration::from_millis(2));
        let b = HostTime::now();
        assert!(b > a);
        assert!(b - a >= Duration::from_millis(1));
    }

    #[test]
    fn scale_does_not_overflow() {
        assert_eq!(scale(u64::MAX / 2, 1_000_000_000, 1_000_000_000), u64::MAX / 2);
        assert_eq!(scale(10_000_000, 1_000_000_000, 10_000_000), 1_000_000_000);
        assert_eq!(scale(5, 1, 0), 0);
    }

    #[test]
    fn display_is_seconds() {
        assert_eq!(HostTime::from_nanos(1_500_000_000).to_string(), "1.500000000");
    }
}
