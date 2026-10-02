import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("EQ definition", () => {
  const numbers = definition.parameters.flatMap((parameter) =>
    parameter.kind === "number" ? [parameter] : [],
  );

  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, gain.scopes);
    assert.notEqual(definition.accent, gain.accent);
  });

  it("has the seven knobs at their defaults", () => {
    assert.deepEqual(
      numbers.map(({ key, min, max, defaultValue }) => [
        key,
        min,
        max,
        defaultValue,
      ]),
      [
        ["Low Freq", 20, 1000, 100],
        ["Low Gain", -15, 15, 0],
        ["Mid Freq", 100, 10_000, 1000],
        ["Mid Gain", -15, 15, 0],
        ["Mid Q", 0.3, 10, 1],
        ["High Freq", 1000, 20_000, 8000],
        ["High Gain", -15, 15, 0],
      ],
    );
  });

  it("turns the frequencies on a log taper", () => {
    assert.deepEqual(
      numbers
        .filter((parameter) => parameter.taper === "log")
        .map((parameter) => parameter.key),
      ["Low Freq", "Mid Freq", "High Freq"],
    );
  });
});
