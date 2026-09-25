//! Capture file names: `video-{NN}-{M}-{D}-{HH}-{mm}-{ss}-{n}.mp4`.

/// Local wall-clock time at arm, as used in capture file names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalTime {
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

/// Formats a capture file name. `counter` is the per-instance capture
/// counter (`NN`, at least two digits) and `collision` the suffix `n` that
/// keeps names unique when several captures start within one second.
pub fn capture_filename(counter: u32, at: LocalTime, collision: u32) -> String {
    format!(
        "video-{counter:02}-{}-{}-{:02}-{:02}-{:02}-{collision}.mp4",
        at.month, at.day, at.hour, at.minute, at.second,
    )
}

/// The first capture file name, counting `n` up from 0, for which `exists`
/// returns false.
pub fn next_capture_filename(
    counter: u32,
    at: LocalTime,
    mut exists: impl FnMut(&str) -> bool,
) -> String {
    (0..)
        .map(|collision| capture_filename(counter, at, collision))
        .find(|name| !exists(name))
        .expect("an unused collision counter exists")
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: LocalTime = LocalTime {
        month: 6,
        day: 24,
        hour: 18,
        minute: 47,
        second: 30,
    };

    #[test]
    fn matches_the_documented_example() {
        assert_eq!(capture_filename(1, AT, 0), "video-01-6-24-18-47-30-0.mp4");
    }

    #[test]
    fn pads_time_but_not_date() {
        let at = LocalTime {
            month: 12,
            day: 3,
            hour: 7,
            minute: 5,
            second: 9,
        };
        assert_eq!(capture_filename(12, at, 3), "video-12-12-3-07-05-09-3.mp4");
        assert_eq!(
            capture_filename(123, at, 0),
            "video-123-12-3-07-05-09-0.mp4"
        );
    }

    #[test]
    fn counts_collisions_up_from_zero() {
        let taken = [
            "video-01-6-24-18-47-30-0.mp4",
            "video-01-6-24-18-47-30-1.mp4",
        ];
        assert_eq!(
            next_capture_filename(1, AT, |name| taken.contains(&name)),
            "video-01-6-24-18-47-30-2.mp4"
        );
        assert_eq!(
            next_capture_filename(2, AT, |name| taken.contains(&name)),
            "video-02-6-24-18-47-30-0.mp4"
        );
    }
}
