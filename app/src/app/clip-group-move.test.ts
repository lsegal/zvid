import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFillClip } from "../fill-clip.ts";
import { type ClipGroupMove, moveClipGroup } from "./clip-group-move.ts";
import { getClipDurationQ } from "./timeline-math.ts";
import type { ArrangementClip } from "./types.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

function fill(id: string, laneId: string, startQ: number, durationQ = 4) {
  return createFillClip({
    id,
    laneId,
    startQ,
    durationQ,
    bpm: BPM,
    tint: "#2a2d38",
    accent: "#8d93a8",
  });
}

const MOVE: ClipGroupMove = {
  deltaQ: 0,
  laneShift: 0,
  laneIds: ["1", "2", "3"],
  totalQuarters: 64,
  beatUnit: 1,
  bpm: BPM,
  duplicate: false,
};

const members = (...ids: string[]) =>
  ids.map((id) => ({ sourceClipId: id, clipId: id }));

// Each clip as [id, layer, start, length], by id.
function placed(clips: readonly ArrangementClip[]) {
  return clips
    .map((clip) => [
      clip.id,
      clip.laneId,
      clip.startQ,
      Math.round(getClipDurationQ(clip, BPM) * 1000) / 1000,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

describe("moveClipGroup", () => {
  it("moves every member by the same offset in time and layers", () => {
    const clips = [fill("a", "1", 0), fill("b", "2", 8), fill("c", "1", 12)];
    assert.deepEqual(
      placed(
        moveClipGroup(clips, members("a", "b", "c"), {
          ...MOVE,
          deltaQ: 2,
          laneShift: 1,
        }),
      ),
      [
        ["a", "2", 2, 4],
        ["b", "3", 10, 4],
        ["c", "2", 14, 4],
      ],
    );
  });

  it("stops the offset where a member would leave the timeline or the layers", () => {
    const clips = [fill("a", "1", 2), fill("b", "2", 8)];
    assert.deepEqual(
      placed(
        moveClipGroup(clips, members("a", "b"), {
          ...MOVE,
          deltaQ: -6,
          laneShift: 2,
        }),
      ),
      [
        ["a", "2", 0, 4],
        ["b", "3", 6, 4],
      ],
    );
    assert.deepEqual(
      placed(
        moveClipGroup(clips, members("a", "b"), {
          ...MOVE,
          deltaQ: 100,
          laneShift: -1,
        }),
      ),
      [
        // The last clip ends a beat before the end of the timeline.
        ["a", "1", 53, 4],
        ["b", "2", 59, 4],
      ],
    );
  });

  it("trims clips outside the group that the members land on", () => {
    const clips = [fill("a", "1", 0), fill("b", "2", 0), fill("x", "2", 4)];
    assert.deepEqual(
      placed(
        moveClipGroup(clips, members("a", "b"), { ...MOVE, deltaQ: 2 }),
      ),
      [
        ["a", "1", 2, 4],
        ["b", "2", 2, 4],
        ["x", "2", 6, 2],
      ],
    );
  });

  it("duplicates the members, leaving the originals in place", () => {
    const clips = [fill("a", "1", 0), fill("b", "2", 8)];
    assert.deepEqual(
      placed(
        moveClipGroup(
          clips,
          [
            { sourceClipId: "a", clipId: "a-copy" },
            { sourceClipId: "b", clipId: "b-copy" },
          ],
          { ...MOVE, deltaQ: 16, duplicate: true },
        ),
      ),
      [
        ["a", "1", 0, 4],
        ["a-copy", "1", 16, 4],
        ["b", "2", 8, 4],
        ["b-copy", "2", 24, 4],
      ],
    );
  });
});
