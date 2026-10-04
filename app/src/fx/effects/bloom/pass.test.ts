// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import type { EffectParameter } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import {
  BLOOM_BLUR_TAPS,
  BLOOM_MAX_RADIUS,
  BLOOM_SPREAD,
  BLOOM_TAPS,
  pass,
  readTint,
} from "./pass.ts";

const stages = pass.stages ?? [];

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
    assert.match(pass.fragmentSource, /glow \*= uTint \* uIntensity;/);
    assert.match(
      pass.fragmentSource,
      /if \(g <= 0\.0\) \{\s*gl_FragColor = c;\s*return;\s*\}/,
    );
  });

  it("is deterministic, reading neither time nor randomness", () => {
    for (const source of [pass, ...stages].map((s) => s.fragmentSource)) {
      assert.doesNotMatch(source, /uTime|random/i);
    }
    const parameters = params({ _Intensity: 1 });
    for (const shader of [pass, ...stages]) {
      assert.deepEqual(
        uniformValues(shader, parameters),
        uniformValues(shader, parameters, {
          ...CONTEXT,
          time: 9,
          bottomUp: true,
        }),
      );
    }
  });

  it("gathers the light above Threshold, then blurs it across and down", () => {
    assert.deepEqual(
      stages.map((stage) => stage.name),
      ["uBloomLight", "uBloomAcross", "uBloomGlow"],
    );
    assert.match(stages[1].fragmentSource, /texture2D\(uBloomLight, /);
    assert.match(stages[2].fragmentSource, /texture2D\(uBloomAcross, /);
    assert.match(pass.fragmentSource, /texture2D\(uBloomGlow, vUv\)/);

    // A 270×480 stage of a 1080×1920 frame: the light is read in the four
    // quadrants of each stage texel, and the taps spread the default reach
    // along one axis each.
    const stage = { ...CONTEXT, resolution: [270, 480] as [number, number] };
    const parameters = params({ _Threshold: 0.4 });
    assert.deepEqual(uniformValues(stages[0], parameters, stage), {
      uThreshold: [0.4],
      uStep: [0.25 / 270, 0.25 / 480],
    });
    const tap = (0.4 * BLOOM_MAX_RADIUS * 270) / BLOOM_TAPS;
    assert.deepEqual(uniformValues(stages[1], parameters, stage).uTap, [
      tap / 270,
      0,
    ]);
    assert.deepEqual(uniformValues(stages[2], parameters, stage).uTap, [
      0,
      tap / 480,
    ]);
  });

  it("blurs with normalized Gaussian weights, two taps per read", () => {
    const [center, ...pairs] = BLOOM_BLUR_TAPS;
    assert.equal(center.offset, 0);
    assert.equal(pairs.length, BLOOM_TAPS / 2);
    const total =
      center.weight + 2 * pairs.reduce((sum, { weight }) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    for (const [index, { offset, weight }] of pairs.entries()) {
      // Between its two taps, nearer the heavier inner one.
      assert.ok(offset > 2 * index + 1 && offset < 2 * index + 1.5);
      assert.ok(weight > 0 && weight < center.weight * 2);
    }
    // The glow weighs as much against a pixel's own light as 48 samples
    // spread over the reach did.
    assert.ok(BLOOM_SPREAD > 17 && BLOOM_SPREAD < 18);
  });

  it("blurs at a fraction of the frame sized to the reach", () => {
    const scale = (values: Record<string, number>, size: [number, number]) =>
      pass.stageScale?.(params(values), { ...CONTEXT, resolution: size });
    // No glow, no stages.
    assert.equal(scale({ _Intensity: 0 }, [1080, 1920]), 0);
    assert.equal(scale({ _Radius: 0 }, [1080, 1920]), 0);
    // The default reach of a 1080p frame spans BLOOM_TAPS stage texels.
    const reach = 0.4 * BLOOM_MAX_RADIUS * 1080;
    assert.equal(scale({}, [1080, 1920]), BLOOM_TAPS / reach);
    assert.ok(BLOOM_TAPS / reach < 0.5);
    // A short reach keeps the frame's size; a long one stops at an eighth.
    assert.equal(scale({ _Radius: 0.1 }, [320, 180]), 1);
    assert.equal(scale({ _Radius: 1 }, [3840, 2160]), 1 / 8);
  });

  it("parses each Tint once", () => {
    const parameters = [{ key: "_Tint", value: "#123456" }];
    const tint = readTint(parameters);
    assert.deepEqual(tint, { r: 0x12, g: 0x34, b: 0x56, a: 1 });
    assert.equal(readTint([{ key: "_Tint", value: "#123456" }]), tint);
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes", () => {
    assert.deepEqual(getAnimationDefaults("Bloom")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
  });
});
