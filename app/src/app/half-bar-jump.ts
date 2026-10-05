import { snapQuarterValue } from "./timeline-math.ts";
import { clamp } from "./util.ts";

// Below this, two quarter values count as the same point on the grid.
const GRID_EPSILON = 1e-9;

export type HalfBarJumpOptions = {
  barLength: number;
  snapUnit: number;
  snap: boolean;
  totalQuarters: number;
};

/**
 * Where the transport's half-bar buttons move the playhead from `playheadQ`:
 * half a bar in `direction`, onto the nearest snap point when snapping is on,
 * kept within the timeline. When that snap point doesn't move the playhead in
 * `direction`, as with a grid coarser than half a bar, it goes to the next
 * snap point that way instead.
 */
export function halfBarTarget(
  direction: -1 | 1,
  playheadQ: number,
  { barLength, snapUnit, snap, totalQuarters }: HalfBarJumpOptions,
) {
  const halfBarQ = playheadQ + (direction * barLength) / 2;
  if (!snap) {
    return clamp(halfBarQ, 0, totalQuarters);
  }

  let targetQ = snapQuarterValue(halfBarQ, snapUnit, true);
  if ((targetQ - playheadQ) * direction < GRID_EPSILON) {
    const step = playheadQ / snapUnit;
    targetQ =
      direction > 0
        ? (Math.floor(step + GRID_EPSILON) + 1) * snapUnit
        : (Math.ceil(step - GRID_EPSILON) - 1) * snapUnit;
  }
  return clamp(targetQ, 0, totalQuarters);
}
