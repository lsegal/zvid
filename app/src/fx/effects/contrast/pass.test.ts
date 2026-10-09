// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAnimatableParameters,
  getAnimationDefaults,
  getAnimationNeutralValues,
} from "../../../fx-animation-defaults.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import { params, uniformValues } from "../../pass-test-utils.ts";
import { ALL_SCOPES } from "../../types.ts";
import { menuOrder } from "./definition.ts";
import { contrastChannel, pass } from "./pass.ts";

const LEVELS = [0, 0.1, 0.25, 0.435, 0.5, 0.8, 1];

function assertClose(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    message ?? `${actual} is not ${expected}`,
  );
}

describe("Contrast pass", () => {
  it("defaults to Contrast 1 about a 0.435 Pivot, on every video scope", () => {
    const definition = getEffectDefinition("Contrast");
    assert.equal(definition.displayName, "Contrast");
    assert.equal(definition.category, "color");
    assert.deepEqual(definition.scopes, ALL_SCOPES);
    assert.equal(menuOrder, 22);
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.label,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
              parameter.format(parameter.defaultValue),
            ]
          : [],
      ),
      [
        ["_Contrast", "Contrast", 0, 2, 1, "1.000"],
        ["_Pivot", "Pivot", 0, 1, 0.435, "0.435"],
      ],
    );
    assert.deepEqual(uniformValues(pass, []), {
      uContrast: [1],
      uPivot: [0.435],
    });
  });

  it("maps and clamps its knobs onto the shader's uniforms", () => {
    assert.deepEqual(
      uniformValues(pass, params({ _Contrast: 1.5, _Pivot: 0.25 })),
      { uContrast: [1.5], uPivot: [0.25] },
    );
    assert.deepEqual(
      uniformValues(pass, params({ _Contrast: 5, _Pivot: -1 })),
      { uContrast: [2], uPivot: [0] },
    );
    assert.deepEqual(
      uniformValues(pass, params({ _Contrast: -1, _Pivot: 3 })),
      { uContrast: [0], uPivot: [1] },
    );
  });

  it("applies (c - pivot) * contrast + pivot per channel, clamped, keeping alpha", () => {
    assert.match(
      pass.fragmentSource,
      /vec3 rgb = \(c\.rgb - vec3\(uPivot\)\) \* uContrast \+ vec3\(uPivot\);/,
    );
    assert.match(
      pass.fragmentSource,
      /gl_FragColor = vec4\(clamp\(rgb, 0\.0, 1\.0\), c\.a\);/,
    );
  });

  it("leaves every level as it is at Contrast 1", () => {
    for (const pivot of [0, 0.435, 1]) {
      for (const level of LEVELS) {
        assertClose(contrastChannel(level, 1, pivot), level);
      }
    }
    assert.equal(
      pass.isIdentity?.(params({ _Contrast: 1, _Pivot: 0.9 })),
      true,
    );
    assert.equal(pass.isIdentity?.([]), true);
    assert.equal(pass.isIdentity?.(params({ _Contrast: 1.2 })), false);
  });

  it("keeps the Pivot level fixed at any Contrast", () => {
    for (const pivot of [0, 0.2, 0.435, 0.75, 1]) {
      for (const contrast of [0, 0.5, 1, 1.5, 2]) {
        assertClose(
          contrastChannel(pivot, contrast, pivot),
          pivot,
          `pivot ${pivot} at contrast ${contrast}`,
        );
      }
    }
  });

  it("flattens everything to the Pivot gray at Contrast 0", () => {
    for (const level of LEVELS) {
      assertClose(contrastChannel(level, 0, 0.435), 0.435);
    }
  });

  it("flattens below 1 and steepens above it, clamped to 0..1", () => {
    assertClose(contrastChannel(0.8, 0.5, 0.5), 0.65);
    assertClose(contrastChannel(0.6, 2, 0.5), 0.7);
    assert.equal(contrastChannel(0.9, 2, 0.435), 1);
    assert.equal(contrastChannel(0.1, 2, 0.435), 0);
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes on both knobs", () => {
    assert.deepEqual(getAnimationDefaults("Contrast")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
    assert.deepEqual(
      getAnimatableParameters("Contrast").map((parameter) => parameter.key),
      ["_Contrast", "_Pivot"],
    );
    assert.deepEqual(getAnimationNeutralValues("Contrast"), {
      _Contrast: { neutral: 1 },
    });
  });
});
