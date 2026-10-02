import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("Low Pass definition", () => {
  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, gain.scopes);
    assert.notEqual(definition.accent, gain.accent);
  });

  it("has Frequency, Resonance and Slope at their defaults", () => {
    const [frequency, resonance, slope] = definition.parameters;
    assert.equal(frequency.kind, "number");
    assert.equal(resonance.kind, "number");
    assert.equal(slope.kind, "enum");
    if (
      frequency.kind !== "number" ||
      resonance.kind !== "number" ||
      slope.kind !== "enum"
    ) {
      return;
    }
    assert.deepEqual(
      [frequency.key, frequency.min, frequency.max, frequency.defaultValue],
      ["Frequency", 20, 20_000, 8000],
    );
    assert.equal(frequency.taper, "log");
    assert.equal(frequency.format(8000), "8.00 kHz");
    assert.deepEqual(
      [resonance.key, resonance.min, resonance.max],
      ["Resonance", 0.1, 18],
    );
    assert.equal(resonance.defaultValue.toFixed(3), "0.707");
    assert.equal(resonance.format(resonance.defaultValue), "0.71");
    assert.deepEqual(slope.options, ["12 dB/oct", "24 dB/oct"]);
    assert.equal(slope.defaultValue, "12 dB/oct");
  });
});
