import type { TimelineSelection } from "./app/types.ts";

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

// A touch handle is a 44px target centered on its edge, so it reaches 22px
// into the selection. Two of them plus a 20px strip in the middle, which
// belongs to neither handle so a tap there still hits the selection body.
const SELECTION_HANDLE_TAP_PX = 44;
export const MIN_GRID_SELECTION_PX = 2 * (SELECTION_HANDLE_TAP_PX / 2) + 20;

/**
 * The fewest whole grid cells `cellQ` long that are at least
 * `MIN_GRID_SELECTION_PX` wide at `quarterPx`, and never fewer than one.
 */
export function gridSelectionCells(cellQ: number, quarterPx: number): number {
  const cellPx = cellQ * quarterPx;
  if (!(cellPx > 0)) {
    return 1;
  }
  // The epsilon keeps a cell exactly the minimum wide from rounding up.
  return Math.max(1, Math.ceil(MIN_GRID_SELECTION_PX / cellPx - 1e-9));
}

/**
 * The grid-aligned range from the grid line at or before `timeQ`: the fewest
 * whole cells `cellQ` long that are at least `MIN_GRID_SELECTION_PX` wide at
 * `quarterPx`, so both edge handles stay reachable. A double-click or
 * double-tap on empty lane space selects it, with or without Snap.
 */
export function gridCellSelection(
  laneId: string,
  timeQ: number,
  cellQ: number,
  quarterPx: number,
): TimelineSelection {
  // The epsilon keeps a time on a grid line from landing a cell early.
  const startQ = Math.floor(Math.max(0, timeQ) / cellQ + 1e-9) * cellQ;
  return {
    id: `selection-${laneId}`,
    laneId,
    startQ,
    durationQ: gridSelectionCells(cellQ, quarterPx) * cellQ,
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
    gesture.dragging || Math.abs(pointerX - gesture.pointerStartX) > threshold;
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

// Dragging a drawn selection's body moves it; dragging an edge handle moves
// that edge.
export type SelectionEditKind = "move" | "resize-start" | "resize-end";

/**
 * The range `origin` becomes when its body or an edge is dragged by
 * `deltaQ`. `snap` rounds the moved edge to the grid. The range never
 * starts before the song start, ends after `maxEndQ`, or gets shorter than
 * `minimumDurationQ`.
 */
export function editSelectionRange(
  origin: LaneSelectionRange,
  kind: SelectionEditKind,
  deltaQ: number,
  snap: (valueQ: number) => number,
  minimumDurationQ: number,
  maxEndQ: number,
): LaneSelectionRange {
  const originEndQ = origin.startQ + origin.durationQ;
  if (kind === "move") {
    const startQ = Math.min(
      Math.max(0, snap(origin.startQ + deltaQ)),
      Math.max(0, maxEndQ - origin.durationQ),
    );
    return { startQ, durationQ: origin.durationQ };
  }

  if (kind === "resize-start") {
    const startQ = Math.max(
      0,
      Math.min(snap(origin.startQ + deltaQ), originEndQ - minimumDurationQ),
    );
    return {
      startQ,
      durationQ: Math.max(minimumDurationQ, originEndQ - startQ),
    };
  }

  const shortestEndQ = origin.startQ + minimumDurationQ;
  const endQ = Math.max(
    shortestEndQ,
    Math.min(snap(originEndQ + deltaQ), Math.max(shortestEndQ, maxEndQ)),
  );
  return { startQ: origin.startQ, durationQ: endQ - origin.startQ };
}

/**
 * The selection after dragging `origin` by `deltaQ` with the pointer over
 * `pointerLaneId`: a move goes to that layer, while a resize stays on the
 * selection's own layer.
 */
export function editTimelineSelection(
  origin: TimelineSelection,
  kind: SelectionEditKind,
  deltaQ: number,
  pointerLaneId: string,
  snap: (valueQ: number) => number,
  minimumDurationQ: number,
  maxEndQ: number,
): TimelineSelection {
  const laneId = kind === "move" ? pointerLaneId : origin.laneId;
  return {
    id: `selection-${laneId}`,
    laneId,
    ...editSelectionRange(
      origin,
      kind,
      deltaQ,
      snap,
      minimumDurationQ,
      maxEndQ,
    ),
  };
}
