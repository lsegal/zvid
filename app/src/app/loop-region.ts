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
 * The loop with its `marker` placed at `atQ`. The other end stays where it
 * is, unless there's no loop yet or the marker lands on or past it: then an
 * out marker's loop starts at the timeline start, and an in marker's loop
 * runs to the content end, or to the timeline end from past the content.
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
  if (marker === "in") {
    const inQ = clamp(atQ, 0, Math.max(0, totalQuarters - minimumQ));
    const keptEndQ =
      region && region.endQ - inQ >= minimumQ ? region.endQ : null;
    const endQ =
      keptEndQ ?? (contentEndQ - inQ >= minimumQ ? contentEndQ : totalQuarters);
    return {
      startQ: inQ,
      endQ: Math.min(totalQuarters, Math.max(endQ, inQ + minimumQ)),
    };
  }

  const outQ = clamp(atQ, Math.min(minimumQ, totalQuarters), totalQuarters);
  const startQ = region && outQ - region.startQ >= minimumQ ? region.startQ : 0;
  return {
    startQ: Math.max(0, Math.min(startQ, outQ - minimumQ)),
    endQ: outQ,
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
