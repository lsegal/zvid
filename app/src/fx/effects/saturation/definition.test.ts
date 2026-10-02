import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("Saturation definition", () => {
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
              ],
            ]
          : [],
      ),
      [
        ["Drive", 0, 36, 6, "6.0 dB"],
        ["Tone", 1000, 20_000, 12_000, "12.0 kHz"],
        ["Output", -24, 6, 0, "0.0 dB"],
        ["Mix", 0, 1, 1, "100%"],
      ],
    );
  });

  it("picks its Type from Soft, Hard, Tape and Tube, Soft by default", () => {
    const type = definition.parameters.find(
      (parameter) => parameter.key === "Type",
    );
    assert.equal(type?.kind, "enum");
    if (type?.kind === "enum") {
      assert.deepEqual(type.options, ["Soft", "Hard", "Tape", "Tube"]);
      assert.equal(type.defaultValue, "Soft");
    }
  });

  it("turns Tone on a log taper", () => {
    assert.deepEqual(
      definition.parameters
        .filter(
          (parameter) => parameter.kind === "number" && parameter.taper === "log",
        )
        .map((parameter) => parameter.key),
      ["Tone"],
    );
  });
});
