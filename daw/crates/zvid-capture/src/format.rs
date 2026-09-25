//! Capture formats and default format selection.

use std::cmp::{Ordering, Reverse};
use std::fmt;

/// An exact rational number, used for frame rates such as 30000/1001.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rational {
    pub num: u32,
    pub den: u32,
}

impl Rational {
    pub const fn new(num: u32, den: u32) -> Self {
        Self { num, den }
    }

    /// Builds a frame rate from a frame duration of `value / timescale` seconds.
    pub fn from_frame_duration(value: i64, timescale: i32) -> Option<Self> {
        if value <= 0 || timescale <= 0 {
            return None;
        }
        let num = u32::try_from(timescale).ok()?;
        let den = u32::try_from(value).ok()?;
        Some(Self::new(num, den).reduced())
    }

    pub fn as_f64(self) -> f64 {
        if self.den == 0 {
            0.0
        } else {
            f64::from(self.num) / f64::from(self.den)
        }
    }

    /// The same value with the numerator and denominator divided by their GCD.
    pub fn reduced(self) -> Self {
        let g = gcd(self.num, self.den);
        if g <= 1 {
            self
        } else {
            Self::new(self.num / g, self.den / g)
        }
    }

    /// The duration of one frame, in nanoseconds.
    pub fn frame_duration_nanos(self) -> u64 {
        if self.num == 0 {
            0
        } else {
            (u64::from(self.den) * 1_000_000_000) / u64::from(self.num)
        }
    }
}

impl PartialOrd for Rational {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Rational {
    fn cmp(&self, other: &Self) -> Ordering {
        let lhs = u64::from(self.num) * u64::from(other.den);
        let rhs = u64::from(other.num) * u64::from(self.den);
        lhs.cmp(&rhs)
    }
}

impl fmt::Display for Rational {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.den == 1 {
            write!(f, "{}", self.num)
        } else {
            write!(f, "{}/{} ({:.3})", self.num, self.den, self.as_f64())
        }
    }
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

/// One capture mode a device offers: frame size and maximum frame rate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Format {
    pub width: u32,
    pub height: u32,
    pub fps: Rational,
}

impl Format {
    pub fn is_portrait(&self) -> bool {
        self.height > self.width
    }

    /// The longer and shorter frame edges, so portrait and landscape sources
    /// are compared by the same limits.
    pub fn edges(&self) -> (u32, u32) {
        (self.width.max(self.height), self.width.min(self.height))
    }

    fn pixels(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

impl fmt::Display for Format {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}x{} @ {} fps", self.width, self.height, self.fps)
    }
}

/// Limits used to pick a device format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FormatPreference {
    /// Maximum long edge, in pixels (1920 for 1080p).
    pub max_long_edge: u32,
    /// Maximum short edge, in pixels (1080 for 1080p).
    pub max_short_edge: u32,
    /// Maximum frame rate.
    pub max_fps: Rational,
}

impl Default for FormatPreference {
    /// Best format up to 1080p30.
    fn default() -> Self {
        Self {
            max_long_edge: 1920,
            max_short_edge: 1080,
            max_fps: Rational::new(30, 1),
        }
    }
}

impl FormatPreference {
    fn fits_size(&self, format: &Format) -> bool {
        let (long, short) = format.edges();
        long <= self.max_long_edge && short <= self.max_short_edge
    }
}

/// The format to capture with, plus the frame rate to request from it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selection {
    /// Index into the slice passed to [`select_format`].
    pub index: usize,
    pub format: Format,
    /// `format.fps` capped at the preference's maximum.
    pub fps: Rational,
}

/// Picks the best format within `pref`.
///
/// Formats that fit the size limit are ranked by pixel count, then by frame
/// rate capped at `pref.max_fps`, so a 60 fps mode that can run at 30 counts
/// the same as a native 30 fps one and the native mode wins the tie. When no
/// format fits, the smallest one is used so capture still works.
pub fn select_format(formats: &[Format], pref: &FormatPreference) -> Option<Selection> {
    let capped = |f: &Format| f.fps.min(pref.max_fps);
    let usable = || formats.iter().enumerate().filter(|(_, f)| f.fps.num > 0 && f.fps.den > 0);
    let best_fitting = usable().filter(|(_, f)| pref.fits_size(f)).max_by(|(_, a), (_, b)| {
        a.pixels()
            .cmp(&b.pixels())
            .then_with(|| capped(a).cmp(&capped(b)))
            // Prefer the mode that needs the least frame-rate reduction.
            .then_with(|| b.fps.cmp(&a.fps))
    });
    let (index, format) =
        best_fitting.or_else(|| usable().min_by_key(|(_, f)| (f.pixels(), Reverse(capped(f)))))?;
    Some(Selection {
        index,
        format: *format,
        fps: capped(format),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(width: u32, height: u32, num: u32, den: u32) -> Format {
        Format {
            width,
            height,
            fps: Rational::new(num, den),
        }
    }

    #[test]
    fn picks_1080p30_over_larger_and_faster_modes() {
        let formats = [
            fmt(640, 480, 30, 1),
            fmt(3840, 2160, 30, 1),
            fmt(1920, 1080, 30, 1),
            fmt(1280, 720, 60, 1),
        ];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 2);
        assert_eq!(sel.fps, Rational::new(30, 1));
    }

    #[test]
    fn caps_frame_rate_and_prefers_native_rate_on_ties() {
        let formats = [fmt(1920, 1080, 60, 1), fmt(1920, 1080, 30, 1)];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 1);

        let only_60 = [fmt(1920, 1080, 60, 1)];
        let sel = select_format(&only_60, &FormatPreference::default()).unwrap();
        assert_eq!(sel.fps, Rational::new(30, 1));
    }

    #[test]
    fn prefers_higher_rate_at_the_same_size_below_the_cap() {
        let formats = [fmt(1280, 720, 15, 1), fmt(1280, 720, 30000, 1001)];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 1);
        assert_eq!(sel.fps, Rational::new(30000, 1001));
    }

    #[test]
    fn treats_portrait_sources_like_landscape() {
        let formats = [fmt(1280, 720, 30, 1), fmt(1080, 1920, 30, 1), fmt(1440, 1920, 30, 1)];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 1);
        assert!(sel.format.is_portrait());
    }

    #[test]
    fn falls_back_to_smallest_format_when_nothing_fits() {
        let formats = [fmt(3840, 2160, 30, 1), fmt(2560, 1440, 24, 1)];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 1);
        assert_eq!(select_format(&[], &FormatPreference::default()), None);
    }

    #[test]
    fn ignores_formats_without_a_frame_rate() {
        let formats = [fmt(1920, 1080, 0, 1), fmt(1280, 720, 30, 1)];
        let sel = select_format(&formats, &FormatPreference::default()).unwrap();
        assert_eq!(sel.index, 1);
    }

    #[test]
    fn rational_from_frame_duration() {
        assert_eq!(Rational::from_frame_duration(1001, 30000), Some(Rational::new(30000, 1001)));
        assert_eq!(Rational::from_frame_duration(20, 600), Some(Rational::new(30, 1)));
        assert_eq!(Rational::from_frame_duration(0, 600), None);
        assert_eq!(Rational::new(30, 1).frame_duration_nanos(), 33_333_333);
        assert!(Rational::new(30000, 1001) < Rational::new(30, 1));
    }
}
