import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import {
  NOTE_VALUE_OPTIONS,
  noteValueOption,
  noteValueSeconds,
  quartersPerBar,
  timelinePhase,
} from "./tempo.ts";

const AT_120 = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };

const close = (actual: number | undefined, expected: number) =>
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-9,
    `${actual} is not ${expected}`,
  );

describe("note values", () => {
  it("lists every value from 1/32 to 4 bars, straight, dotted and triplet", () => {
    assert.equal(NOTE_VALUE_OPTIONS[0], "1/32");
    assert.ok(NOTE_VALUE_OPTIONS.includes("1/8D"));
    assert.ok(NOTE_VALUE_OPTIONS.includes("1/16T"));
    assert.ok(NOTE_VALUE_OPTIONS.includes("4 bars"));
    assert.equal(noteValueOption("1/4", "triplet"), "1/4T");
    for (const option of NOTE_VALUE_OPTIONS) {
      assert.ok(noteValueSeconds(option, AT_120), option);
    }
  });

  it("times notes in beats at the session tempo", () => {
    close(noteValueSeconds("1/4", AT_120), 0.5);
    close(noteValueSeconds("1/32", AT_120), 0.0625);
    close(noteValueSeconds("1/1", AT_120), 2);
    close(noteValueSeconds("1/4", { ...AT_120, bpm: 90 }), 2 / 3);
  });

  it("makes dotted values half again as long, and triplets two thirds", () => {
    close(noteValueSeconds("1/8D", AT_120), 0.375);
    close(noteValueSeconds("1/8T", AT_120), 1 / 6);
  });

  it("times bars by the time signature", () => {
    const threeFour = { bpm: 120, signature: { numerator: 3, denominator: 4 } };
    const sixEight = { bpm: 120, signature: { numerator: 6, denominator: 8 } };
    assert.equal(quartersPerBar(sixEight), 3);
    close(noteValueSeconds("1 bar", AT_120), 2);
    close(noteValueSeconds("1 bar", threeFour), 1.5);
    close(noteValueSeconds("2 bars", sixEight), 3);
    close(noteValueSeconds("4 bars", AT_120), 8);
  });

  it("names nothing for an unknown value or tempo", () => {
    assert.equal(noteValueSeconds("1/3", AT_120), undefined);
    assert.equal(noteValueSeconds("fast", AT_120), undefined);
    assert.equal(noteValueSeconds("1/4", { ...AT_120, bpm: 0 }), undefined);
  });
});

describe("timelinePhase", () => {
  it("cycles from the timeline's start", () => {
    close(timelinePhase(0, 0.5), 0);
    close(timelinePhase(0.125, 0.5), 0.25);
    close(timelinePhase(1.375, 0.5), 0.75);
    assert.equal(timelinePhase(3, 0), 0);
  });
});
