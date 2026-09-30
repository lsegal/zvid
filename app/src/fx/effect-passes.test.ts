// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectDefinition } from "../fx-registry.ts";
import type { EffectContext } from "../fx-shaders/types.ts";
import { EFFECT_PASSES } from "./effects/index.generated.ts";
import { CONTEXT, params, uniformValues } from "./pass-test-utils.ts";

// Every knob of the pass's effect at a mid value, so any audio term that
// scaled one would show.
function midParameters(effectName: string) {
  return params(
    Object.fromEntries(
      getEffectDefinition(effectName)
        .parameters.filter((parameter) => parameter.kind === "number")
        .map((parameter) => [parameter.key, 0.5]),
    ),
  );
}

// The main audio at a hit, as the pass contexts used to carry it.
const HIT = {
  ...CONTEXT,
  audioLow: 1,
  audioHigh: 1,
  impulseLow: 1,
  impulseHigh: 1,
} as EffectContext;

// The music moves an effect only through its Animation modifier's Reactive
// mode, which changes the parameters a pass is given, never the pass itself.
describe("effect passes and the main audio", () => {
  it("read no audio uniforms", () => {
    assert.ok(EFFECT_PASSES.length >= 4);
    for (const pass of EFFECT_PASSES) {
      assert.doesNotMatch(pass.fragmentSource, /impulse|audio/i);
      for (const uniform of pass.uniforms) {
        assert.doesNotMatch(uniform, /impulse|audio/i);
      }
    }
  });

  it("draw the same before and after an audio hit", () => {
    for (const pass of EFFECT_PASSES) {
      const parameters = midParameters(pass.effectName);
      assert.deepEqual(
        uniformValues(pass, parameters, HIT),
        uniformValues(pass, parameters),
        pass.effectName,
      );
    }
  });
});
