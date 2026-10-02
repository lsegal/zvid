import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as gain } from "../gain/definition.ts";
import { EFFECT_DEFINITION_MODULES } from "../index.generated.ts";
import { definition } from "./definition.ts";

describe("Bitcrush definition", () => {
  const numbers = definition.parameters.flatMap((parameter) =>
    parameter.kind === "number" ? [parameter] : [],
  );

  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, gain.scopes);
  });

  it("has its own accent among the audio effects", () => {
    const others = EFFECT_DEFINITION_MODULES.map((module) => module.definition)
      .filter((other) => other.domain === "audio" && other !== definition)
      .map((other) => other.accent);
    assert.ok(others.includes(gain.accent));
    assert.ok(!others.includes(definition.accent));
  });

  it("has its knobs at their defaults", () => {
    assert.equal(numbers.length, definition.parameters.length);
    assert.deepEqual(
      numbers.map(({ key, min, max, defaultValue, step }) => [
        key,
        min,
        max,
        defaultValue,
        step,
      ]),
      [
        ["Bits", 1, 16, 8, 1],
        ["Downsample", 1, 64, 1, 1],
        ["Mix", 0, 1, 1, 0.01],
      ],
    );
  });

  it("turns Downsample on a log taper", () => {
    assert.deepEqual(
      numbers
        .filter((parameter) => parameter.taper === "log")
        .map((parameter) => parameter.key),
      ["Downsample"],
    );
  });

  it("shows the defaults' readouts", () => {
    assert.deepEqual(
      numbers.map((parameter) => parameter.format(parameter.defaultValue)),
      ["8 bits", "1×", "100%"],
    );
  });
});
