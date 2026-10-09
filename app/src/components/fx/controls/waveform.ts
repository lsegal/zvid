import {
  FRAME_LEVELS,
  type FrameSample,
  waveformCounts,
} from "../../../fx-shaders/frame-analysis.ts";

// The waveform's scale: 10-bit levels, labeled every 128.
export const WAVEFORM_MAX_LEVEL = 1023;
export const WAVEFORM_TICKS = [0, 128, 256, 384, 512, 640, 768, 896, 1023];

// How bright a cell holding `share` of its column's pixels draws, 0..1: a
// cell with a whole column is full, and a column spread over many levels
// still shows.
const WAVEFORM_GAIN = 48;

export function waveformIntensity(share: number) {
  return Math.min(1, Math.sqrt(share * WAVEFORM_GAIN));
}

// `sample`'s waveform as RGBA pixels, `sample.width` columns by `rows`,
// the top row the highest level: each channel lights its own color at the
// levels its column's pixels sit at, so where red, green and blue overlap
// they add up to white. Opaque black elsewhere.
export function waveformPixels(sample: FrameSample, rows: number) {
  const { width, height } = sample;
  const counts = waveformCounts(sample);
  const cells = new Uint16Array(3 * width * rows);
  for (let level = 0; level < FRAME_LEVELS; level++) {
    const row = rows - 1 - Math.floor((level * rows) / FRAME_LEVELS);
    for (let channel = 0; channel < 3; channel++) {
      for (let column = 0; column < width; column++) {
        cells[(row * width + column) * 3 + channel] +=
          counts[(channel * width + column) * FRAME_LEVELS + level];
      }
    }
  }
  const image = new Uint8ClampedArray(width * rows * 4);
  for (let cell = 0; cell < width * rows; cell++) {
    for (let channel = 0; channel < 3; channel++) {
      const count = cells[cell * 3 + channel];
      image[cell * 4 + channel] = count
        ? Math.round(255 * waveformIntensity(count / height))
        : 0;
    }
    image[cell * 4 + 3] = 255;
  }
  return image;
}
