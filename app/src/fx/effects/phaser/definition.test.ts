import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition as eq } from "../eq/definition.ts";
import { definition as gain } from "../gain/definition.ts";
import { definition } from "./definition.ts";

describe("Phaser definition", () => {
  const numbers = definition.parameters.flatMap((parameter) =>
    parameter.kind === "number" ? [parameter] : [],
  );

  it("is an audio effect for the same stacks as Gain", () => {
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, gain.scopes);
    assert.notEqual(definition.accent, gain.accent);
    assert.notEqual(definition.accent, eq.accent);
  });

  it("has its knobs at their defaults", () => {
    assert.deepEqual(
      numbers.map(({ key, min, max, defaultValue }) => [
        key,
        min,
        max,
        defaultValue,
      ]),
      [
        ["Rate", 0.05, 10, 0.5],
        ["Depth", 0, 100, 70],
        ["Center", 200, 5000, 1000],
        ["Feedback", 0, 90, 30],
        ["Mix", 0, 100, 50],
      ],
    );
  });

  it("offers 2, 4, 6, 8 or 12 stages, 4 by default", () => {
    const stages = definition.parameters.find(
      (parameter) => parameter.key === "Stages",
    );
    assert.equal(stages?.kind, "enum");
    assert.deepEqual(stages.kind === "enum" && stages.options, [
      "2",
      "4",
      "6",
      "8",
      "12",
    ]);
    assert.equal(stages.defaultValue, "4");
  });

  it("turns Rate and Center on a log taper", () => {
    assert.deepEqual(
      numbers
        .filter((parameter) => parameter.taper === "log")
        .map((parameter) => parameter.key),
      ["Rate", "Center"],
    );
  });

  it("shows the defaults' readouts", () => {
    assert.deepEqual(
      numbers.map((parameter) => parameter.format(parameter.defaultValue)),
      ["0.50 Hz", "70%", "1.00 kHz", "30%", "50%"],
    );
  });
});
