//! Sample-rate conversion for AAC encoders that take only some rates.
//!
//! A windowed-sinc polyphase resampler for rational ratios. Output frame `k`
//! is input position `k * from / to` exactly: the filter is centred on it,
//! so the resampler adds no delay and file times are the same at either
//! rate. [`AudioClock`](super::AudioClock) keeps counting input frames, and
//! frame `n` of it lands at output frame `n * to / from`.

use zvidlib::AudioGapless;

use super::encoder::PcmEncoder;

/// Filter taps either side of the output position, in input frames, when
/// not decimating. Decimating widens the filter by the ratio.
const HALF_TAPS: f64 = 16.0;
/// Passband edge as a fraction of the lower Nyquist frequency.
const CUTOFF: f64 = 0.9;

/// Output frames for `input` frames resampled from `from` Hz to `to` Hz:
/// every output position before the end of the input.
pub fn output_frames(input: u64, from: u32, to: u32) -> u64 {
    (u128::from(input) * u128::from(to)).div_ceil(u128::from(from)) as u64
}

/// Converts interleaved PCM from one rate to another.
pub struct Resampler {
    channels: usize,
    from: u32,
    to: u32,
    /// Output/input ratio in lowest terms: `up / down`.
    up: u64,
    down: u64,
    /// Taps either side of the output position.
    half: usize,
    /// `up` phases of `2 * half` taps each.
    table: Vec<f32>,
    /// Interleaved input from frame `base` on (negative frames are silence).
    history: Vec<f32>,
    base: i64,
    /// Input frames received.
    received: u64,
    /// The next output frame.
    next: u64,
}

impl Resampler {
    pub fn new(from: u32, to: u32, channels: u16) -> Self {
        assert!(from > 0 && to > 0 && channels > 0, "rates must be positive");
        let divisor = gcd(u64::from(from), u64::from(to));
        let (up, down) = (u64::from(to) / divisor, u64::from(from) / divisor);
        // Cutoff in cycles per input frame, below the lower Nyquist.
        let scale = (to as f64 / from as f64).min(1.0);
        let cutoff = 0.5 * scale * CUTOFF;
        let half = (HALF_TAPS / scale).ceil() as usize;
        let taps = 2 * half;
        let mut table = Vec::with_capacity(up as usize * taps);
        for phase in 0..up {
            let offset = phase as f64 / up as f64;
            let start = table.len();
            for tap in 0..taps {
                // Input frame `i - half + 1 + tap`, relative to the output
                // position `i + offset`.
                let d = (tap as f64 + 1.0 - half as f64) - offset;
                table.push((sinc(2.0 * cutoff * d) * blackman(d / half as f64)) as f32);
            }
            // Unity gain at DC in every phase.
            let sum: f32 = table[start..].iter().sum();
            table[start..].iter_mut().for_each(|h| *h /= sum);
        }
        let channels = usize::from(channels);
        Self {
            channels,
            from,
            to,
            up,
            down,
            half,
            table,
            history: vec![0.0; (half - 1) * channels],
            base: 1 - half as i64,
            received: 0,
            next: 0,
        }
    }

    /// Resamples a block, returning every output frame its input completes.
    pub fn process(&mut self, interleaved: &[f32]) -> Vec<f32> {
        self.received += (interleaved.len() / self.channels) as u64;
        self.history.extend_from_slice(interleaved);
        let mut out = Vec::new();
        self.emit(u64::MAX, &mut out);
        out
    }

    /// Returns the output frames still owed for the input received, up to
    /// [`output_frames`] in all.
    pub fn finish(&mut self) -> Vec<f32> {
        self.history
            .extend(std::iter::repeat_n(0.0, self.half * self.channels));
        let total = output_frames(self.received, self.from, self.to);
        let mut out = Vec::new();
        self.emit(total, &mut out);
        out
    }

    fn emit(&mut self, limit: u64, out: &mut Vec<f32>) {
        let channels = self.channels;
        let taps = 2 * self.half;
        let available = self.base + (self.history.len() / channels) as i64;
        while self.next < limit {
            let position = self.next * self.down;
            let first = (position / self.up) as i64 + 1 - self.half as i64;
            if first + taps as i64 > available {
                break;
            }
            let phase = (position % self.up) as usize;
            let coefficients = &self.table[phase * taps..][..taps];
            let start = (first - self.base) as usize * channels;
            let window = &self.history[start..start + taps * channels];
            for channel in 0..channels {
                let sum: f32 = coefficients
                    .iter()
                    .zip(window[channel..].iter().step_by(channels))
                    .map(|(h, x)| h * x)
                    .sum();
                out.push(sum);
            }
            self.next += 1;
        }
        // Drop input no later output frame reaches.
        let first = (self.next * self.down / self.up) as i64 + 1 - self.half as i64;
        let consumed = (first - self.base).clamp(0, available - self.base) as usize;
        self.history.drain(..consumed * channels);
        self.base += consumed as i64;
    }
}

