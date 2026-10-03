// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import type { FxNumberParameterDefinition } from "../../types.ts";
import { definition } from "./definition.ts";
import { glitchStep, pass } from "./pass.ts";

function numberParameter(key: string) {
  const parameter = definition.parameters.find(
    (candidate) => candidate.key === key,
  );
  assert.equal(parameter?.kind, "number");
  return parameter as FxNumberParameterDefinition;
}

describe("Digital Glitch definition", () => {
  it("is a Stylize effect named DigitalGlitch", () => {
    assert.equal(definition.effectName, "DigitalGlitch");
    assert.equal(definition.category, "stylize");
    assert.equal(getEffectDefinition("DigitalGlitch"), definition);
  });

  it("has the suggested controls and defaults", () => {
    assert.deepEqual(
      definition.parameters.map((parameter) => [
        parameter.key,
        parameter.label,
        parameter.kind === "number" && parameter.format(parameter.defaultValue),
      ]),
      [
        ["_Amount", "Amount", "30%"],
        ["_BlockSize", "Block Size", "40%"],
        ["_Displace", "Displace", "50%"],
        ["_ChannelShift", "Channel Shift", "30%"],
        ["_ColorCrush", "Color Crush", "0%"],
        ["_Rate", "Rate", "8 /s"],
      ],
    );
    const rate = numberParameter("_Rate");
    assert.deepEqual([rate.min, rate.max, rate.step], [1, 30, 1]);
  });

  it("supports every Animation mode", () => {
    assert.deepEqual(getAnimationDefaults("DigitalGlitch")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
  });
});

describe("Digital Glitch pass", () => {
  it("feeds Digital Glitch its controls and surface size", () => {
    const values = uniformValues(
      pass,
      params({
        _Amount: 0.6,
        _BlockSize: 0.2,
        _Displace: 0.7,
        _ChannelShift: 0.4,
        _ColorCrush: 0.5,
        _Rate: 10,
      }),
    );

    assert.deepEqual(values, {
      uRes: [1080, 1920],
      uStep: [25],
      uDown: [1],
      uAmount: [0.6],
      uBlock: [0.2],
      uDisplace: [0.7],
      uShift: [0.4],
      uCrush: [0.5],
    });
  });

  it("uses the defaults for missing controls", () => {
    assert.deepEqual(uniformValues(pass, []), {
      uRes: [1080, 1920],
      uStep: [20],
      uDown: [1],
      uAmount: [0.3],
      uBlock: [0.4],
      uDisplace: [0.5],
      uShift: [0.3],
      uCrush: [0],
    });
  });

  it("clamps the Digital Glitch controls", () => {
    const high = uniformValues(
      pass,
      params({
        _Amount: 1.5,
        _BlockSize: 2,
        _Displace: 3,
        _ChannelShift: 1.2,
        _ColorCrush: 9,
        _Rate: 100,
      }),
    );
    assert.deepEqual(
      [high.uAmount, high.uBlock, high.uDisplace, high.uShift, high.uCrush],
      [[1], [1], [1], [1], [1]],
    );
    assert.deepEqual(high.uStep, [75]);

    const low = uniformValues(
      pass,
      params({ _Amount: -1, _ColorCrush: -0.5, _Rate: 0 }),
    );
    assert.deepEqual([low.uAmount, low.uCrush], [[0], [0]]);
    assert.deepEqual(low.uStep, [2]);
  });

  it("leaves the frame untouched at Amount 0", () => {
    assert.deepEqual(uniformValues(pass, params({ _Amount: 0 })).uAmount, [0]);
    assert.match(
      pass.fragmentSource,
      /if \(uAmount <= 0\.0\) \{\s*gl_FragColor = base;\s*return;/,
    );
  });

  it("renders the same frame for two times within one Rate step", () => {
    const parameters = params({ _Rate: 8 });
    const at = (time: number) =>
      uniformValues(pass, parameters, { ...CONTEXT, time });

    assert.deepEqual(at(2.5), at(2.6));
    assert.notDeepEqual(at(2.5), at(2.625));
    assert.doesNotMatch(pass.fragmentSource, /random|uTime/i);
  });

  it("wraps the step counter so the hash stays precise", () => {
    assert.equal(glitchStep(1023 / 8, 8), 1023);
    assert.equal(glitchStep(1024 / 8, 8), 0);
    assert.equal(glitchStep(-0.1, 8), 1023);
  });

  it("counts rows the other way on a bottom-up texture", () => {
    assert.deepEqual(
      uniformValues(pass, [], { ...CONTEXT, bottomUp: true }).uDown,
      [-1],
    );
  });
});
