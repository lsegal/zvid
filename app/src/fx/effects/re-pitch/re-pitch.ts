// Re-Pitch shifts a clip's pitch by resampling, as a tape or turntable does
// when it plays faster or slower: its sound plays at 2^(semitones / 12) of
// its speed, so +12 semitones plays it an octave up at double speed and −12
// an octave down at half speed. Like Reverse, it changes where the clip
// reads its media rather than processing its sound, so it is a source stage
// (see AudioSourceStage). The clip keeps its length: sped up, it runs out of
// its source window early and falls silent; slowed down, it plays only the
// start of the window.

export const RE_PITCH_EFFECT_NAME = "Re-Pitch";
export const SEMITONES_KEY = "Semitones";
export const CENTS_KEY = "Cents";

export const SEMITONES_MIN = -12;
export const SEMITONES_MAX = 12;
export const CENTS_MIN = -100;
export const CENTS_MAX = 100;

const MINUS = "−";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function signed(value: number, unit: string) {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded)} ${unit}`;
}

// "0 st", "+7 st", "−12 st".
export function formatSemitones(semitones: number) {
  return signed(semitones, "st");
}

// "0 ct", "+25 ct", "−100 ct".
export function formatCents(cents: number) {
  return signed(cents, "ct");
}

// The speed the clip's sound plays at for a shift of `semitones` plus
// `cents`, each clamped to its range: 2 an octave up, 0.5 an octave down.
export function rePitchRate(semitones: number, cents = 0) {
  const shift =
    clamp(semitones || 0, SEMITONES_MIN, SEMITONES_MAX) +
    clamp(cents || 0, CENTS_MIN, CENTS_MAX) / 100;
  return 2 ** (shift / 12);
}

// The timeline second whose sound a clip starting at `startSeconds` plays at
// timeline second `seconds`, at `rate` times its speed.
export function rePitchReadSeconds(
  seconds: number,
  span: { startSeconds: number },
  rate: number,
) {
  return span.startSeconds + (seconds - span.startSeconds) * rate;
}
