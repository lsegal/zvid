import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playbackSelectionFromDrag } from "./playback-selection.ts";

describe("playbackSelectionFromDrag", () => {
  const options = { snapUnit: 1, snap: true, totalQuarters: 32 };

  it("selects from the press to the pointer when dragging right", () => {
    assert.deepEqual(playbackSelectionFromDrag(2, 6, options), {
      startQ: 2,
      endQ: 6,
    });
  });

  it("orders the ends when dragging left", () => {
    assert.deepEqual(playbackSelectionFromDrag(6, 2, options), {
      startQ: 2,
      endQ: 6,
    });
  });

  it("snaps both ends to the snap unit", () => {
    assert.deepEqual(
      playbackSelectionFromDrag(1.2, 4.6, { ...options, snapUnit: 0.5 }),
      { startQ: 1, endQ: 4.5 },
    );
  });

  it("keeps the raw positions when snapping is off", () => {
    assert.deepEqual(
      playbackSelectionFromDrag(1.2, 4.6, { ...options, snap: false }),
      { startQ: 1.2, endQ: 4.6 },
    );
  });

  it("clamps to the timeline", () => {
    assert.deepEqual(playbackSelectionFromDrag(-3, 40, options), {
      startQ: 0,
      endQ: 32,
    });
    assert.deepEqual(playbackSelectionFromDrag(30, 31.8, options), {
      startQ: 30,
      endQ: 32,
    });
  });

  it("selects nothing when the ends snap together", () => {
    assert.equal(playbackSelectionFromDrag(2.1, 1.9, options), null);
    assert.equal(playbackSelectionFromDrag(-2, -1, options), null);
  });
});
