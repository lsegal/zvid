import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDrive,
  formatSaturationDb,
  formatTone,
  saturationType,
  shapeHard,
  shapeSoft,
  shapeTape,
  shapeTube,
} from "./saturation.ts";

const SHAPES = { shapeSoft, shapeHard, shapeTape, shapeTube };

describe("Saturation readouts", () => {
  it("formats Drive, Output and Tone", () => {
    assert.equal(formatDrive(6), "6.0 dB");
    assert.equal(formatDrive(36), "36.0 dB");
    assert.equal(formatSaturationDb(0), "0.0 dB");
    assert.equal(formatSaturationDb(-24), "−24.0 dB");
    assert.equal(formatSaturationDb(3.46), "+3.5 dB");
    assert.equal(formatTone(1000), "1.00 kHz");
    assert.equal(formatTone(12_000), "12.0 kHz");
  });
});

describe("saturationType", () => {
  it("reads a stored Type case-insensitively, else Soft", () => {
    assert.equal(saturationType("tube"), "Tube");
    assert.equal(saturationType(" Hard "), "Hard");
    assert.equal(saturationType(""), "Soft");
    assert.equal(saturationType("Fuzz"), "Soft");
  });
});

describe("Saturation curves", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name} passes through 0 with a slope of 1`, () => {
      assert.equal(shape(0), 0);
      const slope = (shape(1e-6) - shape(-1e-6)) / 2e-6;
      assert.ok(Math.abs(slope - 1) < 1e-6, `${slope}`);
    });

    it(`${name} rises steadily and stays bounded`, () => {
      let last = Number.NEGATIVE_INFINITY;
      for (let x = -100; x <= 100; x += 0.01) {
        const y = shape(x);
        assert.ok(y >= last && Math.abs(y) < 2, `${x}`);
        last = y;
      }
    });
  }

  it("bends Soft and Hard symmetrically and Tape and Tube asymmetrically", () => {
    for (const shape of [shapeSoft, shapeHard]) {
      assert.equal(shape(-3), -shape(3));
    }
    for (const shape of [shapeTape, shapeTube]) {
      assert.ok(Math.abs(shape(-3) + shape(3)) > 0.1);
    }
  });
});
