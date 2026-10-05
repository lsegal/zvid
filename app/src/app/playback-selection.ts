import { clamp } from "./util.ts";
import { snapQuarterValue } from "./timeline-math.ts";

/** A highlighted time range on the timeline, in quarters, start before end. */
export type PlaybackSelection = { startQ: number; endQ: number };

/**
 * The playback selection a loop-strip drag from `anchorQ` to `pointerQ`
 * makes, in either direction: both ends snapped like other timeline drags
 * and kept within the timeline. Null when the ends meet.
 */
export function playbackSelectionFromDrag(
  anchorQ: number,
  pointerQ: number,
  {
    snapUnit,
    snap,
    totalQuarters,
  }: { snapUnit: number; snap: boolean; totalQuarters: number },
): PlaybackSelection | null {
  const [a, b] = [anchorQ, pointerQ].map((valueQ) =>
    clamp(snapQuarterValue(valueQ, snapUnit, snap), 0, totalQuarters),
  );
  if (a === b) {
    return null;
  }

  return { startQ: Math.min(a, b), endQ: Math.max(a, b) };
}
