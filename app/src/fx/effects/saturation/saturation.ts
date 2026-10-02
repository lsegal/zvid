// The Saturation effect's parameters, readouts and shaping curves. The
// processor (processor.ts) runs them 4× oversampled.

export const SATURATION_EFFECT_NAME = "Saturation";

export const DRIVE_KEY = "Drive";
export const TYPE_KEY = "Type";
export const TONE_KEY = "Tone";
export const OUTPUT_KEY = "Output";
export const MIX_KEY = "Mix";

export type SaturationNumberKey =
  | typeof DRIVE_KEY
  | typeof TONE_KEY
  | typeof OUTPUT_KEY
  | typeof MIX_KEY;

export const SATURATION_RANGES: Readonly<
  Record<
    SaturationNumberKey,
    { min: number; max: number; defaultValue: number }
  >
> = {
  [DRIVE_KEY]: { min: 0, max: 36, defaultValue: 6 },
  [TONE_KEY]: { min: 1000, max: 20_000, defaultValue: 12_000 },
  [OUTPUT_KEY]: { min: -24, max: 6, defaultValue: 0 },
  [MIX_KEY]: { min: 0, max: 1, defaultValue: 1 },
};

export const SATURATION_TYPES = ["Soft", "Hard", "Tape", "Tube"] as const;
export type SaturationType = (typeof SATURATION_TYPES)[number];
export const DEFAULT_SATURATION_TYPE: SaturationType = "Soft";

// The stored Type as one of the curves; anything else is Soft.
export function saturationType(value: string): SaturationType {
  const match = SATURATION_TYPES.find(
    (type) => type.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? DEFAULT_SATURATION_TYPE;
}

const MINUS = "−";

// "0.0 dB", "+3.5 dB", "−12.0 dB".
export function formatSaturationDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

// Drive only boosts, so it reads without a sign: "6.0 dB".
export function formatDrive(db: number) {
  return `${(Math.round(db * 10) / 10).toFixed(1)} dB`;
}

// "1.00 kHz", "12.0 kHz".
export function formatTone(hz: number) {
  if (hz < 1000) {
    return `${Math.round(hz)} Hz`;
  }
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

// Tube's bias: how far off center its curve is driven, which makes its
// halves differ and so adds even harmonics.
const TUBE_BIAS = 0.5;
const TUBE_OFFSET = Math.tanh(TUBE_BIAS);
const TUBE_SLOPE = 1 - TUBE_OFFSET * TUBE_OFFSET;

// Tape's negative half saturates this much later than its positive one.
const TAPE_NEGATIVE_HEADROOM = 1.25;

// Each curve passes through 0 with a slope of 1, so a quiet signal comes
// out as it went in. Soft is tanh, Hard clips at ±1, Tape bends its halves
// to different limits and Tube is a biased tanh, whose asymmetric halves
// add even harmonics from the first decibel of drive.
export function shapeSoft(x: number) {
  return Math.tanh(x);
}

export function shapeHard(x: number) {
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

export function shapeTape(x: number) {
  return x >= 0
    ? Math.tanh(x)
    : TAPE_NEGATIVE_HEADROOM * Math.tanh(x / TAPE_NEGATIVE_HEADROOM);
}

export function shapeTube(x: number) {
  return (Math.tanh(x + TUBE_BIAS) - TUBE_OFFSET) / TUBE_SLOPE;
}

// dB as a linear amplitude.
export function dbToAmplitude(db: number) {
  return 10 ** (db / 20);
}
