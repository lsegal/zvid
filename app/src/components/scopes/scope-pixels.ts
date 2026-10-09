import {
  FRAME_LEVELS,
  type FrameSample,
  histogramCounts,
  waveformCounts,
} from "../../fx-shaders/frame-analysis.ts";
import { waveformIntensity, waveformPixels } from "../fx/controls/waveform.ts";

// The scopes the preview's Scopes pane can show, Lumetri's usual set.
export const SCOPE_KINDS = [
  { kind: "waveform", label: "Waveform" },
  { kind: "parade", label: "Parade" },
  { kind: "vectorscope", label: "Vectorscope" },
  { kind: "histogram", label: "Histogram" },
] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number]["kind"];

// A scope's trace as opaque RGBA pixels, top row first, black where unlit.
export type ScopeImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

// The RGB waveform: each channel lights its own color at the levels its
// column's pixels sit at, `sample.width` columns by `rows`.
export function waveformImage(sample: FrameSample, rows: number): ScopeImage {
  return {
    width: sample.width,
    height: rows,
    pixels: waveformPixels(sample, rows),
  };
}

// The RGB parade: the red, green and blue waveforms side by side, each in
// its own color, `3 * sample.width` columns by `rows`.
export function paradeImage(sample: FrameSample, rows: number): ScopeImage {
  const { width, height } = sample;
  const counts = waveformCounts(sample);
  const columns = 3 * width;
  const cells = new Uint32Array(columns * rows);
  for (let level = 0; level < FRAME_LEVELS; level++) {
    const row = rows - 1 - Math.floor((level * rows) / FRAME_LEVELS);
    for (let channel = 0; channel < 3; channel++) {
      for (let column = 0; column < width; column++) {
        cells[row * columns + channel * width + column] +=
          counts[(channel * width + column) * FRAME_LEVELS + level];
      }
    }
  }
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  for (let cell = 0; cell < columns * rows; cell++) {
    const channel = Math.floor((cell % columns) / width);
    const count = cells[cell];
    pixels[cell * 4 + channel] = count
      ? Math.round(255 * waveformIntensity(count / height))
      : 0;
    pixels[cell * 4 + 3] = 255;
  }
  return { width: columns, height: rows, pixels };
}

// Where a color sits on the vectorscope, from -0.5 to 0.5 on each axis:
// its BT.709 blue (Cb) and red (Cr) differences, for 0..1 channels.
export function chromaOf(red: number, green: number, blue: number) {
  const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return { cb: (blue - luma) / 1.8556, cr: (red - luma) / 1.5748 };
}

// How brightly a vectorscope cell holding `count` of `total` pixels draws,
// spread over `cells`: a cell with its fair share of the picture is lit.
const VECTORSCOPE_GAIN = 4;

// The vectorscope: each pixel lights the cell at its chroma, Cb across and
// Cr up, on a `size` × `size` grid whose edges are ±0.5.
export function vectorscopeImage(
  sample: FrameSample,
  size: number,
): ScopeImage {
  const { width, height, pixels: source } = sample;
  const total = width * height;
  const cells = new Uint32Array(size * size);
  for (let pixel = 0; pixel < total * 4; pixel += 4) {
    const { cb, cr } = chromaOf(
      source[pixel] / 255,
      source[pixel + 1] / 255,
      source[pixel + 2] / 255,
    );
    const x = Math.min(size - 1, Math.max(0, Math.floor((cb + 0.5) * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor((0.5 - cr) * size)));
    cells[y * size + x]++;
  }
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let cell = 0; cell < size * size; cell++) {
    const count = cells[cell];
    const lit = count
      ? Math.min(1, Math.sqrt((count * VECTORSCOPE_GAIN * size) / total))
      : 0;
    pixels[cell * 4] = Math.round(200 * lit);
    pixels[cell * 4 + 1] = Math.round(255 * lit);
    pixels[cell * 4 + 2] = Math.round(210 * lit);
    pixels[cell * 4 + 3] = 255;
  }
  return { width: size, height: size, pixels };
}

// The histogram: for each level across, a bar per channel as tall as its
// share of the busiest level, the channels adding up where they overlap.
export function histogramImage(sample: FrameSample, rows: number): ScopeImage {
  const counts = histogramCounts(sample);
  const most = Math.max(1, ...counts);
  const pixels = new Uint8ClampedArray(FRAME_LEVELS * rows * 4);
  for (let level = 0; level < FRAME_LEVELS; level++) {
    for (let channel = 0; channel < 3; channel++) {
      const bar = Math.round(
        (counts[channel * FRAME_LEVELS + level] / most) * rows,
      );
      for (let row = rows - bar; row < rows; row++) {
        pixels[(row * FRAME_LEVELS + level) * 4 + channel] = 220;
      }
    }
  }
  for (let pixel = 3; pixel < pixels.length; pixel += 4) {
    pixels[pixel] = 255;
  }
  return { width: FRAME_LEVELS, height: rows, pixels };
}

// `kind`'s image of `sample`, `rows` tall; the vectorscope is square.
export function scopeImage(
  kind: ScopeKind,
  sample: FrameSample,
  rows: number,
): ScopeImage {
  switch (kind) {
    case "waveform":
      return waveformImage(sample, rows);
    case "parade":
      return paradeImage(sample, rows);
    case "vectorscope":
      return vectorscopeImage(sample, rows);
    case "histogram":
      return histogramImage(sample, rows);
  }
}
