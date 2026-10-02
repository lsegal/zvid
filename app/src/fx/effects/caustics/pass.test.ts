// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectParameter } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { definition, menuOrder } from "./definition.ts";
import {
  causticsBlendIndex,
  causticsColor,
  causticsPhase,
  DEFAULT_CAUSTICS_COLOR,
  pass,
} from "./pass.ts";

function text(values: Record<string, string>): EffectParameter[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

// The stored defaults, as the device saves them.
const DEFAULTS: EffectParameter[] = definition.parameters.map((parameter) =>
  parameter.kind === "number"
    ? {
        key: parameter.key,
        value: String(parameter.defaultValue),
        numericValue: parameter.defaultValue,
      }
    : { key: parameter.key, value: parameter.defaultValue },
);

describe("Caustics definition", () => {
  it("lists Caustics under Stylize after Analog Glitch with its defaults", () => {
    assert.equal(definition.category, "stylize");
    assert.ok(menuOrder > 50 && menuOrder < 60);
    assert.deepEqual(
      definition.parameters.map((parameter) => [
        parameter.key,
        parameter.label,
        parameter.defaultValue,
      ]),
      [
        ["_Intensity", "Intensity", 0.5],
        ["_Scale", "Scale", 0.5],
        ["_Speed", "Speed", 0.3],
        ["_Warp", "Warp", 0.1],
        ["_Color", "Color", DEFAULT_CAUSTICS_COLOR],
        ["_Blend", "Blend", "Screen"],
      ],
    );
    const blend = definition.parameters.find((p) => p.key === "_Blend");
    assert.deepEqual(blend?.kind === "enum" && blend.options, [
      "Add",
      "Screen",
      "Multiply",
    ]);
  });
});

describe("Caustics pass", () => {
  it("maps the stored defaults onto its uniforms", () => {
    const values = uniformValues(pass, DEFAULTS);
    assert.deepEqual(values.uIntensity, [0.5]);
    assert.deepEqual(values.uScale, [0.5]);
    assert.deepEqual(values.uWarp, [0.1]);
    assert.deepEqual(values.uBlend, [1]);
    assert.deepEqual(values.uRes, [1080, 1920]);
    assert.deepEqual(values.uColor, causticsColor(DEFAULT_CAUSTICS_COLOR));
    assert.ok(Math.abs(values.uPhase[0] - 2.5 * 0.3 * 4) < 1e-9);
  });

  it("falls back to the defaults for missing parameters", () => {
    assert.deepEqual(uniformValues(pass, []), uniformValues(pass, DEFAULTS));
  });

  it("clamps the knobs to 0..1", () => {
    const values = uniformValues(
      pass,
      params({ _Intensity: 2, _Scale: -1, _Speed: 5, _Warp: -0.5 }),
    );
    assert.deepEqual(values.uIntensity, [1]);
    assert.deepEqual(values.uScale, [0]);
    assert.deepEqual(values.uWarp, [0]);
    assert.deepEqual(values.uPhase, [causticsPhase(CONTEXT.time, 1)]);
  });

  it("reads Blend by name, case-insensitively, Screen when unknown", () => {
    for (const [blend, index] of [
      ["Add", 0],
      ["screen", 1],
      ["MULTIPLY", 2],
      ["Overlay", 1],
    ] as const) {
      assert.deepEqual(uniformValues(pass, text({ _Blend: blend })).uBlend, [
        index,
      ]);
    }
    assert.equal(causticsBlendIndex(undefined), 1);
  });

  it("reads Color as 0..1 channels scaled by its alpha", () => {
    assert.deepEqual(
      uniformValues(pass, text({ _Color: "rgba(255,0,51,0.5)" })).uColor,
      [0.5, 0, 0.1],
    );
    assert.deepEqual(
      uniformValues(pass, text({ _Color: "#00ff00" })).uColor,
      [0, 1, 0],
    );
    assert.deepEqual(
      uniformValues(pass, text({ _Color: "not a color" })).uColor,
      causticsColor(DEFAULT_CAUSTICS_COLOR),
    );
  });

  it("leaves the layer as it is at Intensity 0 and Warp 0", () => {
    const values = uniformValues(pass, params({ _Intensity: 0, _Warp: 0 }));
    assert.deepEqual(values.uIntensity, [0]);
    assert.deepEqual(values.uWarp, [0]);
    // The sample offset scales by Warp and the light mixes in by Intensity,
    // with the layer's alpha kept.
    assert.match(pass.fragmentSource, /vec2 offset = grad \* uWarp \* /);
    assert.match(
      pass.fragmentSource,
      /gl_FragColor = vec4\(clamp\(mix\(c\.rgb, lit, uIntensity\), 0\.0, 1\.0\), c\.a\);/,
    );
  });

  it("freezes the pattern at Speed 0", () => {
    const frozen = params({ _Speed: 0 });
    const early = uniformValues(pass, frozen, { ...CONTEXT, time: 1 });
    const late = uniformValues(pass, frozen, { ...CONTEXT, time: 37.25 });
    assert.deepEqual(early, late);
    assert.deepEqual(early.uPhase, [0]);
  });

  it("moves only with the playhead time, looping within 0..2π", () => {
    const parameters = params({ _Speed: 1 });
    assert.deepEqual(
      uniformValues(pass, parameters),
      uniformValues(pass, parameters),
    );
    assert.doesNotMatch(pass.fragmentSource, /random/i);
    for (const time of [0, 1.5, 100, 86_400, -3]) {
      const phase = causticsPhase(time, 1);
      assert.ok(phase >= 0 && phase < 2 * Math.PI, String(time));
    }
    assert.ok(
      Math.abs(causticsPhase(1 + (2 * Math.PI) / 4, 1) - causticsPhase(1, 1)) <
        1e-9,
    );
    // Whole multiples of the phase only, so wrapping it never jumps.
    for (const match of pass.fragmentSource.matchAll(/([\d.]+) \* t\b/g)) {
      assert.equal(Number(match[1]) % 1, 0, match[0]);
    }
  });

  it("stands the pattern the same way on a bottom-up texture", () => {
    assert.deepEqual(uniformValues(pass, []).uDown, [1]);
    assert.deepEqual(
      uniformValues(pass, [], { ...CONTEXT, bottomUp: true }).uDown,
      [-1],
    );
  });
});
