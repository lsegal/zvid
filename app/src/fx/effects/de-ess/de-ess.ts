// The De-ess effect's parameters, readouts and filters. A band-pass around
// Frequency detects sibilance; its level over Threshold, up to Amount, turns
// down the band above a crossover an octave below Frequency, so the rest of
// the sound passes untouched. The processor (processor.ts) runs it per frame.

export const DE_ESS_EFFECT_NAME = "De-ess";

export const FREQUENCY_KEY = "Frequency";
export const THRESHOLD_KEY = "Threshold";
export const AMOUNT_KEY = "Amount";
export const LISTEN_KEY = "Listen";

export type DeEssNumberKey =
  | typeof FREQUENCY_KEY
  | typeof THRESHOLD_KEY
  | typeof AMOUNT_KEY;

export const DE_ESS_RANGES: Readonly<
  Record<DeEssNumberKey, { min: number; max: number; defaultValue: number }>
> = {
  [FREQUENCY_KEY]: { min: 2000, max: 12_000, defaultValue: 6000 },
  [THRESHOLD_KEY]: { min: -60, max: 0, defaultValue: -20 },
  [AMOUNT_KEY]: { min: 0, max: 24, defaultValue: 6 },
};

export const LISTEN_OFF = "Off";
export const LISTEN_ON = "On";
export const LISTEN_OPTIONS = [LISTEN_OFF, LISTEN_ON] as const;
export const LISTEN_DEFAULT = LISTEN_OFF;

// Whether the stored Listen value solos the detection band.
export function isListening(value: string) {
  return value.trim().toLowerCase() === LISTEN_ON.toLowerCase();
}

// The detector's envelope follows a rise in 1 ms and a fall in 50 ms.
export const ATTACK_SECONDS = 0.001;
export const RELEASE_SECONDS = 0.05;
// The detection band's Q: about an octave wide around Frequency.
export const DETECTOR_Q = Math.SQRT2;
// The split sits this far below Frequency, so the whole detection band
// lands in the reduced high band.
export const SPLIT_RATIO = 0.5;

const MINUS = "−";

// "−20.0 dB", "0.0 dB".
export function formatThresholdDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

// Amount only reduces, so it reads without a sign: "6.0 dB".
export function formatAmountDb(db: number) {
  return `${(Math.round(db * 10) / 10).toFixed(1)} dB`;
}

// "2.00 kHz", "12.0 kHz".
export function formatFrequency(hz: number) {
  if (hz < 1000) {
    return `${Math.round(hz)} Hz`;
  }
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

// How far to turn the high band down, in dB, for a detector level: the
// level's excess over Threshold, at most Amount.
export function reductionDb(
  levelDb: number,
  thresholdDb: number,
  amountDb: number,
) {
  return Math.min(Math.max(levelDb - thresholdDb, 0), Math.max(amountDb, 0));
}

// A peak envelope follower with a 1 ms attack and a 50 ms release.
export function createEnvelopeFollower(sampleRate: number) {
  const attack = Math.exp(-1 / (ATTACK_SECONDS * sampleRate));
  const release = Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  let envelope = 0;
  return {
    next(level: number) {
      const coefficient = level > envelope ? attack : release;
      envelope = level + (envelope - level) * coefficient;
      return envelope;
    },
    reset() {
      envelope = 0;
    },
  };
}

// A trapezoidal state-variable filter's coefficients, which stay stable and
// smooth while the cutoff moves, as it does while Frequency ramps.
export class SvfCoefficients {
  a1 = 0;
  a2 = 0;
  a3 = 0;
  readonly k: number;
  private hz = Number.NaN;
  private readonly sampleRate: number;

  constructor(sampleRate: number, q: number) {
    this.sampleRate = sampleRate;
    this.k = 1 / q;
  }

  // Back to its constructed state, so the next set() recomputes.
  reset() {
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.hz = Number.NaN;
  }

  set(hz: number) {
    if (hz === this.hz) {
      return;
    }
    this.hz = hz;
    const g = Math.tan(
      (Math.PI * Math.min(hz, 0.45 * this.sampleRate)) / this.sampleRate,
    );
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
}

// One channel's state-variable filter. After `process`, `low` and `band`
// hold its low-pass and band-pass outputs for the frame.
export class Svf {
  low = 0;
  band = 0;
  private ic1 = 0;
  private ic2 = 0;

  reset() {
    this.low = 0;
    this.band = 0;
    this.ic1 = 0;
    this.ic2 = 0;
  }

  process(sample: number, c: SvfCoefficients) {
    const v3 = sample - this.ic2;
    const v1 = c.a1 * this.ic1 + c.a2 * v3;
    const v2 = this.ic2 + c.a2 * this.ic1 + c.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
  }
}
