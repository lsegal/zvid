// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import type { EffectParameter } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

function withTint(parameters: EffectParameter[], value: string) {
  return [...parameters, { key: "_Tint", value }];
}

describe("Bloom pass", () => {
  it("defaults to the issue's Threshold, Intensity, Radius and Tint", () => {
    const definition = getEffectDefinition("Bloom");
    assert.equal(definition.displayName, "Bloom");
    assert.equal(definition.category, "stylize");
    assert.deepEqual(
      definition.parameters.map((parameter) => [
        parameter.key,
        parameter.kind,
        parameter.defaultValue,
      ]),
      [
        ["_Threshold", "number", 0.7],
        ["_Intensity", "number", 0.6],
        ["_Radius", "number", 0.4],
        ["_Tint", "color", "rgba(255,255,255,1)"],
      ],
    );
    const intensity = definition.parameters[1];
    assert.equal(intensity.kind === "number" && intensity.max, 2);
    assert.equal(intensity.kind === "number" && intensity.format(2), "200%");
    assert.deepEqual(uniformValues(pass, []), {
      uRes: [1080, 1920],
      uThreshold: [0.7],
      uIntensity: [0.6],
      uRadius: [0.4],
      uTint: [1, 1, 1],
    });
  });

  it("maps its parameters onto the shader's uniforms", () => {
    const values = uniformValues(
      pass,
      withTint(
        params({ _Threshold: 0.25, _Intensity: 1.5, _Radius: 0.8 }),
        "#ff8000",
      ),
      { ...CONTEXT, resolution: [320, 180] },
    );
    assert.deepEqual(values, {
      uRes: [320, 180],
      uThreshold: [0.25],
      uIntensity: [1.5],
      uRadius: [0.8],
      uTint: [1, 128 / 255, 0],
    });
  });

  it("clamps out-of-range values and falls back to white for a bad Tint", () => {
    const values = uniformValues(
      pass,
      withTint(
        params({ _Threshold: 2, _Intensity: 5, _Radius: -1 }),
        "not a color",
      ),
    );
    assert.deepEqual(values.uThreshold, [1]);
    assert.deepEqual(values.uIntensity, [2]);
    assert.deepEqual(values.uRadius, [0]);
    assert.deepEqual(values.uTint, [1, 1, 1]);
    assert.deepEqual(
      uniformValues(pass, params({ _Intensity: -1 })).uIntensity,
      [0],
    );
  });

  it("passes pixels through untouched when it has no glow to add", () => {
    // Intensity 0 and pixels at or below Threshold both leave no glow, and a
    // pixel with none returns its source color as is.
    assert.match(
      pass.fragmentSource,
      /if \(over <= 0\.0\) return vec3\(0\.0\);/,
    );
    assert.match(pass.fragmentSource, /glow \*= uTint \* uIntensity \/ total;/);
    assert.match(
      pass.fragmentSource,
      /if \(g <= 0\.0\) \{\s*gl_FragColor = c;\s*return;\s*\}/,
    );
  });

  it("is deterministic, reading neither time nor randomness", () => {
    assert.doesNotMatch(pass.fragmentSource, /uTime|random/i);
    const parameters = params({ _Intensity: 1 });
    assert.deepEqual(
      uniformValues(pass, parameters),
      uniformValues(pass, parameters, { ...CONTEXT, time: 9, bottomUp: true }),
    );
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes", () => {
    assert.deepEqual(getAnimationDefaults("Bloom")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
  });
});
