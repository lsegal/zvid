import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFrequency,
  LowPassFilter,
  type LowPassSettings,
  lowPassResponseDb,
  lowPassSlope,
} from "./low-pass.ts";

const RATE = 48_000;

const TWELVE: LowPassSettings = {
  frequency: 1000,
  resonance: Math.SQRT1_2,
  slope: "12 dB/oct",
};
const TWENTY_FOUR: LowPassSettings = { ...TWELVE, slope: "24 dB/oct" };

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("Low Pass response", () => {
  for (const settings of [TWELVE, TWENTY_FOUR]) {
    describe(settings.slope, () => {
      it("is −3 dB at the cutoff with Q 0.707", () => {
        near(lowPassResponseDb(settings, 1000, RATE), -3, 0.5);
      });

      it("passes a decade below within 0.5 dB", () => {
        near(lowPassResponseDb(settings, 100, RATE), 0, 0.5);
      });

      it("rises to a resonant peak at the cutoff as Q rises", () => {
        const resonant = { ...settings, resonance: 8 };
        assert.ok(lowPassResponseDb(resonant, 1000, RATE) > 12);
      });
    });
  }

  it("is about −12 dB an octave above at 12 dB/oct", () => {
    near(lowPassResponseDb(TWELVE, 2000, RATE), -12, 1);
  });

  it("is about −24 dB an octave above at 24 dB/oct", () => {
    near(lowPassResponseDb(TWENTY_FOUR, 2000, RATE), -24, 1);
  });

  it("stays finite at the top of the range at 44.1 kHz", () => {
    const top = { ...TWENTY_FOUR, frequency: 20_000, resonance: 18 };
    assert.ok(Number.isFinite(lowPassResponseDb(top, 1000, 44_100)));
  });
});

describe("Low Pass filter", () => {
  it("holds a constant input from its first frame, with no step", () => {
    for (const settings of [TWELVE, TWENTY_FOUR]) {
      const filter = new LowPassFilter(RATE, 1);
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

describe("Low Pass readouts", () => {
  it("formats frequencies", () => {
    assert.equal(formatFrequency(20), "20 Hz");
    assert.equal(formatFrequency(1500), "1.50 kHz");
    assert.equal(formatFrequency(20_000), "20.0 kHz");
  });

  it("reads an unknown Slope as 12 dB/oct", () => {
    assert.equal(lowPassSlope("24 db/OCT"), "24 dB/oct");
    assert.equal(lowPassSlope(""), "12 dB/oct");
    assert.equal(lowPassSlope("48 dB/oct"), "12 dB/oct");
  });
});
