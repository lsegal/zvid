import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("De-ess definition", () => {
  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, gain.scopes);
    assert.notEqual(definition.accent, gain.accent);
  });

  it("has its knobs at their defaults", () => {
    assert.deepEqual(
      definition.parameters.flatMap((parameter) =>
        parameter.kind === "number"
          ? [
              [
                parameter.key,
                parameter.min,
                parameter.max,
                parameter.defaultValue,
                parameter.format(parameter.defaultValue),
                parameter.taper,
              ],
            ]
          : [],
      ),
      [
        ["Frequency", 2000, 12_000, 6000, "6.00 kHz", "log"],
        ["Threshold", -60, 0, -20, "−20.0 dB", "linear"],
        ["Amount", 0, 24, 6, "6.0 dB", "linear"],
      ],
    );
  });

  it("switches Listen Off and On, Off by default", () => {
    const listen = definition.parameters.find(
      (parameter) => parameter.key === "Listen",
    );
    assert.equal(listen?.kind, "enum");
    if (listen?.kind === "enum") {
      assert.deepEqual(listen.options, ["Off", "On"]);
      assert.equal(listen.defaultValue, "Off");
    }
  });
});
