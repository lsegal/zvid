// Histograms of the picture as it reaches an effect, read back from the
// preview for the device panels that show one, such as the Levels curve's.
// A panel watches its effect while it is shown; the preview's chain reads
// the picture back only for watched effects, at a reduced size and rate,
// and export never does.

export const HISTOGRAM_BINS = 64;

// The longest side, in pixels, of the copy a histogram is counted from.
export const ANALYSIS_SIZE = 128;

// The least time between two readbacks of one effect's picture.
export const ANALYSIS_INTERVAL_MS = 100;

// Each bin's share of the picture's pixels, weighted by their alpha, so
// transparent areas count for nothing. `luma` bins Rec. 709 luminance.
export type FrameHistogram = {
  red: Float32Array;
  green: Float32Array;
  blue: Float32Array;
  luma: Float32Array;
};

type Listener = (histogram: FrameHistogram) => void;

const watchers = new Map<string, Set<Listener>>();
const latest = new Map<string, FrameHistogram>();
const watchListeners = new Set<() => void>();

// Calls `listener` with each new histogram of the picture reaching the
// effect `effectId`, and with the last one now, if there is one. Returns a
// function that stops watching.
export function watchFrameHistogram(effectId: string, listener: Listener) {
  let set = watchers.get(effectId);
  if (!set) {
    set = new Set();
    watchers.set(effectId, set);
  }
  set.add(listener);
  const last = latest.get(effectId);
  if (last) {
    listener(last);
  }
  for (const watchListener of watchListeners) {
    watchListener();
  }
  return () => {
    set.delete(listener);
    if (!set.size && watchers.get(effectId) === set) {
      watchers.delete(effectId);
      latest.delete(effectId);
    }
  };
}

export function isFrameHistogramWatched(effectId: string) {
  return watchers.has(effectId);
}

// Calls `listener` whenever an effect starts being watched, so a paused
// preview can draw a frame to read back. Returns a function that stops it.
export function onFrameHistogramWatch(listener: () => void) {
  watchListeners.add(listener);
  return () => {
    watchListeners.delete(listener);
  };
}

// The histogram of RGBA `pixels`, 8 bits a channel.
export function countHistogram(pixels: Uint8Array): FrameHistogram {
  const red = new Float32Array(HISTOGRAM_BINS);
  const green = new Float32Array(HISTOGRAM_BINS);
  const blue = new Float32Array(HISTOGRAM_BINS);
  const luma = new Float32Array(HISTOGRAM_BINS);
  const scale = HISTOGRAM_BINS / 256;
  let total = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const weight = pixels[index + 3] / 255;
    if (weight <= 0) {
      continue;
    }
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    red[Math.floor(r * scale)] += weight;
    green[Math.floor(g * scale)] += weight;
    blue[Math.floor(b * scale)] += weight;
    luma[Math.floor((0.2126 * r + 0.7152 * g + 0.0722 * b) * scale)] += weight;
    total += weight;
  }
  if (total > 0) {
    for (const bins of [red, green, blue, luma]) {
      for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
        bins[bin] /= total;
      }
    }
  }
  return { red, green, blue, luma };
}

// Hands the RGBA `pixels` of the picture reaching `effectId` to its
// watchers as a histogram.
export function publishFrameHistogram(effectId: string, pixels: Uint8Array) {
  const set = watchers.get(effectId);
  if (!set) {
    return;
  }
  const histogram = countHistogram(pixels);
  latest.set(effectId, histogram);
  for (const listener of set) {
    listener(histogram);
  }
}
