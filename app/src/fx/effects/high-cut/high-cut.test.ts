import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFrequency,
  HighCutFilter,
  type HighCutSettings,
  highCutResponseDb,
  highCutSlope,
} from "./high-cut.ts";

const RATE = 48_000;

const TWELVE: HighCutSettings = {
  frequency: 1000,
  resonance: Math.SQRT1_2,
  slope: "12 dB/oct",
};
const TWENTY_FOUR: HighCutSettings = { ...TWELVE, slope: "24 dB/oct" };

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("High Cut response", () => {
  for (const settings of [TWELVE, TWENTY_FOUR]) {
    describe(settings.slope, () => {
      it("is −3 dB at the cutoff with Q 0.707", () => {
        near(highCutResponseDb(settings, 1000, RATE), -3, 0.5);
      });

      it("passes a decade below within 0.5 dB", () => {
        near(highCutResponseDb(settings, 100, RATE), 0, 0.5);
      });

      it("rises to a resonant peak at the cutoff as Q rises", () => {
        const resonant = { ...settings, resonance: 8 };
        assert.ok(highCutResponseDb(resonant, 1000, RATE) > 12);
      });
    });
  }

  it("is about −12 dB an octave above at 12 dB/oct", () => {
    near(highCutResponseDb(TWELVE, 2000, RATE), -12, 1);
  });

  it("is about −24 dB an octave above at 24 dB/oct", () => {
    near(highCutResponseDb(TWENTY_FOUR, 2000, RATE), -24, 1);
  });

  it("stays finite at the top of the range at 44.1 kHz", () => {
    const top = { ...TWENTY_FOUR, frequency: 20_000, resonance: 18 };
    assert.ok(Number.isFinite(highCutResponseDb(top, 1000, 44_100)));
  });
});

describe("High Cut filter", () => {
  it("holds a constant input from its first frame, with no step", () => {
    for (const settings of [TWELVE, TWENTY_FOUR]) {
      const filter = new HighCutFilter(RATE, 1);
      filter.setSettings({ ...settings, resonance: 10 });
      const input = new Float32Array(256).fill(0.5);
      const output = new Float32Array(256);
      filter.process([input], [output], 0, input.length);
      for (const sample of output) {
        near(sample, 0.5, 1e-6);
      }
    }
  });
});

describe("High Cut readouts", () => {
  it("formats frequencies", () => {
    assert.equal(formatFrequency(20), "20 Hz");
    assert.equal(formatFrequency(1500), "1.50 kHz");
    assert.equal(formatFrequency(20_000), "20.0 kHz");
  });

  it("reads an unknown Slope as 12 dB/oct", () => {
    assert.equal(highCutSlope("24 db/OCT"), "24 dB/oct");
    assert.equal(highCutSlope(""), "12 dB/oct");
    assert.equal(highCutSlope("48 dB/oct"), "12 dB/oct");
  });
});
