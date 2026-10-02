import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as eq } from "../eq/definition.ts";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("Low Cut definition", () => {
  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.equal(definition.displayName, "Low Cut");
    assert.deepEqual(definition.scopes, gain.scopes);
    assert.notEqual(definition.accent, gain.accent);
    assert.notEqual(definition.accent, eq.accent);
  });

  it("has Frequency, Resonance and Slope at their defaults", () => {
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
              parameter.taper,
            ]
          : parameter.kind === "enum"
            ? [parameter.key, parameter.options, parameter.defaultValue]
            : [parameter.key],
      ),
      [
        ["Frequency", 20, 20_000, 80, "log"],
        ["Resonance", 0.1, 18, Math.SQRT1_2, "linear"],
        ["Slope", ["12 dB/oct", "24 dB/oct"], "12 dB/oct"],
      ],
    );
  });
});
