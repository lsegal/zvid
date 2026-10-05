import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { halfBarTarget } from "./half-bar-jump.ts";

// A 4/4 bar on an eighth-note grid, 32 quarters long.
const options = {
  barLength: 4,
  snapUnit: 0.5,
  snap: true,
  totalQuarters: 32,
};

describe("halfBarTarget", () => {
  it("lands an off-grid playhead on the nearest snap point", () => {
    assert.equal(halfBarTarget(1, 5.3, options), 7.5);
    assert.equal(halfBarTarget(-1, 5.3, options), 3.5);
    assert.equal(halfBarTarget(1, 1 / 15, options), 2);
    assert.equal(halfBarTarget(-1, 2 + 1 / 15, options), 0);
  });

  it("moves an on-grid playhead exactly half a bar", () => {
    assert.equal(halfBarTarget(1, 6, options), 8);
    assert.equal(halfBarTarget(-1, 6, options), 4);
  });

  it("moves to the next snap point when the grid is coarser than half a bar", () => {
    const coarse = { ...options, snapUnit: 8 };
    // Half a bar from 8 rounds back to 8, so the jump takes a whole step.
    assert.equal(halfBarTarget(1, 8, coarse), 16);
    assert.equal(halfBarTarget(-1, 8, coarse), 0);
    // Half a bar from 1 rounds back to 0, behind the playhead.
    assert.equal(halfBarTarget(1, 1, coarse), 8);
    assert.equal(halfBarTarget(-1, 7, coarse), 0);
  });

  it("moves exactly half a bar when snapping is off", () => {
    const free = { ...options, snap: false };
    assert.equal(halfBarTarget(1, 5.3, free), 7.3);
    assert.equal(halfBarTarget(-1, 5.3, free), 3.3);
  });

  it("stays within the timeline", () => {
    assert.equal(halfBarTarget(-1, 1, options), 0);
    assert.equal(halfBarTarget(-1, 0, options), 0);
    assert.equal(halfBarTarget(1, 31, options), 32);
    assert.equal(halfBarTarget(1, 32, options), 32);
    assert.equal(halfBarTarget(-1, 1, { ...options, snap: false }), 0);
    assert.equal(halfBarTarget(1, 31, { ...options, snap: false }), 32);
  });
});
