import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FrameSample } from "../../fx-shaders/frame-analysis.ts";
import {
  chromaOf,
  histogramImage,
  paradeImage,
  scopeImage,
  vectorscopeImage,
} from "./scope-pixels.ts";

// A `width` × 1 sample whose pixels are `colors`, as RGB.
function sampleOf(colors: Array<[number, number, number]>): FrameSample {
  const pixels = new Uint8Array(colors.length * 4);
  colors.forEach(([red, green, blue], index) => {
    pixels.set([red, green, blue, 255], index * 4);
  });
  return { width: colors.length, height: 1, pixels };
}

// The RGB of image cell (`x`, `y`).
function cell(
  image: { width: number; pixels: Uint8ClampedArray },
  x: number,
  y: number,
) {
  const at = (y * image.width + x) * 4;
  return Array.from(image.pixels.subarray(at, at + 3));
}

// The rows of column `x` that are lit in channel `channel`.
function litRows(
  image: { width: number; height: number; pixels: Uint8ClampedArray },
  x: number,
  channel: number,
) {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y++) {
    if (cell(image, x, y)[channel] > 0) {
      rows.push(y);
    }
  }
  return rows;
}

describe("paradeImage", () => {
  it("puts red, green and blue side by side, each at its own level", () => {
    // One pixel: red full, green half, blue off.
    const image = paradeImage(sampleOf([[255, 128, 0]]), 4);
    assert.equal(image.width, 3);
    assert.equal(image.height, 4);
    assert.deepEqual(litRows(image, 0, 0), [0]);
    assert.deepEqual(litRows(image, 1, 1), [1]);
    assert.deepEqual(litRows(image, 2, 2), [3]);
    // Each third lights only its own channel.
    assert.deepEqual(cell(image, 0, 0), [255, 0, 0]);
    assert.deepEqual(cell(image, 1, 1), [0, 255, 0]);
    // Every pixel is opaque.
    for (let alpha = 3; alpha < image.pixels.length; alpha += 4) {
      assert.equal(image.pixels[alpha], 255);
    }
  });
});

describe("chromaOf", () => {
  it("puts grays at the center and primaries on their axes", () => {
    for (const gray of [0, 0.5, 1]) {
      const { cb, cr } = chromaOf(gray, gray, gray);
      assert.ok(Math.abs(cb) < 1e-9 && Math.abs(cr) < 1e-9);
    }
    const red = chromaOf(1, 0, 0);
    assert.ok(Math.abs(red.cr - 0.5) < 1e-3);
    assert.ok(red.cb < 0);
    const blue = chromaOf(0, 0, 1);
    assert.ok(Math.abs(blue.cb - 0.5) < 1e-3);
    assert.ok(blue.cr < 0);
  });
});

describe("vectorscopeImage", () => {
  it("lights the center for a gray picture", () => {
    const image = vectorscopeImage(
      sampleOf([
        [128, 128, 128],
        [128, 128, 128],
      ]),
      8,
    );
    assert.equal(image.width, 8);
    assert.equal(image.height, 8);
    assert.ok(cell(image, 4, 4)[1] > 0);
    assert.equal(cell(image, 0, 0)[1], 0);
  });

  it("lights red toward the top left and blue toward the right", () => {
    const red = vectorscopeImage(sampleOf([[255, 0, 0]]), 8);
    const blue = vectorscopeImage(sampleOf([[0, 0, 255]]), 8);
    const lit = (image: ReturnType<typeof vectorscopeImage>) => {
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (cell(image, x, y)[1] > 0) {
            return { x, y };
          }
        }
      }
      return null;
    };
    const redAt = lit(red);
    const blueAt = lit(blue);
    assert.ok(redAt && redAt.x < 4 && redAt.y === 0);
    assert.ok(blueAt && blueAt.x === 7 && blueAt.y >= 4);
  });
});

describe("histogramImage", () => {
  it("draws each channel's bar at its level, tallest for the busiest", () => {
    const image = histogramImage(
      sampleOf([
        [0, 255, 0],
        [0, 255, 0],
        [255, 0, 0],
      ]),
      4,
    );
    assert.equal(image.width, 256);
    assert.equal(image.height, 4);
    // Blue sits at 0 for all three pixels, the busiest level: full height.
    assert.deepEqual(litRows(image, 0, 2), [0, 1, 2, 3]);
    // Green at 255 holds two of them, red one.
    assert.deepEqual(litRows(image, 255, 1), [1, 2, 3]);
    assert.deepEqual(litRows(image, 255, 0), [3]);
    assert.deepEqual(litRows(image, 128, 0), []);
  });
});

describe("scopeImage", () => {
  it("makes the waveform the sample's width and the vectorscope square", () => {
    const sample = sampleOf([
      [10, 20, 30],
      [40, 50, 60],
    ]);
    const waveform = scopeImage("waveform", sample, 5);
    assert.deepEqual([waveform.width, waveform.height], [2, 5]);
    const parade = scopeImage("parade", sample, 5);
    assert.deepEqual([parade.width, parade.height], [6, 5]);
    const vectorscope = scopeImage("vectorscope", sample, 5);
    assert.deepEqual([vectorscope.width, vectorscope.height], [5, 5]);
  });
});
