// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { params, uniformValues } from "../../pass-test-utils.ts";
import { CURVE_LUT_SIZE, sampleLut } from "./curve.ts";
import { gradeLevel } from "./levels.ts";
import { pass } from "./pass.ts";

type Uniforms = Record<string, number[]>;

// One pixel's straight RGBA color run through the pass's shader math, as
// the GLSL does it, from the uniforms the pass sends.
function shade(rgba: readonly number[], uniforms: Uniforms) {
  const lut = uniforms.uCurve ? Float32Array.from(uniforms.uCurve) : null;
  const rgb = [0, 1, 2].map((channel) => {
    const level = gradeLevel(
      rgba[channel],
      uniforms.uLift[channel],
      uniforms.uGamma[channel],
      uniforms.uGain[channel],
      uniforms.uOffset[channel],
    );
    return uniforms.uCurveOn[0] > 0.5 && lut
      ? sampleLut(lut, level, channel)
      : level;
  });
  return [...rgb, rgba[3]];
}

function close(actual: readonly number[], expected: readonly number[]) {
  for (const [index, value] of expected.entries()) {
    assert.ok(
      Math.abs(actual[index] - value) < 1e-3,
      `${actual} is not ${expected}`,
    );
  }
}

describe("Levels pass", () => {
  it("is the identity at its defaults", () => {
    assert.ok(pass.isIdentity?.(params({})));
    const { uCurve, ...uniforms } = uniformValues(pass, params({}));
    assert.deepEqual(uniforms, {
      uLift: [0, 0, 0],
      uGamma: [0, 0, 0],
      uGain: [1, 1, 1],
      uOffset: [0, 0, 0],
      uCurveOn: [0],
    });
    // The straight curves' table reads every level back as itself.
    assert.equal(uCurve.length, CURVE_LUT_SIZE * 3);
    for (const [index, value] of uCurve.entries()) {
      assert.ok(
        Math.abs(value - Math.floor(index / 3) / (CURVE_LUT_SIZE - 1)) < 1e-6,
      );
    }
    close(shade([0.2, 0.5, 0.9, 0.7], uniforms), [0.2, 0.5, 0.9, 0.7]);
  });

  it("doubles every level at Gain 2", () => {
    const parameters = params({ GainY: 2 });
    assert.ok(!pass.isIdentity?.(parameters));
    const uniforms = uniformValues(pass, parameters);
    assert.deepEqual(uniforms.uGain, [2, 2, 2]);
    close(shade([0.1, 0.25, 0.4, 1], uniforms), [0.2, 0.5, 0.8, 1]);
    // Levels past white clip to it.
    close(shade([0.75, 0, 0, 1], uniforms), [1, 0, 0, 1]);
  });

  it("multiplies a channel's Gain by the master and adds the others", () => {
    const uniforms = uniformValues(
      pass,
      params({ GainY: 2, GainR: 1.5, LiftY: 0.1, LiftB: 0.05 }),
    );
    assert.deepEqual(uniforms.uGain, [3, 2, 2]);
    assert.deepEqual(
      uniforms.uLift.map((value) => Math.round(value * 1000) / 1000),
      [0.1, 0.1, 0.15],
    );
  });

  it("raises the blacks with Lift and leaves white", () => {
    const uniforms = uniformValues(pass, params({ LiftY: 0.2 }));
    close(shade([0, 0, 0, 1], uniforms), [0.2, 0.2, 0.2, 1]);
    close(shade([1, 1, 1, 1], uniforms), [1, 1, 1, 1]);
    close(shade([0.5, 0.5, 0.5, 1], uniforms), [0.6, 0.6, 0.6, 1]);
  });

  it("brightens the midtones with Gamma and shifts every level with Offset", () => {
    const gamma = uniformValues(pass, params({ GammaY: 1 }));
    close(shade([0.25, 0, 1, 1], gamma), [0.5, 0, 1, 1]);
    const offset = uniformValues(pass, params({ OffsetG: -0.1 }));
    close(shade([0.5, 0.5, 0.5, 1], offset), [0.5, 0.4, 0.5, 1]);
  });

  it("maps a level through a curve point", () => {
    const uniforms = uniformValues(
      pass,
      params({ Curve: "0,0 0.5,0.75 1,1|||" }),
    );
    assert.deepEqual(uniforms.uCurveOn, [1]);
    assert.equal(uniforms.uCurve.length, CURVE_LUT_SIZE * 3);
    close(shade([0.5, 0.5, 0.5, 1], uniforms), [0.75, 0.75, 0.75, 1]);
    close(shade([0, 1, 0, 1], uniforms), [0, 1, 0, 1]);
    // A channel's own curve follows the master's.
    const red = uniformValues(pass, params({ Curve: "|0,0 1,0.5||" }));
    close(shade([1, 1, 1, 1], red), [0.5, 1, 1, 1]);
  });

  it("leaves alpha as it is", () => {
    assert.match(pass.fragmentSource, /gl_FragColor = vec4\([^;]*, c\.a\);/);
    const uniforms = uniformValues(
      pass,
      params({ GainY: 3, LiftY: 0.5, Curve: "0,1 1,0|||" }),
    );
    for (const alpha of [0, 0.25, 1]) {
      assert.equal(shade([0.3, 0.6, 0.9, alpha], uniforms)[3], alpha);
    }
  });

  it("reads its input only at the pixel it draws, so it merges", () => {
    assert.match(pass.fragmentSource, /texture2D\(uTex, vUv\)/);
    assert.doesNotMatch(pass.fragmentSource, /gl_FragCoord|discard/);
  });
});
