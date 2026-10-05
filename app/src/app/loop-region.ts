import {
  editSelectionRange,
  type SelectionEditKind,
} from "../lane-selection-gesture.ts";
import type { PlaybackSelection } from "./playback-selection.ts";
import { clamp } from "./util.ts";

/** The timeline's loop, in quarters, from its in marker to its out marker. */
export type LoopRegion = PlaybackSelection;

export type LoopMarker = "in" | "out";

type LoopBounds = {
  // The shortest the loop may get.
  minimumQ: number;
  totalQuarters: number;
};

/**
 * The loop with its `marker` placed at `atQ`. With no loop yet, the other
 * end defaults to the timeline start for an out marker and to the content
 * end for an in marker. The in marker always stays before the out marker.
 */
export function placeLoopMarker(
  region: LoopRegion | null,
  marker: LoopMarker,
  atQ: number,
  {
    contentEndQ,
    minimumQ,
    totalQuarters,
  }: LoopBounds & { contentEndQ: number },
): LoopRegion {
  const startQ = region?.startQ ?? 0;
  const endQ = region?.endQ ?? contentEndQ;
  if (marker === "in") {
    const inQ = clamp(atQ, 0, Math.max(0, totalQuarters - minimumQ));
    const clampedInQ = Math.min(inQ, Math.max(0, endQ - minimumQ));
    return {
      startQ: clampedInQ,
      endQ: Math.min(totalQuarters, Math.max(endQ, clampedInQ + minimumQ)),
    };
  }

  const outQ = clamp(atQ, Math.min(minimumQ, totalQuarters), totalQuarters);
  const clampedOutQ = Math.max(
    outQ,
    Math.min(totalQuarters, startQ + minimumQ),
  );
  return {
    startQ: Math.max(0, Math.min(startQ, clampedOutQ - minimumQ)),
    endQ: clampedOutQ,
  };
}

/**
 * The loop after dragging `origin`'s middle or an edge by `deltaQ`, like a
 * clip: a move keeps its length, and a resize never crosses the other end.
 */
export function editLoopRegion(
  origin: LoopRegion,
  kind: SelectionEditKind,
  deltaQ: number,
  snap: (valueQ: number) => number,
  { minimumQ, totalQuarters }: LoopBounds,
): LoopRegion {
  const { startQ, durationQ } = editSelectionRange(
    { startQ: origin.startQ, durationQ: origin.endQ - origin.startQ },
    kind,
    deltaQ,
    snap,
    minimumQ,
    totalQuarters,
  );
  return { startQ, endQ: startQ + durationQ };
}

/**
 * The loop's in and out marker positions in timeline pixels, from the
 * timeline start, at `quarterPx` pixels per quarter.
 */
export function loopRegionPx(
  { startQ, endQ }: LoopRegion,
  quarterPx: number,
): { startPx: number; endPx: number } {
  return { startPx: startQ * quarterPx, endPx: endQ * quarterPx };
}
