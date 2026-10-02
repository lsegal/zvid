import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFrequency,
  formatResonance,
  highPassCoefficients,
  highPassResponseDb,
  highPassSlope,
  highPassStages,
} from "./high-pass.ts";

const RATE = 48_000;

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("highPassSlope", () => {
  it("reads the two slopes and falls back to 12 dB/oct", () => {
    assert.equal(highPassSlope("24 dB/oct"), "24 dB/oct");
    assert.equal(highPassSlope(" 24 db/OCT "), "24 dB/oct");
    assert.equal(highPassSlope("12 dB/oct"), "12 dB/oct");
    assert.equal(highPassSlope(""), "12 dB/oct");
    assert.equal(highPassSlope("48 dB/oct"), "12 dB/oct");
  });
});

describe("High Pass readouts", () => {
  it("formats frequencies in Hz and kHz", () => {
    assert.equal(formatFrequency(80), "80 Hz");
    assert.equal(formatFrequency(1500), "1.50 kHz");
    assert.equal(formatFrequency(20_000), "20.0 kHz");
  });

  it("formats resonance as a Q", () => {
    assert.equal(formatResonance(Math.SQRT1_2), "0.71");
    assert.equal(formatResonance(18), "18.00");
  });
});

describe("highPassStages", () => {
  it("uses one biquad at 12 dB/oct and two at 24 dB/oct", () => {
    const settings = { frequency: 80, resonance: Math.SQRT1_2 };
    assert.equal(
      highPassStages({ ...settings, slope: "12 dB/oct" }, RATE).length,
      1,
    );
    assert.equal(
      highPassStages({ ...settings, slope: "24 dB/oct" }, RATE).length,
      2,
    );
  });

  it("is a Butterworth response at Resonance 0.707", () => {
    for (const slope of ["12 dB/oct", "24 dB/oct"] as const) {
      const order = slope === "12 dB/oct" ? 2 : 4;
      const settings = { frequency: 1000, resonance: Math.SQRT1_2, slope };
      for (const frequency of [250, 500, 1000, 2000, 8000]) {
        const ratio = frequency / 1000;
        const butterworth = -10 * Math.log10(1 + ratio ** (-2 * order));
        near(highPassResponseDb(settings, frequency, RATE), butterworth, 0.1);
      }
    }
  });

  it("blocks DC and passes Nyquist at unity", () => {
    const c = highPassCoefficients(80, Math.SQRT1_2, RATE);
    near(c.b0 + c.b1 + c.b2, 0, 1e-12);
    near((c.b0 - c.b1 + c.b2) / (1 - c.a1 + c.a2), 1, 1e-12);
  });

  it("stays stable at 20 kHz and 44.1 kHz with the most resonance", () => {
    for (const slope of ["12 dB/oct", "24 dB/oct"] as const) {
      for (const c of highPassStages(
        { frequency: 20_000, resonance: 18, slope },
        44_100,
      )) {
        // A biquad is stable when its poles lie inside the unit circle.
        assert.ok(Math.abs(c.a2) < 1);
        assert.ok(Math.abs(c.a1) < 1 + c.a2);
      }
    }
  });
});
