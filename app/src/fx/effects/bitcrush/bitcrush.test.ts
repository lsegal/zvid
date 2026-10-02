import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBits,
  formatDownsample,
  quantize,
  quantizeWhole,
} from "./bitcrush.ts";

// Every distinct value `quantizeWhole` gives across full scale.
function levelsAt(bits: number) {
  const levels = new Set<number>();
  for (let index = -20_000; index <= 20_000; index++) {
    levels.add(quantizeWhole(index / 20_000 || 1e-9, bits));
  }
  return [...levels].sort((a, b) => a - b);
}

describe("Bitcrush quantizer", () => {
  it("has 2^Bits levels spread evenly from −1 to +1", () => {
    for (const bits of [1, 2, 3, 4, 8]) {
      const levels = levelsAt(bits);
      assert.equal(levels.length, 2 ** bits, `${bits}`);
      assert.equal(levels[0], -1);
      assert.equal(levels.at(-1), 1);
      const spacing = 2 / (2 ** bits - 1);
      for (let index = 1; index < levels.length; index++) {
        assert.ok(
          Math.abs(levels[index] - levels[index - 1] - spacing) < 1e-12,
        );
      }
    }
  });

  it("leaves 1 bit only ±full scale", () => {
    assert.deepEqual(levelsAt(1), [-1, 1]);
    assert.equal(quantizeWhole(1e-6, 1), 1);
    assert.equal(quantizeWhole(-1e-6, 1), -1);
  });

  it("is within half a level of the input, and odd", () => {
    for (const bits of [1, 4, 8, 16]) {
      const half = 1 / (2 ** bits - 1);
      for (let index = -1000; index <= 1000; index++) {
        const sample = index / 1000 || 1e-9;
        const quantized = quantizeWhole(sample, bits);
        assert.ok(Math.abs(quantized - sample) <= half + 1e-12);
        assert.equal(quantizeWhole(-sample, bits), -quantized);
      }
    }
  });

  it("keeps silence silent and clamps past full scale", () => {
    for (const bits of [1, 8, 16]) {
      assert.equal(quantizeWhole(0, bits), 0);
      assert.equal(quantizeWhole(1.5, bits), 1);
      assert.equal(quantizeWhole(-1.5, bits), -1);
    }
  });

  it("blends neighboring depths between whole Bits", () => {
    const sample = 0.3;
    assert.equal(quantize(sample, 2), quantizeWhole(sample, 2));
    const halfway = quantize(sample, 1.5);
    assert.equal(
      halfway,
      (quantizeWhole(sample, 1) + quantizeWhole(sample, 2)) / 2,
    );
    // Sweeping Bits finely moves the output in small steps.
    let previous = quantize(sample, 1);
    for (let bits = 1; bits <= 16; bits += 0.01) {
      const next = quantize(sample, bits);
      assert.ok(Math.abs(next - previous) < 0.01, `${bits}`);
      previous = next;
    }
  });
});

describe("Bitcrush readouts", () => {
  it("reads Bits and Downsample as whole numbers", () => {
    assert.equal(formatBits(1), "1 bit");
    assert.equal(formatBits(8), "8 bits");
    assert.equal(formatBits(16), "16 bits");
    assert.equal(formatDownsample(1), "1×");
    assert.equal(formatDownsample(64), "64×");
  });
});
