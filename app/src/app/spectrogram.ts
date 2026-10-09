// The audio analysis pane's spectrogram of the program mix: time runs left
// to right, frequency bottom to top on a log scale, and each cell's color is
// the energy there. Each animation frame reads the master meter tap's
// spectrum and draws it as new columns at the right edge.

import { AUDIO_ANALYSIS_STORAGE_KEY } from "./constants.ts";

// The frequency range shown, bottom to top.
export const SPECTROGRAM_MIN_HZ = 20;
export const SPECTROGRAM_MAX_HZ = 20_000;
// Energy at or below MIN_DB draws as the background, and at or above MAX_DB
// as the hottest color.
export const SPECTROGRAM_MIN_DB = -100;
export const SPECTROGRAM_MAX_DB = -20;
// How fast the picture scrolls, in CSS pixels per second.
export const SPECTROGRAM_COLUMNS_PER_SECOND = 40;
// The frequency axis' labels.
export const SPECTROGRAM_TICKS_HZ = [100, 1_000, 10_000] as const;

// The color ramp, from silence to the loudest: the panel's background, then
// the theme's blue, purple and amber, and a warm white at the top.
export const SPECTROGRAM_PALETTE: readonly (readonly [
  number,
  readonly [number, number, number],
])[] = [
  [0, [27, 29, 42]],
  [0.3, [44, 58, 120]],
  [0.55, [124, 161, 255]],
  [0.72, [178, 130, 255]],
  [0.88, [246, 183, 60]],
  [1, [255, 244, 216]],
];

// Where `hz` sits along the frequency axis, from 0 (MIN_HZ and below, at the
// bottom) to 1 (MAX_HZ and above, at the top), on a log scale.
export function frequencyToPosition(hz: number) {
  if (!(hz > SPECTROGRAM_MIN_HZ)) {
    return 0;
  }
  const span = Math.log(SPECTROGRAM_MAX_HZ / SPECTROGRAM_MIN_HZ);
  return Math.min(1, Math.log(hz / SPECTROGRAM_MIN_HZ) / span);
}

// The frequency at `position` along the axis (see frequencyToPosition).
export function positionToFrequency(position: number) {
  return SPECTROGRAM_MIN_HZ * (SPECTROGRAM_MAX_HZ / SPECTROGRAM_MIN_HZ) ** position;
}

// An axis label: "100", "1k", "10k".
export function formatFrequency(hz: number) {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

// How hot `db` draws, from 0 (MIN_DB and below, or silence) to 1.
export function dbToIntensity(db: number) {
  if (!(db > SPECTROGRAM_MIN_DB)) {
    return 0;
  }
  return Math.min(
    1,
    (db - SPECTROGRAM_MIN_DB) / (SPECTROGRAM_MAX_DB - SPECTROGRAM_MIN_DB),
  );
}

// The power average of two spectra in dB, into `out`. A mono mix reads the
// same as either channel.
export function mergeChannelsDb(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  out: Float32Array,
) {
  for (let bin = 0; bin < out.length; bin++) {
    const power = (10 ** (left[bin] / 10) + 10 ** (right[bin] / 10)) / 2;
    out[bin] = power > 0 ? 10 * Math.log10(power) : -Infinity;
  }
  return out;
}

// One spectrogram column: the intensity of each of `out`'s rows, top
// (highest frequency) first, from `binsDb`, a spectrum whose bins are
// `binHz` apart. A row covering several bins takes the loudest; a row
// narrower than a bin, low down, interpolates between the nearest two.
export function spectrumColumn(
  binsDb: ArrayLike<number>,
  binHz: number,
  out: Float32Array,
) {
  const rows = out.length;
  const binDb = (bin: number) =>
    bin >= 0 && bin < binsDb.length ? binsDb[bin] : -Infinity;
  for (let row = 0; row < rows; row++) {
    const lowHz = positionToFrequency(1 - (row + 1) / rows);
    const highHz = positionToFrequency(1 - row / rows);
    const first = Math.ceil(lowHz / binHz);
    const last = Math.ceil(highHz / binHz) - 1;
    let db = -Infinity;
    if (last >= first) {
      for (let bin = first; bin <= last; bin++) {
        db = Math.max(db, binDb(bin));
      }
    } else {
      const exact = Math.sqrt(lowHz * highHz) / binHz;
      const below = Math.floor(exact);
      const t = exact - below;
      const [a, b] = [binDb(below), binDb(below + 1)];
      db = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : a;
    }
    out[row] = dbToIntensity(db);
  }
  return out;
}

// SPECTROGRAM_PALETTE sampled at `size` evenly spaced intensities, as RGBA.
export function spectrogramColors(size = 256) {
  const colors = new Uint8ClampedArray(size * 4);
  for (let index = 0; index < size; index++) {
    const intensity = index / (size - 1);
    let stop = 1;
    while (
      stop < SPECTROGRAM_PALETTE.length - 1 &&
      SPECTROGRAM_PALETTE[stop][0] < intensity
    ) {
      stop++;
    }
    const [fromAt, from] = SPECTROGRAM_PALETTE[stop - 1];
    const [toAt, to] = SPECTROGRAM_PALETTE[stop];
    const t = toAt > fromAt ? (intensity - fromAt) / (toAt - fromAt) : 0;
    for (let channel = 0; channel < 3; channel++) {
      colors[index * 4 + channel] = Math.round(
        from[channel] + (to[channel] - from[channel]) * t,
      );
    }
    colors[index * 4 + 3] = 255;
  }
  return colors;
}

// Turns the time between frames into whole columns to scroll by, carrying
// the remainder so the picture scrolls at the same speed whatever the frame
// rate.
export class SpectrogramClock {
  private lastMs: number | null = null;
  private carry = 0;

  // The columns to draw at `nowMs`, at `columnsPerSecond` (device pixels).
  advance(nowMs: number, columnsPerSecond: number) {
    const elapsedMs = this.lastMs === null ? 0 : nowMs - this.lastMs;
    this.lastMs = nowMs;
    const exact = this.carry + (Math.max(0, elapsedMs) * columnsPerSecond) / 1000;
    const columns = Math.floor(exact);
    this.carry = exact - columns;
    return columns;
  }

  // Restarting playback starts the frame timing afresh.
  restart() {
    this.lastMs = null;
    this.carry = 0;
  }
}

export function readAudioAnalysisOpen() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(AUDIO_ANALYSIS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAudioAnalysisOpen(open: boolean) {
  try {
    window.localStorage.setItem(AUDIO_ANALYSIS_STORAGE_KEY, String(open));
  } catch {
    // Private mode or a full quota: the toggle just won't persist.
  }
}
