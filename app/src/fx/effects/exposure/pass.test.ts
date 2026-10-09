// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import {
  FX_EFFECT_DEFINITIONS,
  getEffectDefinition,
} from "../../../fx-registry.ts";
import { params, uniformValues } from "../../pass-test-utils.ts";
import { ALL_SCOPES } from "../../types.ts";
import { exposePixel, linearToSrgb, pass, srgbToLinear } from "./pass.ts";

type Rgba = [number, number, number, number];

const GRAYS = [0, 0.02, 0.1, 0.25, 0.5, 0.75, 1];

function assertClose(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message ?? ""} ${actual} is not ${expected}`,
  );
}

describe("Exposure pass", () => {
  it("has an Exposure knob in stops from -4 to +4", () => {
    const definition = getEffectDefinition("Exposure");
    assert.equal(definition.displayName, "Exposure");
    assert.equal(definition.category, "color");
    assert.deepEqual(definition.scopes, ALL_SCOPES);
    assert.equal(definition.parameters.length, 1);
    const [stops] = definition.parameters;
    assert.equal(stops.kind, "number");
    if (stops.kind === "number") {
      assert.equal(stops.key, "_Stops");
      assert.equal(stops.label, "Exposure");
      assert.deepEqual([stops.min, stops.max, stops.defaultValue], [-4, 4, 0]);
      assert.equal(stops.format(1), "+1.0 EV");
      assert.equal(stops.format(-2.5), "-2.5 EV");
      assert.equal(stops.format(0), "0.0 EV");
      assert.equal(stops.format(-0.01), "0.0 EV");
    }
  });

  it("sits right after Colorize in the add menus", () => {
    const names = FX_EFFECT_DEFINITIONS.map(
      (definition) => definition.effectName,
    );
    assert.equal(names.indexOf("Exposure"), names.indexOf("Colorize") + 1);
  });

  it("sends 2^stops as its gain, clamped to ±4 stops", () => {
    assert.deepEqual(uniformValues(pass, params({ _Stops: 0 })), {
      uGain: [1],
    });
    assert.deepEqual(uniformValues(pass, params({ _Stops: 1 })), {
      uGain: [2],
    });
    assert.deepEqual(uniformValues(pass, params({ _Stops: -1 })), {
      uGain: [0.5],
    });
    assert.deepEqual(uniformValues(pass, params({ _Stops: 9 })), {
      uGain: [16],
    });
    assert.deepEqual(uniformValues(pass, params({ _Stops: -9 })), {
      uGain: [1 / 16],
    });
  });

  it("is the identity at 0 stops", () => {
    assert.equal(pass.isIdentity?.(params({ _Stops: 0 })), true);
    assert.equal(pass.isIdentity?.(params({})), true);
    assert.equal(pass.isIdentity?.(params({ _Stops: 0.1 })), false);
    for (const gray of GRAYS) {
      const pixel: Rgba = [gray, gray / 2, 1 - gray, 0.5];
      exposePixel(pixel, 0).forEach((value, channel) => {
        assertClose(value, pixel[channel], `gray ${gray}`);
      });
    }
  });

  it("doubles linear light at +1 stop and halves it at -1", () => {
    for (const gray of GRAYS) {
      const linear = srgbToLinear(gray);
      const [up] = exposePixel([gray, gray, gray, 1], 1);
      assertClose(srgbToLinear(up), Math.min(2 * linear, 1), `+1 of ${gray}`);
      const [down] = exposePixel([gray, gray, gray, 1], -1);
      assertClose(srgbToLinear(down), linear / 2, `-1 of ${gray}`);
    }
  });

  it("clamps to the displayable range", () => {
    exposePixel([0.9, 0.6, 0, 1], 4).forEach((value, channel) => {
      assertClose(value, [1, 1, 0, 1][channel], `channel ${channel}`);
    });
    for (const value of exposePixel([1, 0.5, 0.01, 1], -4).slice(0, 3)) {
      assert.ok(value >= 0 && value <= 1);
    }
  });

  it("leaves alpha as it is", () => {
    for (const alpha of [0, 0.25, 1]) {
      for (const stops of [-4, -1, 0, 1, 4]) {
        assert.equal(exposePixel([0.5, 0.5, 0.5, alpha], stops)[3], alpha);
      }
    }
  });

  it("decodes and encodes sRGB as the shader does", () => {
    for (const gray of GRAYS) {
      assertClose(linearToSrgb(srgbToLinear(gray)), gray);
    }
    assert.match(
      pass.fragmentSource,
      /toLinear\(c\.rgb\) \* uGain, 0\.0, 1\.0/,
    );
    assert.match(
      pass.fragmentSource,
      /gl_FragColor = vec4\(toSrgb\(exposed\), c\.a\);/,
    );
    assert.match(pass.fragmentSource, /step\(vec3\(0\.04045\), c\)/);
    assert.match(pass.fragmentSource, /step\(vec3\(0\.0031308\), c\)/);
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes", () => {
    const defaults = getAnimationDefaults("Exposure");
    assert.deepEqual(defaults?.modes, ["clip", "reactive", "lfo"]);
    assert.deepEqual(defaults?.reactive?.parameters, ["_Stops"]);
    assert.deepEqual(defaults?.lfo?.parameters, ["_Stops"]);
  });
});
