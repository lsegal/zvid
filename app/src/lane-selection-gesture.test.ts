import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildSelection,
  editSelectionRange,
  editTimelineSelection,
  LANE_SELECTION_DRAG_THRESHOLD_PX,
  moveLaneSelectionGesture,
  releaseLaneSelectionGesture,
  startLaneSelectionGesture,
} from "./lane-selection-gesture.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const laneRowTsx = readFileSync(
  new URL("./components/timeline/LaneRow.tsx", import.meta.url),
  "utf8",
);
const useClipDragTs = readFileSync(
  new URL("./hooks/useClipDrag.ts", import.meta.url),
  "utf8",
);
// The lane press starts in LaneRow and useClipDrag follows it.
const lanePressSource = `${appTsx}
${laneRowTsx}
${useClipDragTs}`;
const MINIMUM_Q = 0.25;

describe("lane selection gestures", () => {
  it("treats a press released without moving as a click that seeks", () => {
    const gesture = startLaneSelectionGesture(8, 100);
    assert.deepEqual(releaseLaneSelectionGesture(gesture), {
      kind: "click",
      playheadQ: 8,
    });
  });

  it("ignores jitter under the drag threshold", () => {
    let gesture = startLaneSelectionGesture(8, 100);
    for (const x of [101, 97, 100 + LANE_SELECTION_DRAG_THRESHOLD_PX]) {
      const moved = moveLaneSelectionGesture(gesture, x, 8, MINIMUM_Q);
      assert.equal(moved.selection, null);
      gesture = moved.gesture;
    }
    assert.equal(releaseLaneSelectionGesture(gesture).kind, "click");
  });

  it("selects from the anchor to the pointer once dragged past the threshold", () => {
    const gesture = startLaneSelectionGesture(8, 100);
    const right = moveLaneSelectionGesture(gesture, 160, 12, MINIMUM_Q);
    assert.deepEqual(right.selection, { startQ: 8, durationQ: 4 });
    assert.equal(right.gesture.dragging, true);
    assert.deepEqual(releaseLaneSelectionGesture(right.gesture), {
      kind: "drag",
    });

    const left = moveLaneSelectionGesture(gesture, 40, 5, MINIMUM_Q);
    assert.deepEqual(left.selection, { startQ: 5, durationQ: 3 });
  });

  it("keeps selecting after the pointer returns toward the anchor", () => {
    const dragged = moveLaneSelectionGesture(
      startLaneSelectionGesture(8, 100),
      160,
      12,
      MINIMUM_Q,
    ).gesture;
    const back = moveLaneSelectionGesture(dragged, 101, 8, MINIMUM_Q);
    assert.deepEqual(back.selection, { startQ: 8, durationQ: MINIMUM_Q });
    assert.equal(releaseLaneSelectionGesture(back.gesture).kind, "drag");
  });

  it("never selects before the song start", () => {
    assert.deepEqual(buildSelection(2, -1, MINIMUM_Q), {
      startQ: 0,
      durationQ: 2,
    });
  });
});

describe("editing a drawn selection", () => {
  const origin = { startQ: 4, durationQ: 4 };
  const snapToBeat = (valueQ: number) => Math.round(valueQ);
  const noSnap = (valueQ: number) => valueQ;
  const SONG_END_Q = 64;

  it("moves the whole range, snapping its start", () => {
    assert.deepEqual(
      editSelectionRange(
        origin,
        "move",
        2.4,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 6, durationQ: 4 },
    );
    assert.deepEqual(
      editSelectionRange(origin, "move", 2.4, noSnap, MINIMUM_Q, SONG_END_Q),
      { startQ: 6.4, durationQ: 4 },
    );
  });

  it("clamps a move to the song start and end", () => {
    assert.deepEqual(
      editSelectionRange(
        origin,
        "move",
        -10,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 0, durationQ: 4 },
    );
    assert.deepEqual(
      editSelectionRange(
        origin,
        "move",
        100,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 60, durationQ: 4 },
    );
  });

  it("resizes from the start edge, keeping the end", () => {
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-start",
        -1.6,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 2, durationQ: 6 },
    );
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-start",
        -10,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 0, durationQ: 8 },
    );
  });

  it("resizes from the end edge, keeping the start", () => {
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-end",
        1.6,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 4, durationQ: 6 },
    );
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-end",
        100,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 4, durationQ: 60 },
    );
  });

  it("never resizes shorter than the minimum duration", () => {
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-start",
        10,
        noSnap,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 8 - MINIMUM_Q, durationQ: MINIMUM_Q },
    );
    assert.deepEqual(
      editSelectionRange(
        origin,
        "resize-end",
        -10,
        snapToBeat,
        MINIMUM_Q,
        SONG_END_Q,
      ),
      { startQ: 4, durationQ: MINIMUM_Q },
    );
  });
});

describe("editing a drawn selection's layer", () => {
  const origin = { id: "selection-1", laneId: "1", startQ: 4, durationQ: 4 };
  const snapToBeat = (valueQ: number) => Math.round(valueQ);

  it("moves the selection to the layer under the pointer", () => {
    assert.deepEqual(
      editTimelineSelection(origin, "move", 1, "3", snapToBeat, MINIMUM_Q, 64),
      { id: "selection-3", laneId: "3", startQ: 5, durationQ: 4 },
    );
  });

  it("keeps a resized selection on its own layer", () => {
    for (const kind of ["resize-start", "resize-end"] as const) {
      const resized = editTimelineSelection(
        origin,
        kind,
        1,
        "3",
        snapToBeat,
        MINIMUM_Q,
        64,
      );
      assert.equal(resized.laneId, "1");
      assert.equal(resized.id, "selection-1");
    }
  });
});

describe("lane press wiring", () => {
  it("does not create a selection on press or on a click's release", () => {
    assert.doesNotMatch(lanePressSource, /durationQ: minimumWindowQ/);
    assert.match(
      useClipDragTs,
      /if \(release\.kind === "click"\) \{\s*setPendingSelection\(null\);\s*setPlayheadQ\(release\.playheadQ\);/,
    );
  });
});
