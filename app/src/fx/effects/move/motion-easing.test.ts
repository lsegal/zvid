import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cubicBezier,
  DEFAULT_MOTION_CURVE,
  easeMotion,
  MOTION_CURVES,
  parseMotionCurve,
} from "./motion-easing.ts";

function assertClose(actual: number, expected: number, tolerance = 1e-4) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
}

describe("easeMotion", () => {
  it("starts at exactly 0 and ends at exactly 1 on every curve", () => {
    for (const curve of MOTION_CURVES) {
      assert.equal(easeMotion(curve, 0), 0, curve);
      assert.equal(easeMotion(curve, 1), 1, curve);
    }
  });

  it("clamps progress outside 0..1", () => {
    for (const curve of MOTION_CURVES) {
      assert.equal(easeMotion(curve, -0.5), 0, curve);
      assert.equal(easeMotion(curve, 1.5), 1, curve);
      assert.equal(easeMotion(curve, Number.NaN), 0, curve);
    }
  });

  it("never runs backwards", () => {
    for (const curve of MOTION_CURVES) {
      let previous = 0;
      for (let step = 1; step <= 200; step += 1) {
        const value = easeMotion(curve, step / 200);
        assert.ok(value >= previous - 1e-9, `${curve} at ${step / 200}`);
        previous = value;
      }
    }
  });

  it("is linear for Linear", () => {
    assert.equal(easeMotion("Linear", 0.5), 0.5);
    assert.equal(easeMotion("Linear", 0.25), 0.25);
  });

  it("matches the CSS curves' reference values", () => {
    // Reference values of CSS ease-in, ease-out and ease-in-out.
    assertClose(easeMotion("Ease In", 0.5), 0.3153);
    assertClose(easeMotion("Ease Out", 0.5), 0.6847);
    assertClose(easeMotion("Ease In Out", 0.5), 0.5);
    assertClose(easeMotion("Ease In Out", 0.25), 0.1291);
    assertClose(easeMotion("Ease In Out", 0.75), 0.8709);
  });

  it("stays below linear for Ease In and above it for Ease Out", () => {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      assert.ok(easeMotion("Ease In", p) < p, `Ease In at ${p}`);
      assert.ok(easeMotion("Ease Out", p) > p, `Ease Out at ${p}`);
    }
  });
});

describe("cubicBezier", () => {
  it("solves a curve with a flat start", () => {
    // x(t) has zero slope at t = 0 here, which stalls Newton's method.
    assertClose(cubicBezier(1, 0, 1, 1, 0.001), 0, 1e-3);
    assertClose(cubicBezier(0, 0, 1, 1, 0.5), 0.5);
  });
});

describe("parseMotionCurve", () => {
  it("reads curve names loosely and falls back to the default", () => {
    assert.equal(parseMotionCurve("Ease In"), "Ease In");
    assert.equal(parseMotionCurve("ease-out"), "Ease Out");
    assert.equal(parseMotionCurve("EASE_IN_OUT"), "Ease In Out");
    assert.equal(parseMotionCurve("linear"), "Linear");
    assert.equal(parseMotionCurve("bounce"), DEFAULT_MOTION_CURVE);
    assert.equal(parseMotionCurve(undefined), DEFAULT_MOTION_CURVE);
    assert.equal(DEFAULT_MOTION_CURVE, "Ease In Out");
  });
});
