// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectParameter } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

function options(values: Record<string, string>): EffectParameter[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

describe("Distortion pass", () => {
  it("falls back to the definition's defaults", () => {
    const values = uniformValues(pass, []);
    assert.deepEqual(values.uType, [0]);
    assert.deepEqual(values.uEdges, [0]);
    assert.deepEqual(values.uAmount, [0.3]);
    assert.deepEqual(values.uSize, [0.5]);
    assert.deepEqual(values.uPhase, [0]);
    assert.deepEqual(values.uCenter, [0.5, 0.5]);
    assert.deepEqual(values.uDir, [1, -0]);
    assert.deepEqual(values.uRes, [1080, 1920]);
  });

  it("maps Type and Edges to their option index", () => {
    const types = ["Wave", "Ripple", "Twirl", "Bulge", "Fisheye", "Turbulence"];
    for (const [index, type] of types.entries()) {
      assert.deepEqual(uniformValues(pass, options({ _Type: type })).uType, [
        index,
      ]);
    }
    assert.deepEqual(
      uniformValues(pass, options({ _Type: "twirl" })).uType,
      [2],
    );
    for (const [index, edges] of ["Clamp", "Mirror", "Transparent"].entries()) {
      assert.deepEqual(uniformValues(pass, options({ _Edges: edges })).uEdges, [
        index,
      ]);
    }
    assert.deepEqual(
      uniformValues(pass, options({ _Type: "Spiral", _Edges: "Wrap" })),
      uniformValues(pass, []),
    );
  });

  it("clamps the knobs to their ranges", () => {
    const high = uniformValues(
      pass,
      params({
        _Amount: 3,
        _Size: 2,
        _Speed: 4,
        _Angle: 400,
        _CenterX: 2,
        _CenterY: -1,
      }),
    );
    assert.deepEqual(high.uAmount, [1]);
    assert.deepEqual(high.uSize, [1]);
    assert.deepEqual(high.uCenter, [1, 0]);
    assert.equal(high.uDir[0], 1);
    assert.ok(Math.abs(high.uDir[1]) < 1e-9);
    assert.deepEqual(
      uniformValues(pass, params({ _Amount: -3 })).uAmount,
      [-1],
    );
  });

  it("points the wave counterclockwise on screen", () => {
    const [x, y] = uniformValues(pass, params({ _Angle: 90 })).uDir;
    assert.ok(Math.abs(x) < 1e-9);
    assert.equal(y, -1);
  });

  it("keeps Amount 0 as is, so the shader leaves the picture alone", () => {
    assert.deepEqual(uniformValues(pass, params({ _Amount: 0 })).uAmount, [0]);
  });

  it("holds the phase still at Speed 0 and derives it from the time only", () => {
    assert.deepEqual(
      uniformValues(pass, params({ _Speed: 0 }), { ...CONTEXT, time: 7.3 })
        .uPhase,
      [0],
    );
    const moving = params({ _Speed: 0.5 });
    const first = uniformValues(pass, moving, { ...CONTEXT, time: 1.1 });
    assert.deepEqual(
      uniformValues(pass, moving, { ...CONTEXT, time: 1.1 }),
      first,
    );
    assert.ok(Math.abs(first.uPhase[0] - 0.1 * 2 * Math.PI) < 1e-9);
    assert.notDeepEqual(
      uniformValues(pass, moving, { ...CONTEXT, time: 1.2 }).uPhase,
      first.uPhase,
    );
    // The phase wraps in full precision however late the playhead is.
    const late = uniformValues(pass, moving, {
      ...CONTEXT,
      time: 36_000.1,
    }).uPhase[0];
    assert.ok(late >= 0 && late < 2 * Math.PI);
    assert.ok(Math.abs(late - 0.1 * 2 * Math.PI) < 1e-6);
    assert.doesNotMatch(pass.fragmentSource, /random/i);
  });

  it("turns a bottom-up texture over", () => {
    assert.deepEqual(uniformValues(pass, []).uFlip, [0]);
    assert.deepEqual(
      uniformValues(pass, [], { ...CONTEXT, bottomUp: true }).uFlip,
      [1],
    );
  });
});
