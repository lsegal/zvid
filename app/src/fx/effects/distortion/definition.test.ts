import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAnimationDefaults,
  getAnimationNeutralValues,
} from "../../../fx-animation-defaults.ts";
import { definition as analogGlitch } from "../analog-glitch/definition.ts";
import { EFFECT_DEFINITION_MODULES } from "../index.generated.ts";
import { definition, menuOrder } from "./definition.ts";

describe("Distortion definition", () => {
  const byKey = (key: string) => {
    const parameter = definition.parameters.find(
      (candidate) => candidate.key === key,
    );
    assert.ok(parameter, key);
    return parameter;
  };

  it("is a Stylize effect for the same stacks as Analog Glitch", () => {
    assert.equal(definition.category, "stylize");
    assert.equal(definition.domain, undefined);
    assert.deepEqual(definition.scopes, analogGlitch.scopes);
    assert.ok(menuOrder > 50 && menuOrder < 60);
  });

  it("has its own accent among the Stylize effects", () => {
    const others = EFFECT_DEFINITION_MODULES.map((module) => module.definition)
      .filter((other) => other.category === "stylize" && other !== definition)
      .map((other) => other.accent);
    assert.ok(others.includes(analogGlitch.accent));
    assert.ok(!others.includes(definition.accent));
  });

  it("offers every type and edge mode, Wave and Clamp first", () => {
    const type = byKey("_Type");
    const edges = byKey("_Edges");
    assert.equal(type.kind, "enum");
    assert.equal(edges.kind, "enum");
    if (type.kind !== "enum" || edges.kind !== "enum") return;
    assert.deepEqual(type.options, [
      "Wave",
      "Ripple",
      "Twirl",
      "Bulge",
      "Fisheye",
      "Turbulence",
    ]);
    assert.equal(type.defaultValue, "Wave");
    assert.deepEqual(edges.options, ["Clamp", "Mirror", "Transparent"]);
    assert.equal(edges.defaultValue, "Clamp");
  });

  it("has its knobs at their defaults", () => {
    const knobs = definition.parameters.flatMap((parameter) =>
      parameter.kind === "number" ? [parameter] : [],
    );
    assert.deepEqual(
      knobs.map(({ key, min, max, defaultValue }) => [
        key,
        min,
        max,
        defaultValue,
      ]),
      [
        ["_Amount", -1, 1, 0.3],
        ["_Size", 0, 1, 0.5],
        ["_Speed", 0, 1, 0],
        ["_Angle", 0, 360, 0],
        ["_CenterX", 0, 1, 0.5],
        ["_CenterY", 0, 1, 0.5],
      ],
    );
    assert.deepEqual(
      knobs.map((knob) => knob.format(knob.defaultValue)),
      ["+30%", "50%", "0%", "0°", "50%", "50%"],
    );
  });

  it("shows Angle only for Wave and the center only for centered types", () => {
    assert.deepEqual(byKey("_Angle").visibleWhen, {
      key: "_Type",
      values: ["Wave"],
    });
    for (const key of ["_CenterX", "_CenterY"]) {
      assert.deepEqual(byKey(key).visibleWhen, {
        key: "_Type",
        values: ["Ripple", "Twirl", "Bulge", "Fisheye"],
      });
    }
  });

  it("animates Amount in Clip, Reactive and LFO modes", () => {
    const defaults = getAnimationDefaults("Distortion");
    assert.deepEqual(defaults?.modes, ["clip", "reactive", "lfo"]);
    assert.deepEqual(defaults?.reactive?.parameters, ["_Amount"]);
    assert.deepEqual(defaults?.lfo?.parameters, ["_Amount"]);
    assert.deepEqual(getAnimationNeutralValues("Distortion"), {
      _Amount: { neutral: 0 },
    });
  });
});
