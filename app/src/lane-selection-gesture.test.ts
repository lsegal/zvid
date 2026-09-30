import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildSelection,
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

describe("lane press wiring", () => {
  it("does not create a selection on press or on a click's release", () => {
    assert.doesNotMatch(lanePressSource, /durationQ: minimumWindowQ/);
    assert.match(
      useClipDragTs,
      /if \(release\.kind === "click"\) \{\s*setPendingSelection\(null\);\s*setPlayheadQ\(release\.playheadQ\);/,
    );
  });
});
