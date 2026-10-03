// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { definition, REFRACTION_TYPES } from "./definition.ts";
import { pass, readRefractionType, wavePhases } from "./pass.ts";

function withType(type: string, values: Record<string, number> = {}) {
  return [{ key: "_Type", value: type }, ...params(values)];
}

function close(actual: number[], expected: number[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-9,
      `${actual} is not ${expected}`,
    );
  });
}

describe("Refraction pass", () => {
  it("lists the four surfaces with Water as the default", () => {
    const type = definition.parameters.find((p) => p.key === "_Type");
    assert.equal(type?.kind, "enum");
    assert.deepEqual(type?.kind === "enum" && type.options, [
      "Water",
      "Frosted Glass",
      "Reeded Glass",
      "Glass Blocks",
    ]);
    assert.equal(type?.defaultValue, "Water");
  });

  it("uses the definition's defaults when no parameters are set", () => {
    const defaults = definition.parameters.map((p) => [p.key, p.defaultValue]);
    assert.deepEqual(defaults, [
      ["_Type", "Water"],
      ["_Amount", 0.3],
      ["_Scale", 0.5],
      ["_Speed", 0.2],
      ["_Angle", 90],
      ["_Dispersion", 0],
    ]);

    const values = uniformValues(pass, []);
    assert.deepEqual(values.uType, [0]);
    assert.deepEqual(values.uAmount, [0.3]);
    assert.deepEqual(values.uFreq, [13.5]);
    assert.deepEqual(values.uChannel, [1, 1, 1]);
    close(values.uReed, [1, 0]);
    close(values.uWaveA, wavePhases(CONTEXT.time, 0.2).slice(0, 2));
    close(values.uWaveB, wavePhases(CONTEXT.time, 0.2).slice(2));
  });

  it("shows Speed only for Water and Angle only for Reeded Glass", () => {
    const visibility = Object.fromEntries(
      definition.parameters.map((p) => [p.key, p.visibleWhen]),
    );
    assert.deepEqual(visibility._Speed, { key: "_Type", values: ["Water"] });
    assert.deepEqual(visibility._Angle, {
      key: "_Type",
      values: ["Reeded Glass"],
    });
  });

  it("maps each Type to its surface, case-insensitively", () => {
    REFRACTION_TYPES.forEach((type, index) => {
      assert.equal(readRefractionType(withType(type)), index);
      assert.equal(readRefractionType(withType(type.toUpperCase())), index);
      assert.deepEqual(uniformValues(pass, withType(type)).uType, [index]);
    });
    assert.equal(readRefractionType(withType("Lava")), 0);
    assert.equal(readRefractionType([]), 0);
  });

  it("clamps its parameters to their ranges", () => {
    const high = uniformValues(
      pass,
      params({ _Amount: 3, _Scale: 2, _Dispersion: 5, _Angle: 400 }),
    );
    assert.deepEqual(high.uAmount, [1]);
    assert.deepEqual(high.uFreq, [3]);
    close(high.uChannel, [0.65, 1, 1.35]);
    close(high.uReed, [0, -1]);

    const low = uniformValues(
      pass,
      params({ _Amount: -1, _Scale: -1, _Dispersion: -1, _Angle: -30 }),
    );
    assert.deepEqual(low.uAmount, [0]);
    assert.deepEqual(low.uFreq, [24]);
    assert.deepEqual(low.uChannel, [1, 1, 1]);
    close(low.uReed, [0, 1]);
  });

  it("is the identity at Amount 0 for every Type", () => {
    // Every channel samples vUv plus an offset scaled by uAmount.
    assert.match(
      pass.fragmentSource,
      /vec2 o = surface\(p \* uFreq\) \* uAmount \/ \(uFreq \* uAspect\);/,
    );
    for (const type of REFRACTION_TYPES) {
      const values = uniformValues(
        pass,
        withType(type, { _Amount: 0, _Dispersion: 1, _Speed: 1 }),
      );
      assert.deepEqual(values.uAmount, [0], type);
    }
  });

  it("samples one UV for every channel at Dispersion 0", () => {
    for (const channel of ["x", "y", "z"]) {
      assert.ok(
        pass.fragmentSource.includes(
          `clamp(vUv + o * uChannel.${channel}, 0.0, 1.0)`,
        ),
      );
    }
    for (const type of REFRACTION_TYPES) {
      const values = uniformValues(
        pass,
        withType(type, { _Amount: 1, _Dispersion: 0 }),
      );
      assert.deepEqual(values.uChannel, [1, 1, 1], type);
    }
    const split = uniformValues(pass, params({ _Dispersion: 0.5 })).uChannel;
    assert.ok(split[0] < split[1] && split[1] < split[2]);
  });

  it("moves Water only with the playhead time and Speed", () => {
    const parameters = params({ _Speed: 0.6 });
    const first = uniformValues(pass, parameters);
    assert.deepEqual(first, uniformValues(pass, parameters));
    assert.doesNotMatch(pass.fragmentSource, /random|uTime/i);

    const later = uniformValues(pass, parameters, { ...CONTEXT, time: 7 });
    assert.notDeepEqual(later.uWaveA, first.uWaveA);

    const still = params({ _Speed: 0 });
    assert.deepEqual(
      uniformValues(pass, still).uWaveA,
      uniformValues(pass, still, { ...CONTEXT, time: 7 }).uWaveA,
    );
  });

  it("keeps Water's phases within one turn far into the timeline", () => {
    for (const phase of wavePhases(36_000.123, 1)) {
      assert.ok(phase >= 0 && phase < 2 * Math.PI, String(phase));
    }
  });

  it("lays the surface out in square units on any aspect", () => {
    close(uniformValues(pass, []).uAspect, [1, 1920 / 1080]);
    close(
      uniformValues(pass, [], { ...CONTEXT, resolution: [320, 180] }).uAspect,
      [320 / 180, 1],
    );
  });

  it("flips the surface on a bottom-up texture", () => {
    assert.deepEqual(uniformValues(pass, []).uDown, [1]);
    assert.deepEqual(
      uniformValues(pass, [], { ...CONTEXT, bottomUp: true }).uDown,
      [-1],
    );
  });
});
