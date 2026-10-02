// The EQ effect's DSP: three RBJ cookbook biquads in series (low shelf,
// mid peak, high shelf), its parameter ranges and readouts. At 0 dB on
// every band the filters reduce to identity, so the EQ is transparent.

export const EQ_EFFECT_NAME = "EQ";

export const LOW_FREQ_KEY = "Low Freq";
export const LOW_GAIN_KEY = "Low Gain";
export const MID_FREQ_KEY = "Mid Freq";
export const MID_GAIN_KEY = "Mid Gain";
export const MID_Q_KEY = "Mid Q";
export const HIGH_FREQ_KEY = "High Freq";
export const HIGH_GAIN_KEY = "High Gain";

export const EQ_GAIN_MIN_DB = -15;
export const EQ_GAIN_MAX_DB = 15;

export const EQ_RANGES = {
  [LOW_FREQ_KEY]: { min: 20, max: 1000, defaultValue: 100 },
  [LOW_GAIN_KEY]: { min: EQ_GAIN_MIN_DB, max: EQ_GAIN_MAX_DB, defaultValue: 0 },
  [MID_FREQ_KEY]: { min: 100, max: 10_000, defaultValue: 1000 },
  [MID_GAIN_KEY]: { min: EQ_GAIN_MIN_DB, max: EQ_GAIN_MAX_DB, defaultValue: 0 },
  [MID_Q_KEY]: { min: 0.3, max: 10, defaultValue: 1 },
  [HIGH_FREQ_KEY]: { min: 1000, max: 20_000, defaultValue: 8000 },
  [HIGH_GAIN_KEY]: {
    min: EQ_GAIN_MIN_DB,
    max: EQ_GAIN_MAX_DB,
    defaultValue: 0,
  },
} as const;

export type EqParameterKey = keyof typeof EQ_RANGES;

export type EqSettings = {
  lowFreq: number;
  lowGain: number;
  midFreq: number;
  midGain: number;
  midQ: number;
  highFreq: number;
  highGain: number;
};

const MINUS = "−";

