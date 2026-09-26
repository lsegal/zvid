//! The host monotonic clock, in seconds.
//!
//! Transport snapshots, arm times and frame clocks must all be on one clock
//! for takes to line up with their footage. This reads the same clock as
//! `zvid_capture::HostTime`: `mach_absolute_time` on macOS and
//! `QueryPerformanceCounter` on Windows. Reading it never allocates, locks
//! or blocks, so `process()` may call it.

/// Seconds on the host monotonic clock.
pub fn now_sec() -> f64 {
    platform::now_sec()
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

    unsafe extern "C" {
        fn mach_absolute_time() -> u64;
        fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    }

    fn sec_per_tick() -> f64 {
        static RATIO: OnceLock<f64> = OnceLock::new();
        *RATIO.get_or_init(|| {
            let mut info = MachTimebaseInfo::default();
            // SAFETY: `info` is a valid out pointer.
            unsafe { mach_timebase_info(&mut info) };
            if info.denom == 0 {
                1e-9
            } else {
                f64::from(info.numer) / f64::from(info.denom) / 1e9
            }
        })
    }

    pub fn now_sec() -> f64 {
        // SAFETY: no preconditions.
        (unsafe { mach_absolute_time() }) as f64 * sec_per_tick()
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::OnceLock;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn QueryPerformanceCounter(count: *mut i64) -> i32;
        fn QueryPerformanceFrequency(frequency: *mut i64) -> i32;
    }

    fn frequency() -> f64 {
        static FREQUENCY: OnceLock<f64> = OnceLock::new();
        *FREQUENCY.get_or_init(|| {
            let mut frequency = 0i64;
            // SAFETY: `frequency` is a valid out pointer; this cannot fail
            // on XP and later.
            unsafe { QueryPerformanceFrequency(&mut frequency) };
            frequency.max(1) as f64
        })
    }

    pub fn now_sec() -> f64 {
        let mut count = 0i64;
        // SAFETY: `count` is a valid out pointer.
        unsafe { QueryPerformanceCounter(&mut count) };
        count.max(0) as f64 / frequency()
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use std::sync::OnceLock;
    use std::time::Instant;

    pub fn now_sec() -> f64 {
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        ORIGIN.get_or_init(Instant::now).elapsed().as_secs_f64()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_monotonic() {
        let first = now_sec();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = now_sec();
        assert!(second > first);
        assert!(second - first >= 0.001);
    }
}
