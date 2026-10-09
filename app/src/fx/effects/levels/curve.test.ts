import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURVE_LUT_SIZE,
  curveLut,
  evaluateCurve,
  formatCurves,
  IDENTITY_CURVES,
  isIdentityCurves,
  parseCurves,
  sampleLut,
} from "./curve.ts";

describe("Levels curves", () => {
  it("reads an empty value as straight diagonals and stores them as empty", () => {
    const curves = parseCurves("");
    assert.deepEqual(curves, IDENTITY_CURVES);
    assert.ok(isIdentityCurves(curves));
    assert.equal(formatCurves(curves), "");
  });

  it("round-trips each channel's points, master first", () => {
    const value = "0,0 0.5,0.75 1,1||0,0.1 1,0.9|";
    const curves = parseCurves(value);
    assert.deepEqual(curves.master, [
      [0, 0],
      [0.5, 0.75],
      [1, 1],
    ]);
    assert.deepEqual(curves.green, [
      [0, 0.1],
      [1, 0.9],
    ]);
    assert.ok(!isIdentityCurves(curves));
    assert.equal(formatCurves(curves), value);
  });

  it("sorts, clamps and merges points, and drops unreadable ones", () => {
    const curves = parseCurves("1,1 0.5,2 0,0 0.501,0.2 x,y|0.3,0.3");
    assert.deepEqual(curves.master, [
      [0, 0],
      [0.5, 1],
      [1, 1],
    ]);
    // Fewer than two points left is the diagonal.
    assert.deepEqual(curves.red, IDENTITY_CURVES.red);
  });

  it("passes through every point on a smooth curve that never overshoots", () => {
    const points = parseCurves("0,0 0.25,0.5 0.5,0.6 1,1").master;
    for (const [x, y] of points) {
      assert.equal(evaluateCurve(points, x), y);
    }
    let previous = 0;
    for (let index = 0; index <= 200; index++) {
      const value = evaluateCurve(points, index / 200);
      assert.ok(value >= previous - 1e-9, "rising points make a rising curve");
      assert.ok(value >= 0 && value <= 1);
      previous = value;
    }
  });

  it("is flat past its first and last points", () => {
    const points = parseCurves("0.2,0.1 0.8,0.9").master;
    assert.equal(evaluateCurve(points, 0), 0.1);
    assert.equal(evaluateCurve(points, 1), 0.9);
  });

  it("bakes each channel's curve after the master one into the lookup table", () => {
    const lut = curveLut(parseCurves("0,0 0.5,0.75 1,1|0,0 1,0.5||"));
    assert.equal(lut.length, CURVE_LUT_SIZE * 3);
    // Master lifts the middle to 0.75; red then halves it.
    assert.ok(Math.abs(sampleLut(lut, 0.5, 0) - 0.375) < 1e-6);
    assert.ok(Math.abs(sampleLut(lut, 0.5, 1) - 0.75) < 1e-6);
    assert.ok(Math.abs(sampleLut(lut, 0.5, 2) - 0.75) < 1e-6);
    // The identity table reads every level back as itself.
    const identity = curveLut(IDENTITY_CURVES);
    for (let index = 0; index <= 20; index++) {
      const level = index / 20;
      assert.ok(Math.abs(sampleLut(identity, level, 1) - level) < 1e-6);
    }
  });
});
