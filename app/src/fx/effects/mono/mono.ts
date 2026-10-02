// The Mono effect's math: folds a stereo signal to one channel, the sum
// (L+R)/2 or either side, and blends it with the original by Amount.

export const MONO_EFFECT_NAME = "Mono";
export const SOURCE_KEY = "Source";
export const AMOUNT_KEY = "Amount";

export const SOURCE_SUM = "Sum";
export const SOURCE_LEFT = "Left";
export const SOURCE_RIGHT = "Right";
export const MONO_SOURCES = [SOURCE_SUM, SOURCE_LEFT, SOURCE_RIGHT] as const;

// Amount is stored as a fraction: 0 leaves the stereo image alone, 1 is
// fully mono.
export const AMOUNT_DEFAULT = 1;

// The mono sample from a stereo frame. Sum halves L+R, so it never clips
// from summing.
export function monoSample(source: string, left: number, right: number) {
  if (source === SOURCE_LEFT) {
    return left;
  }
  if (source === SOURCE_RIGHT) {
    return right;
  }
  return (left + right) / 2;
}

// A channel's sample blended `amount` of the way to `mono`.
export function blendToMono(sample: number, mono: number, amount: number) {
  const clamped = Math.min(1, Math.max(0, amount));
  return sample + (mono - sample) * clamped;
}
