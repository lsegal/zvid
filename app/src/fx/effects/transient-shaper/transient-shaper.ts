// The Transient Shaper's math: its parameters, the readouts, and the
// envelope followers that split a sound into its attacks and its sustain.
// A fast follower tracks each hit; a slow one lags behind it. Where the fast
// one is above the slow one the sound is rising (an attack), and where it
// has fallen below, the sound is decaying (its sustain). Their difference
// in dB drives the gain, so it depends on the sound's shape, not its level.

export const TRANSIENT_SHAPER_EFFECT_NAME = "Transient Shaper";
export const ATTACK_KEY = "Attack";
export const SUSTAIN_KEY = "Sustain";
export const OUTPUT_KEY = "Output";

// Attack and Sustain are stored from -1 to 1 (−100 % to +100 %).
export const SHAPE_MIN = -1;
export const SHAPE_MAX = 1;
export const SHAPE_DEFAULT = 0;

export const OUTPUT_MIN_DB = -24;
export const OUTPUT_MAX_DB = 12;
export const OUTPUT_DEFAULT_DB = 0;

// The gain Attack or Sustain applies at ±100 %, once fully detected.
export const SHAPE_RANGE_DB = 12;

// How far apart the two followers must be, in dB, for a part of the sound
// to count fully as an attack or as sustain; closer, it counts in
// proportion.
export const DETECTION_DB = 6;

// The fast follower catches a hit within about a millisecond and lets go
// over 20 ms. The slow one rises over 30 ms, so it trails each attack, and
// falls over 250 ms, so it stays above a decaying tail.
export const FAST_ATTACK_SECONDS = 0.001;
export const FAST_RELEASE_SECONDS = 0.02;
export const SLOW_ATTACK_SECONDS = 0.03;
export const SLOW_RELEASE_SECONDS = 0.25;

// The followers' floor, about −100 dBFS, so silence has a finite level.
const FLOOR = 1e-5;

const MINUS = "−";

// "+3.5 dB", "−6.0 dB" or "0.0 dB".
export function formatOutputDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

// "+40%", "−100%" or "0%".
export function formatShapePercent(value: number) {
  const percent = Math.round(value * 100);
  const sign = percent > 0 ? "+" : percent < 0 ? MINUS : "";
  return `${sign}${Math.abs(percent)}%`;
}

export function dbToAmplitude(db: number) {
  return 10 ** (db / 20);
}

// The one-pole coefficient that settles over `seconds`.
function coefficient(seconds: number, sampleRate: number) {
  return Math.exp(-1 / (seconds * sampleRate));
}

// The shaping gain in dB for a part of the sound whose fast follower sits
// `differenceDb` above (an attack) or below (sustain) its slow one.
export function shapeGainDb(differenceDb: number, attack: number, sustain: number) {
  if (differenceDb > 0) {
    return attack * SHAPE_RANGE_DB * Math.min(1, differenceDb / DETECTION_DB);
  }
  return sustain * SHAPE_RANGE_DB * Math.min(1, -differenceDb / DETECTION_DB);
}

// The two envelope followers, fed one detector sample at a time (the
// loudest channel's magnitude, so every channel gets the same gain and the
// stereo image holds). `next` returns the fast follower's level above the
// slow one's, in dB.
export function createEnvelopeDetector(sampleRate: number) {
  const fastAttack = coefficient(FAST_ATTACK_SECONDS, sampleRate);
  const fastRelease = coefficient(FAST_RELEASE_SECONDS, sampleRate);
  const slowAttack = coefficient(SLOW_ATTACK_SECONDS, sampleRate);
  const slowRelease = coefficient(SLOW_RELEASE_SECONDS, sampleRate);
  let fast = FLOOR;
  let slow = FLOOR;
  return {
    next(level: number) {
      const input = Math.max(level, FLOOR);
      const fastPole = input > fast ? fastAttack : fastRelease;
      fast = input + fastPole * (fast - input);
      const slowPole = input > slow ? slowAttack : slowRelease;
      slow = input + slowPole * (slow - input);
      return 20 * Math.log10(fast / slow);
    },
  };
}
