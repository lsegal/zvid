import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { curveHistogram, HISTOGRAM_BINS } from "./histogram.ts";

describe("curveHistogram", () => {
  it("bins each channel and luminance, weighted by alpha", () => {
    const histogram = curveHistogram({
      width: 3,
      height: 1,
      // Opaque white, opaque black, and a transparent red that counts for
      // nothing.
      pixels: Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 0]),
    });
    for (const bins of Object.values(histogram)) {
      assert.equal(bins.length, HISTOGRAM_BINS);
      assert.equal(bins[0], 0.5);
      assert.equal(bins[HISTOGRAM_BINS - 1], 0.5);
    }
  });

  it("puts a color's luminance in its own bin", () => {
    const { luma, green } = curveHistogram({
      width: 1,
      height: 1,
      pixels: Uint8Array.from([0, 255, 0, 255]),
    });
    assert.equal(green[HISTOGRAM_BINS - 1], 1);
    // Rec. 709 green is 0.7152 of white.
    assert.equal(luma[Math.floor(0.7152 * 255 * (HISTOGRAM_BINS / 256))], 1);
  });

  it("leaves a fully transparent picture empty", () => {
    const { luma } = curveHistogram({
      width: 2,
      height: 2,
      pixels: new Uint8Array(16),
    });
    assert.ok(luma.every((value) => value === 0));
  });
});
