// The High Pass effect's DSP: an RBJ cookbook high-pass biquad, cascaded
// for 24 dB/oct, its parameter ranges and readouts. At Resonance 0.707 both
// slopes are Butterworth, so the cutoff is the −3 dB point either way.

export const HIGH_PASS_EFFECT_NAME = "High Pass";

export const FREQUENCY_KEY = "Frequency";
export const RESONANCE_KEY = "Resonance";
export const SLOPE_KEY = "Slope";

export type HighPassNumberKey = typeof FREQUENCY_KEY | typeof RESONANCE_KEY;

export const HIGH_PASS_RANGES: Readonly<
  Record<HighPassNumberKey, { min: number; max: number; defaultValue: number }>
> = {
  [FREQUENCY_KEY]: { min: 20, max: 20_000, defaultValue: 80 },
  [RESONANCE_KEY]: { min: 0.1, max: 18, defaultValue: Math.SQRT1_2 },
};

export const HIGH_PASS_SLOPES = ["12 dB/oct", "24 dB/oct"] as const;
export type HighPassSlope = (typeof HIGH_PASS_SLOPES)[number];
export const DEFAULT_HIGH_PASS_SLOPE: HighPassSlope = "12 dB/oct";

// The stored Slope as one of the slopes; anything else is 12 dB/oct.
export function highPassSlope(value: string): HighPassSlope {
  const match = HIGH_PASS_SLOPES.find(
    (slope) => slope.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? DEFAULT_HIGH_PASS_SLOPE;
}

export type HighPassSettings = {
  frequency: number;
  resonance: number;
  slope: HighPassSlope;
};

// "80 Hz", "1.50 kHz", "12.0 kHz".
export function formatFrequency(hz: number) {
  if (hz < 1000) {
    return `${Math.round(hz)} Hz`;
  }
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

export function formatResonance(q: number) {
  return q.toFixed(2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Normalized biquad coefficients (a0 = 1).
export type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

// RBJ Audio EQ Cookbook high-pass coefficients. The frequency is kept below
// Nyquist so a 20 kHz cutoff stays stable at 44.1 kHz.
export function highPassCoefficients(
  frequency: number,
  q: number,
  sampleRate: number,
): BiquadCoefficients {
  const f = clamp(frequency, 1, sampleRate * 0.49);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  return {
    b0,
    b1: -2 * b0,
    b2: b0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

// The pole Qs of a 4th-order Butterworth filter. The 24 dB/oct slope runs
// the first as is and scales the second by Resonance / 0.707, so the
// default is flat down to the cutoff and higher settings peak there.
const BUTTERWORTH_4_Q1 = 0.541_196_1;
const BUTTERWORTH_4_Q2 = 1.306_563;

// The stages' coefficients for `settings`, in processing order.
export function highPassStages(settings: HighPassSettings, sampleRate: number) {
  if (settings.slope === "24 dB/oct") {
    const scale = settings.resonance / Math.SQRT1_2;
    return [
      highPassCoefficients(settings.frequency, BUTTERWORTH_4_Q1, sampleRate),
      highPassCoefficients(
        settings.frequency,
        BUTTERWORTH_4_Q2 * scale,
        sampleRate,
      ),
    ];
  }
  return [
    highPassCoefficients(settings.frequency, settings.resonance, sampleRate),
  ];
}

// The filter's magnitude response in dB at `frequency`, for tests and
// displays.
export function highPassResponseDb(
  settings: HighPassSettings,
  frequency: number,
  sampleRate: number,
) {
  const w = (2 * Math.PI * frequency) / sampleRate;
  let db = 0;
  for (const c of highPassStages(settings, sampleRate)) {
    // |H(e^jw)| from the numerator and denominator at z = e^jw.
    const nRe = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w);
    const nIm = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
    const dRe = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
    const dIm = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
    db += 10 * Math.log10((nRe * nRe + nIm * nIm) / (dRe * dRe + dIm * dIm));
  }
  return db;
}

function settingsEqual(a: HighPassSettings, b: HighPassSettings) {
  return (
    a.frequency === b.frequency &&
    a.resonance === b.resonance &&
    a.slope === b.slope
  );
}

// Each stage's filter memory for each channel, run with the latest
// settings' coefficients. Uses transposed direct form II in doubles.
//
// A fresh filter starts from silence. Unlike a low-pass, which passes the
// held level of a signal, a high-pass passes its fast movement, so from rest
// its first output (b0 × input) already tracks content above the cutoff; a
// filter faded in on a Slope change therefore matches the outgoing one.
export class HighPassFilter {
  private settings: HighPassSettings | null = null;
  private stages: BiquadCoefficients[] = [];
  // Per channel: z1 and z2 of each stage in turn.
  private readonly state: Float64Array[];

  readonly sampleRate: number;

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.state = Array.from({ length: channels }, () => new Float64Array(4));
  }

  // Uses `settings` from the next frame processed on. The slope is fixed
  // for the filter's life: the host crossfades to a fresh one to change it.
  setSettings(settings: HighPassSettings) {
    if (this.settings && settingsEqual(this.settings, settings)) {
      return;
    }
    this.settings = { ...settings };
    this.stages = highPassStages(settings, this.sampleRate);
  }

  // Filters frames `start` to `end` of `input` into `output`.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    start: number,
    end: number,
  ) {
    const stages = this.stages;
    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel];
      const to = output[channel];
      const z = this.state[channel];
      for (let index = start; index < end; index++) {
        let x = from[index];
        for (let stage = 0; stage < stages.length; stage++) {
          const c = stages[stage];
          const y = c.b0 * x + z[stage * 2];
          z[stage * 2] = c.b1 * x - c.a1 * y + z[stage * 2 + 1];
          z[stage * 2 + 1] = c.b2 * x - c.a2 * y;
          x = y;
        }
        to[index] = x;
      }
    }
  }
}
