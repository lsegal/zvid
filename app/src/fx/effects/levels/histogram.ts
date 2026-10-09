// The histogram Levels' curve is drawn over, counted from the picture the
// preview reads back where the effect sits (see fx-shaders/frame-analysis.ts).

import type { FrameSample } from "../../../fx-shaders/frame-analysis.ts";

export const HISTOGRAM_BINS = 64;

// Each bin's share of the picture's pixels, weighted by their alpha, so a
// layer's transparent areas count for nothing. `luma` bins Rec. 709
// luminance, for the master curve.
export type CurveHistogram = {
  red: Float32Array;
  green: Float32Array;
  blue: Float32Array;
  luma: Float32Array;
};

export function curveHistogram({
  width,
  height,
  pixels,
}: FrameSample): CurveHistogram {
  const red = new Float32Array(HISTOGRAM_BINS);
  const green = new Float32Array(HISTOGRAM_BINS);
  const blue = new Float32Array(HISTOGRAM_BINS);
  const luma = new Float32Array(HISTOGRAM_BINS);
  const scale = HISTOGRAM_BINS / 256;
  let total = 0;
  for (let index = 0; index < width * height * 4; index += 4) {
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
