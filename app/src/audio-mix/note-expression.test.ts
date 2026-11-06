import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bendRate,
  pressureLevel,
  TIMBRE_CENTER,
  timbreCutoff,
  voiceCurve,
} from "./note-expression.ts";

describe("note expression", () => {
  it("bends an octave at 12 semitones", () => {
    assert.equal(bendRate(0), 1);
    assert.equal(bendRate(12), 2);
    assert.equal(bendRate(-12), 0.5);
  });

  it("swells to the note's own level at full pressure", () => {
    assert.equal(pressureLevel(1), 1);
    assert.ok(pressureLevel(0) > 0);
    assert.ok(pressureLevel(0) < pressureLevel(0.5));
  });

  it("leaves the cutoff at the timbre's center and moves it either way", () => {
    assert.equal(timbreCutoff(1000, TIMBRE_CENTER), 1000);
    assert.ok(timbreCutoff(1000, 1) > 1000);
    assert.ok(timbreCutoff(1000, 0) < 1000);
    assert.equal(timbreCutoff(19_000, 1), 20_000);
    assert.equal(timbreCutoff(21, 0), 20);
  });

  it("puts a curve on its voice's clock", () => {
    assert.deepEqual(
      voiceCurve(
        [
          { at: 0, value: 1 },
          { at: 2, value: 3 },
        ],
        10,
        0.5,
        (value) => value * 100,
      ),
      [
        { seconds: 10, value: 100 },
        { seconds: 11, value: 300 },
      ],
    );
  });
});