// "100 Hz", "1.50 kHz", "12.0 kHz".
export function formatFrequency(hz: number) {
  if (hz < 1000) {
    return `${Math.round(hz)} Hz`;
  }
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

// "0.0 dB", "+3.5 dB", "−12.0 dB".
export function formatEqGain(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

export function formatQ(q: number) {
  return q.toFixed(2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type EqParameter = { key: string; value: string; numericValue?: number };

function readNumber(parameters: readonly EqParameter[], key: EqParameterKey) {
  const range = EQ_RANGES[key];
  const stored = parameters.find((parameter) => parameter.key === key);
  const value =
    stored?.numericValue ??
    (stored ? Number.parseFloat(stored.value) : Number.NaN);
  return Number.isFinite(value)
    ? clamp(value, range.min, range.max)
    : range.defaultValue;
}

// The settings of one EQ from its stored parameters, clamped to range, with
// defaults for missing or unreadable values.
export function readEqSettings(parameters: readonly EqParameter[]): EqSettings {
  return {
    lowFreq: readNumber(parameters, LOW_FREQ_KEY),
    lowGain: readNumber(parameters, LOW_GAIN_KEY),
    midFreq: readNumber(parameters, MID_FREQ_KEY),
    midGain: readNumber(parameters, MID_GAIN_KEY),
    midQ: readNumber(parameters, MID_Q_KEY),
    highFreq: readNumber(parameters, HIGH_FREQ_KEY),
    highGain: readNumber(parameters, HIGH_GAIN_KEY),
  };
}

// Normalized biquad coefficients (a0 = 1).
export type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export type BiquadKind = "lowshelf" | "peaking" | "highshelf";

// RBJ Audio EQ Cookbook coefficients. Shelves use slope S = 1; the peak
// uses `q`. Frequencies are kept below Nyquist so a 20 kHz corner stays
// stable at 44.1 kHz.
export function biquadCoefficients(
  kind: BiquadKind,
  frequency: number,
  gainDb: number,
  q: number,
  sampleRate: number,
): BiquadCoefficients {
  const f = clamp(frequency, 1, sampleRate * 0.49);
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (kind === "peaking") {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * a;
    b1 = -2 * cos;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cos;
    a2 = 1 - alpha / a;
  } else {
    const alpha = (sin / 2) * Math.SQRT2;
    const root = 2 * Math.sqrt(a) * alpha;
    const sign = kind === "lowshelf" ? 1 : -1;
    b0 = a * (a + 1 - sign * (a - 1) * cos + root);
    b1 = sign * 2 * a * (a - 1 - sign * (a + 1) * cos);
    b2 = a * (a + 1 - sign * (a - 1) * cos - root);
    a0 = a + 1 + sign * (a - 1) * cos + root;
    a1 = -sign * 2 * (a - 1 + sign * (a + 1) * cos);
    a2 = a + 1 + sign * (a - 1) * cos - root;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// The three bands' coefficients for `settings`, in processing order.
export function eqCoefficients(settings: EqSettings, sampleRate: number) {
  return [
    biquadCoefficients(
      "lowshelf",
      settings.lowFreq,
      settings.lowGain,
      Math.SQRT1_2,
      sampleRate,
    ),
    biquadCoefficients(
      "peaking",
      settings.midFreq,
      settings.midGain,
      settings.midQ,
      sampleRate,
    ),
    biquadCoefficients(
      "highshelf",
      settings.highFreq,
      settings.highGain,
      Math.SQRT1_2,
      sampleRate,
    ),
  ];
}

// The EQ's magnitude response in dB at `frequency`, for tests and displays.
export function eqResponseDb(
  settings: EqSettings,
  frequency: number,
  sampleRate: number,
) {
  const w = (2 * Math.PI * frequency) / sampleRate;
  let db = 0;
  for (const c of eqCoefficients(settings, sampleRate)) {
    // |H(e^jw)| from the numerator and denominator at z = e^jw.
    const nRe = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w);
    const nIm = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
    const dRe = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
    const dIm = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
    db += 10 * Math.log10((nRe * nRe + nIm * nIm) / (dRe * dRe + dIm * dIm));
  }
  return db;
}

const SETTING_KEYS = [
  "lowFreq",
  "lowGain",
  "midFreq",
  "midGain",
  "midQ",
  "highFreq",
  "highGain",
] as const satisfies readonly (keyof EqSettings)[];

function settingsEqual(a: EqSettings, b: EqSettings) {
  return SETTING_KEYS.every((key) => a[key] === b[key]);
}

// Whether `settings` leave the sound unchanged: every band at 0 dB.
export function isFlat(settings: EqSettings) {
  return (
    settings.lowGain === 0 && settings.midGain === 0 && settings.highGain === 0
  );
}

// The three bands' filter memory for each channel, run with the latest
// settings' coefficients. Uses transposed direct form II in doubles.
export class EqFilter {
  private settings: EqSettings | null = null;
  private coefficients: BiquadCoefficients[] = [];
  // Per channel: z1 and z2 of each band in turn.
  private readonly state: Float64Array[];

  constructor(
    readonly sampleRate: number,
    channels: number,
  ) {
    this.state = Array.from({ length: channels }, () => new Float64Array(6));
  }

  // Uses `settings` from the next frame processed on.
  setSettings(settings: EqSettings) {
    if (this.settings && settingsEqual(this.settings, settings)) {
      return;
    }
    this.settings = { ...settings };
    this.coefficients = eqCoefficients(settings, this.sampleRate);
  }

  // Filters frames `start` to `end` of `input` into `output`. A flat EQ
  // copies them unchanged, and its memory is that of identity filters: 0.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    start: number,
    end: number,
  ) {
    const flat = !this.settings || isFlat(this.settings);
    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel];
      const to = output[channel];
      const z = this.state[channel];
      if (flat) {
        to.set(from.subarray(start, end), start);
        z.fill(0);
        continue;
      }
      for (let index = start; index < end; index++) {
        let x = from[index];
        for (let band = 0; band < 3; band++) {
          const c = this.coefficients[band];
          const y = c.b0 * x + z[band * 2];
          z[band * 2] = c.b1 * x - c.a1 * y + z[band * 2 + 1];
          z[band * 2 + 1] = c.b2 * x - c.a2 * y;
          x = y;
        }
        to[index] = x;
      }
    }
  }
}
