// The Limiter's math: its parameters, the readouts, and the gain computer
// of a lookahead brickwall peak limiter. The signal is delayed by the
// lookahead, so the gain reaches each peak's required level before the
// peak itself comes out: the output never exceeds the Ceiling.

export const LIMITER_EFFECT_NAME = "Limiter";
export const CEILING_KEY = "Ceiling";
export const RELEASE_KEY = "Release";
export const LOOKAHEAD_KEY = "Lookahead";
export const GAIN_KEY = "Gain";

export const CEILING_MIN_DB = -20;
export const CEILING_MAX_DB = 0;
export const CEILING_DEFAULT_DB = -1;

export const RELEASE_MIN_MS = 1;
export const RELEASE_MAX_MS = 1000;
export const RELEASE_DEFAULT_MS = 50;

export const LOOKAHEAD_MIN_MS = 0;
export const LOOKAHEAD_MAX_MS = 10;
export const LOOKAHEAD_DEFAULT_MS = 5;

export const GAIN_MIN_DB = 0;
export const GAIN_MAX_DB = 24;
export const GAIN_DEFAULT_DB = 0;

const MINUS = "−";

// "−1.0 dB", "+6.0 dB" or "0.0 dB".
export function formatDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

// "4.5 ms", "50 ms" or "1.00 s".
export function formatReleaseMs(ms: number) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

// "5.0 ms".
export function formatLookaheadMs(ms: number) {
  return `${ms.toFixed(1)} ms`;
}

export function dbToAmplitude(db: number) {
  return 10 ** (db / 20);
}

// The lookahead in whole frames: the Limiter's latency.
export function lookaheadFrames(ms: number, sampleRate: number) {
  const clamped = Math.min(LOOKAHEAD_MAX_MS, Math.max(LOOKAHEAD_MIN_MS, ms));
  return Math.round((clamped / 1000) * sampleRate);
}

// The one-pole coefficient that releases over `ms`.
export function releaseCoefficient(ms: number, sampleRate: number) {
  const clamped = Math.max(RELEASE_MIN_MS, ms);
  return Math.exp(-1 / ((clamped / 1000) * sampleRate));
}

// The gain computer for a lookahead of `lookahead` frames, fed each frame's
// required gain (the most it can pass at without exceeding the Ceiling) as
// it enters the delay. `next` returns the gain for the frame leaving the
// delay, `lookahead` frames earlier, and never more than that frame's
// required gain:
//   1. the minimum required gain over the window (lookahead + 1 frames),
//      so every frame still in the delay is covered;
//   2. averaged over the last lookahead + 1 minima, so the gain ramps down
//      across the lookahead instead of stepping; each of those minima
//      covers the leaving frame, so their average does too;
//   3. released exponentially when it rises again (the attack is instant).
export class LimiterGain {
  readonly lookahead: number;
  private readonly span: number;
  // The window's minima: a monotonic queue of frames and required gains.
  private readonly queueFrames: Float64Array;
  private readonly queueGains: Float64Array;
  private queueHead = 0;
  private queueSize = 0;
  // The last `span` minima, for the average.
  private readonly minima: Float64Array;
  private minimaAt = 0;
  private minimaSum: number;
  private gain = 1;

  constructor(lookahead: number) {
    this.lookahead = lookahead;
    this.span = lookahead + 1;
    this.queueFrames = new Float64Array(this.span);
    this.queueGains = new Float64Array(this.span);
    this.minima = new Float64Array(this.span).fill(1);
    this.minimaSum = this.span;
  }

  // `frame` counts up by one per call; `release` is a releaseCoefficient.
  next(frame: number, required: number, release: number) {
    const span = this.span;
    while (this.queueSize > 0) {
      const last = (this.queueHead + this.queueSize - 1) % span;
      if (this.queueGains[last] < required) {
        break;
      }
      this.queueSize--;
    }
    while (
      this.queueSize > 0 &&
      this.queueFrames[this.queueHead] < frame - this.lookahead
    ) {
      this.queueHead = (this.queueHead + 1) % span;
      this.queueSize--;
    }
    const tail = (this.queueHead + this.queueSize) % span;
    this.queueFrames[tail] = frame;
    this.queueGains[tail] = required;
    this.queueSize++;
    const minimum = this.queueGains[this.queueHead];

    this.minimaSum += minimum - this.minima[this.minimaAt];
    this.minima[this.minimaAt] = minimum;
    this.minimaAt++;
    if (this.minimaAt === span) {
      // Resums once per lap, so rounding never accumulates.
      this.minimaAt = 0;
      this.minimaSum = this.minima.reduce((total, value) => total + value, 0);
    }
    const smoothed = this.minimaSum / span;
    this.gain =
      smoothed < this.gain
        ? smoothed
        : smoothed + release * (this.gain - smoothed);
    return this.gain;
  }
}