/// An encoder fed through a [`Resampler`], for input at a rate it doesn't
/// take.
pub struct Resampled {
    encoder: Box<dyn PcmEncoder>,
    resampler: Resampler,
}

impl Resampled {
    /// Feeds `encoder`, opened at its own rate, from `from` Hz input.
    pub fn new(encoder: Box<dyn PcmEncoder>, from: u32, channels: u16) -> Self {
        let resampler = Resampler::new(from, encoder.sample_rate(), channels);
        Self { encoder, resampler }
    }
}

impl PcmEncoder for Resampled {
    fn name(&self) -> &'static str {
        self.encoder.name()
    }

    fn sample_rate(&self) -> u32 {
        self.encoder.sample_rate()
    }

    fn decoder_config(&self) -> Vec<u8> {
        self.encoder.decoder_config()
    }

    fn priming(&self) -> u32 {
        self.encoder.priming()
    }

    fn encode(&mut self, interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
        let pcm = self.resampler.process(interleaved);
        self.encoder.encode(&pcm)
    }

    fn finish(&mut self) -> Result<(Vec<Vec<u8>>, AudioGapless), String> {
        let tail = self.resampler.finish();
        let mut packets = self.encoder.encode(&tail)?;
        let (rest, gapless) = self.encoder.finish()?;
        packets.extend(rest);
        Ok((packets, gapless))
    }
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        1.0
    } else {
        let x = std::f64::consts::PI * x;
        x.sin() / x
    }
}

/// Blackman window over `x` in -1..=1.
fn blackman(x: f64) -> f64 {
    let x = std::f64::consts::PI * x;
    0.42 + 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `frames` of a stereo sine at `hz`, sampled at `rate`; the right
    /// channel is inverted.
    fn sine(hz: f64, rate: u32, frames: usize) -> Vec<f32> {
        (0..frames)
            .flat_map(|index| {
                let value = (0.5
                    * (2.0 * std::f64::consts::PI * hz * index as f64 / rate as f64).sin())
                    as f32;
                [value, -value]
            })
            .collect()
    }

    fn resample(from: u32, to: u32, input: &[f32], block: usize) -> Vec<f32> {
        let mut resampler = Resampler::new(from, to, 2);
        let mut out = Vec::new();
        for chunk in input.chunks(block * 2) {
            out.extend(resampler.process(chunk));
        }
        out.extend(resampler.finish());
        out
    }

    #[test]
    fn writes_one_output_frame_per_output_position() {
        for (from, to) in [(96_000, 48_000), (88_200, 44_100), (32_000, 48_000)] {
            for frames in [0, 1, 7, 1000, 4801] {
                let out = resample(from, to, &sine(440.0, from, frames), 480);
                let expected = output_frames(frames as u64, from, to);
                assert_eq!(out.len() as u64, expected * 2, "{from} -> {to}, {frames}");
            }
        }
    }

    #[test]
    fn output_does_not_depend_on_block_size() {
        let input = sine(1000.0, 88_200, 20_000);
        let whole = resample(88_200, 48_000, &input, input.len());
        for block in [1, 64, 441, 1000] {
            assert_eq!(resample(88_200, 48_000, &input, block), whole, "{block}");
        }
    }

    #[test]
    fn keeps_time_and_level_across_rates() {
        // A tone resampled with no delay is the same tone sampled at the
        // output rate. The first and last filter lengths see the edges.
        for (from, to) in [
            (96_000, 48_000),
            (88_200, 44_100),
            (88_200, 48_000),
            (192_000, 48_000),
            (32_000, 48_000),
        ] {
            let seconds = 1;
            let out = resample(from, to, &sine(1000.0, from, from as usize * seconds), 480);
            let expected = sine(1000.0, to, to as usize * seconds);
            assert_eq!(out.len(), expected.len());
            let edge = 200 * 2;
            let worst = out[edge..out.len() - edge]
                .iter()
                .zip(&expected[edge..expected.len() - edge])
                .map(|(a, b)| (a - b).abs())
                .fold(0.0_f32, f32::max);
            assert!(worst < 1e-3, "{from} -> {to}: error {worst}");
        }
    }

    #[test]
    fn filters_what_the_output_rate_cannot_hold() {
        // 30 kHz is above 48 kHz's Nyquist frequency.
        let out = resample(96_000, 48_000, &sine(30_000.0, 96_000, 96_000), 480);
        let peak = out[400..out.len() - 400]
            .iter()
            .fold(0.0_f32, |peak, x| peak.max(x.abs()));
        assert!(peak < 0.5 * 1e-3, "aliased at {peak}");
    }

    #[test]
    fn places_an_impulse_on_its_output_position() {
        // Frame 960 at 96 kHz is 10 ms: frame 480 at 48 kHz.
        let mut input = vec![0.0; 1920 * 2];
        input[960 * 2] = 1.0;
        let out = resample(96_000, 48_000, &input, 480);
        let peak = out
            .chunks(2)
            .enumerate()
            .max_by(|a, b| a.1[0].total_cmp(&b.1[0]))
            .unwrap()
            .0;
        assert_eq!(peak, 480);
    }
}
