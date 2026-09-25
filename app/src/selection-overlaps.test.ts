import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatOverlapNote,
  type LvpSelection,
  resolveSelectionOverlaps,
  resolveSessionOverlaps,
} from "./selection-overlaps.ts";

const selection = (
  id: number,
  frameStart: number,
  frameEnd: number,
  mainTrackId = "1",
): LvpSelection => ({
  id,
  trackId: `t${id}`,
  mainTrackId,
  frameStart,
  frameEnd,
  selected: false,
});

const spans = (selections: LvpSelection[]) =>
  selections.map(({ id, mainTrackId, frameStart, frameEnd }) => [
    id,
    mainTrackId,
    frameStart,
    frameEnd,
  ]);

describe("resolveSelectionOverlaps", () => {
  it("leaves adjacent selections and other layers alone", () => {
    const selections = [
      selection(1, 0, 30),
      selection(2, 30, 60),
      selection(3, 0, 60, "2"),
    ];
    const result = resolveSelectionOverlaps(selections);
    assert.deepEqual(result.selections, selections);
    assert.deepEqual(result.trimmed, []);
    assert.deepEqual(result.dropped, []);
  });

  it("lets the later selection win, keeping the longer uncovered side", () => {
    const result = resolveSelectionOverlaps([
      selection(1, 0, 100),
      selection(2, 20, 40),
      selection(3, 90, 120),
    ]);
    assert.deepEqual(spans(result.selections), [
      [1, "1", 40, 90],
      [2, "1", 20, 40],
      [3, "1", 90, 120],
    ]);
    assert.deepEqual(
      result.trimmed.map((entry) => entry.id),
      [1],
    );
    assert.deepEqual(result.dropped, []);
  });

  it("removes a selection covered entirely", () => {
    const result = resolveSelectionOverlaps([
      selection(1, 0, 60),
      selection(2, 0, 60),
      selection(3, 0, 60),
    ]);
    assert.deepEqual(spans(result.selections), [[3, "1", 0, 60]]);
    assert.deepEqual(
      result.dropped.map((entry) => entry.id),
      [1, 2],
    );
    assert.deepEqual(result.trimmed, []);
  });
});

describe("resolveSessionOverlaps", () => {
  it("resolves a loaded .lvp's stacked selections", () => {
    const session = {
      mainTracks: [{ id: "1", name: "Layer 1" }],
      selections: [
        selection(1, 0, 317),
        selection(2, 0, 317),
        selection(3, 100, 316),
      ],
    };
    const result = resolveSessionOverlaps(session);
    assert.deepEqual(spans(result.session.selections ?? []), [
      [2, "1", 0, 100],
      [3, "1", 100, 316],
    ]);
    assert.equal(
      formatOverlapNote(result),
      "Overlapping clips on a layer were resolved: trimmed 1 clip and removed 1 clip.",
    );
  });

  it("returns the session unchanged when nothing overlaps", () => {
    const session = { selections: [selection(1, 0, 30), selection(2, 30, 60)] };
    const result = resolveSessionOverlaps(session);
    assert.equal(result.session, session);
    assert.equal(formatOverlapNote(result), "");
  });
});
