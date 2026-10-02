// The Stereo effect's math: mid/side width and an equal-power balance.
// Width scales the side signal (L−R)/2 against the mid (L+R)/2, so 0 %
// folds to mono, 100 % leaves the image as it is and 200 % doubles the
// side. Pan then weights the two sides with an equal-power law normalised
// to unity at centre: each side is −3 dB below its fully panned level, and
// a hard pan silences the other side.

export const STEREO_EFFECT_NAME = "Stereo";
export const WIDTH_KEY = "Width";
export const PAN_KEY = "Pan";

export const WIDTH_MIN = 0;
export const WIDTH_MAX = 200;
export const WIDTH_DEFAULT = 100;
export const PAN_MIN = -100;
export const PAN_MAX = 100;
export const PAN_DEFAULT = 0;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// "0%" … "200%".
export function formatWidth(width: number) {
  return `${Math.round(width)}%`;
}

// "C" at centre, else the side and amount such as "L 40" or "R 100".
export function formatPan(pan: number) {
  const rounded = Math.round(pan);
  if (rounded === 0) {
    return "C";
  }
  return `${rounded < 0 ? "L" : "R"} ${Math.abs(rounded)}`;
}

// The side signal's scale for a width in percent.
export function sideScale(width: number) {
  return clamp(width, WIDTH_MIN, WIDTH_MAX) / 100;
}

// The left and right amplitudes for a pan: √2·cos θ and √2·sin θ for θ
// from 0 (hard left) to π/2 (hard right), so both are 1 at centre and
// left² + right² is always 2.
export function panAmplitudes(pan: number): [number, number] {
  const theta =
    ((clamp(pan, PAN_MIN, PAN_MAX) - PAN_MIN) / 200) * (Math.PI / 2);
  // Exact at the ends and the centre, where cos and sin round.
  if (theta === 0) {
    return [Math.SQRT2, 0];
  }
  if (theta === Math.PI / 2) {
    return [0, Math.SQRT2];
  }
  if (theta === Math.PI / 4) {
    return [1, 1];
  }
  return [Math.SQRT2 * Math.cos(theta), Math.SQRT2 * Math.sin(theta)];
}
