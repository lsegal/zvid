// Pure logic behind a left-press on empty lane space: a drag past the
// threshold selects a range from the anchor to the pointer, and a press
// released before then is a click, which moves the playhead instead.

// How far the pointer travels before a press becomes a selection drag, so a
// click with a little jitter still reads as a click.
export const LANE_SELECTION_DRAG_THRESHOLD_PX = 4;

export type LaneSelectionRange = { startQ: number; durationQ: number };

export type LaneSelectionGesture = {
  anchorQ: number;
  pointerStartX: number;
  // Latched once the pointer passes the threshold, so moving back toward
  // the anchor keeps selecting.
  dragging: boolean;
};

export type LaneSelectionRelease =
  | { kind: "click"; playheadQ: number }
  | { kind: "drag" };

/**
 * The range between `anchorQ` and `currentQ`, never shorter than
 * `minimumDurationQ` and never before the song start.
 */
export function buildSelection(
  anchorQ: number,
  currentQ: number,
  minimumDurationQ: number,
): LaneSelectionRange {
  const startQ = Math.max(0, Math.min(anchorQ, currentQ));
  const endQ = Math.max(anchorQ, currentQ, startQ + minimumDurationQ);
  return {
    startQ,
    durationQ: Math.max(minimumDurationQ, endQ - startQ),
  };
}

export function startLaneSelectionGesture(
  anchorQ: number,
  pointerStartX: number,
): LaneSelectionGesture {
  return { anchorQ, pointerStartX, dragging: false };
}

/**
 * Advances the gesture for a pointer at `pointerX` (`currentQ` on the
 * timeline). The selection is null until the pointer has passed the drag
 * threshold.
 */
export function moveLaneSelectionGesture(
  gesture: LaneSelectionGesture,
  pointerX: number,
  currentQ: number,
  minimumDurationQ: number,
  threshold = LANE_SELECTION_DRAG_THRESHOLD_PX,
): { gesture: LaneSelectionGesture; selection: LaneSelectionRange | null } {
  const dragging =
    gesture.dragging ||
    Math.abs(pointerX - gesture.pointerStartX) > threshold;
  if (!dragging) {
    return { gesture, selection: null };
  }
  return {
    gesture: gesture.dragging ? gesture : { ...gesture, dragging },
    selection: buildSelection(gesture.anchorQ, currentQ, minimumDurationQ),
  };
}

/** What releasing the pointer does: a click seeks to the anchor. */
export function releaseLaneSelectionGesture(
  gesture: LaneSelectionGesture,
): LaneSelectionRelease {
  return gesture.dragging
    ? { kind: "drag" }
    : { kind: "click", playheadQ: gesture.anchorQ };
}
