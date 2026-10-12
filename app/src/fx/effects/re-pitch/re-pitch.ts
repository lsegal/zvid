// Re-Pitch shifts a clip's pitch by 2^(semitones / 12), so +12 semitones
// plays it an octave up and −12 an octave down, in one of three ways:
//
// - Tape (the default) resamples, as a tape or turntable does when it plays
//   faster or slower: +12 plays at double speed and −12 at half. Like
//   Reverse, it changes where the clip reads its media rather than
//   processing its sound, so it is a source stage (see AudioSourceStage).
//   The clip keeps its length: sped up, it runs out of its source window
//   early and falls silent; slowed down, it plays only the start of the
//   window.
// - Transients keeps the sound's timing with overlapping grains, each read
//   at the shifted speed, and starts a fresh grain at every attack so drums
//   stay crisp (see transients.ts).
// - Formants keeps the sound's timing with a phase vocoder and keeps its
//   spectral envelope where it was, so voices and instruments keep their
//   character rather than turning chipmunk or muffled (see formants.ts).
//
// The two that keep timing process the clip's sound frameSize frames late,
// which the mix compensates for (see AudioEffectDsp.latencyFrames).

export const RE_PITCH_EFFECT_NAME = "Re-Pitch";
export const SEMITONES_KEY = "Semitones";
export const CENTS_KEY = "Cents";
export const ALGORITHM_KEY = "Algorithm";
export const TRANSIENTS_KEY = "Transients";
export const FORMANTS_KEY = "Formants";

export const ALGORITHM_TAPE = "Tape";
export const ALGORITHM_TRANSIENTS = "Transients";
export const ALGORITHM_FORMANTS = "Formants";
export const ALGORITHM_OPTIONS = [
  ALGORITHM_TAPE,
  ALGORITHM_TRANSIENTS,
  ALGORITHM_FORMANTS,
] as const;
// Tape, so sessions made before the Algorithm existed sound as they did.
export const ALGORITHM_DEFAULT = ALGORITHM_TAPE;

// Fractions, shown as percentages.
export const TRANSIENTS_DEFAULT = 1;
export const FORMANTS_DEFAULT = 1;

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

// Whether `algorithm` keeps the sound's timing rather than resampling it.
export function preservesTime(algorithm: string | undefined) {
  return (
    algorithm === ALGORITHM_TRANSIENTS || algorithm === ALGORITHM_FORMANTS
  );
}

// The frames the time-keeping algorithms analyze at once: the smallest
// power of two at least 40 ms long, 2048 at 44.1 or 48 kHz.
export function rePitchFrameSize(sampleRate: number) {
  return 2 ** Math.ceil(Math.log2(Math.max(64, sampleRate * 0.04)));
}

// How late `algorithm` plays the clip's sound: a frame for those that keep
// timing, none for Tape.
export function rePitchLatencyFrames(
  algorithm: string | undefined,
  sampleRate: number,
) {
  return preservesTime(algorithm) ? rePitchFrameSize(sampleRate) : 0;
}

// How long the time-keeping algorithms keep sounding past their latency
// once the clip falls silent: their last frame, at most 64 ms at 8 kHz.
export function rePitchTailSeconds(algorithm: string | undefined) {
  return preservesTime(algorithm) ? 0.1 : 0;
}
