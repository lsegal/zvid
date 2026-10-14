import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "./midi-clip.ts";
import {
  clampVelocityLaneHeight,
  paintVelocities,
  readVelocityLaneHeight,
  shiftVelocities,
  stemsBetween,
  VELOCITY_LANE_DEFAULT_PX,
  VELOCITY_LANE_MAX_PX,
  VELOCITY_LANE_MIN_PX,
  velocityAt,
} from "./piano-roll-velocity.ts";

const QUARTER_PX = 32;
const NOTES: MidiNote[] = [
  { pitch: 48, start: 0, length: 1, velocity: 100 },
  { pitch: 55, start: 2, length: 1, velocity: 100 },
  { pitch: 60, start: 4, length: 2, velocity: 100 },
];

describe("velocityAt", () => {
  it("runs from 127 at the lane's top to 1 at its bottom", () => {
    assert.equal(velocityAt(0, 50), 127);
    assert.equal(velocityAt(25, 50), 64);
    assert.equal(velocityAt(50, 50), 1);
    // Past either edge, it clamps.
    assert.equal(velocityAt(-20, 50), 127);
    assert.equal(velocityAt(80, 50), 1);
  });
});

describe("stemsBetween", () => {
  it("finds the stems a span of the lane reaches", () => {
    assert.deepEqual(stemsBetween(NOTES, 66, 66, QUARTER_PX), [1]);
    assert.deepEqual(stemsBetween(NOTES, 30, 30, QUARTER_PX), []);
    assert.deepEqual(stemsBetween(NOTES, 130, 10, QUARTER_PX), [1, 2]);
  });
});

describe("paintVelocities", () => {
  it("sets the stems a stroke crosses along it", () => {
    const painted = paintVelocities(
      NOTES,
      { x: 0, velocity: 20 },
      { x: 128, velocity: 120 },
      QUARTER_PX,
    );
    assert.deepEqual(
      painted.map((note) => note.velocity),
      [20, 70, 120],
    );
    // A press paints just the stem under it.
    assert.deepEqual(
      paintVelocities(
        NOTES,
        { x: 64, velocity: 5 },
        { x: 64, velocity: 5 },
        QUARTER_PX,
      ).map((note) => note.velocity),
      [100, 5, 100],
    );
  });

  it("keeps notes it doesn't change", () => {
    const painted = paintVelocities(
      NOTES,
      { x: 64, velocity: 100 },
      { x: 64, velocity: 100 },
      QUARTER_PX,
    );
    for (const [index, note] of painted.entries()) {
      assert.equal(note, NOTES[index]);
    }
  });
});

describe("shiftVelocities", () => {
  it("shifts the chosen notes, each clamped to 1 to 127", () => {
    const base = [
      { ...NOTES[0], velocity: 120 },
      { ...NOTES[1], velocity: 60 },
      NOTES[2],
    ];
    assert.deepEqual(
      shiftVelocities(base, new Set([0, 1]), 20).map((note) => note.velocity),
      [127, 80, 100],
    );
    assert.deepEqual(
      shiftVelocities(base, new Set([0, 1]), -100).map((note) => note.velocity),
      [20, 1, 100],
    );
  });
});

describe("the velocity lane's height", () => {
  it("stays within its range", () => {
    assert.equal(clampVelocityLaneHeight(0), VELOCITY_LANE_MIN_PX);
    assert.equal(clampVelocityLaneHeight(1000), VELOCITY_LANE_MAX_PX);
    assert.equal(clampVelocityLaneHeight(80.4), 80);
  });

  it("defaults without storage", () => {
    assert.equal(readVelocityLaneHeight(), VELOCITY_LANE_DEFAULT_PX);
  });
});
