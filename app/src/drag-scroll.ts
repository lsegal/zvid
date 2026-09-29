// Pure logic behind hand-grab drag scrolling (use-drag-scroll.ts): when a
// press becomes a pan, where the scroll lands while dragging, and the
// momentum fling that follows release.

export type DragScrollAxis = "x" | "y" | "both";

export type ScrollPosition = { left: number; top: number };

export type DragScrollSample = { x: number; y: number; time: number };

export type DragScrollVelocity = { x: number; y: number };

// How far the pointer travels before a press becomes a pan, so a plain click
// on the scrollable background still reads as a click.
export const DRAG_SCROLL_THRESHOLD_PX = 4;

// Only pointer movement this recent counts toward the release velocity, so
// pausing before letting go stops the pan dead.
export const DRAG_SCROLL_VELOCITY_WINDOW_MS = 100;

// The fling after release decays linearly to a stop over this long.
export const DRAG_SCROLL_MOMENTUM_MS = 300;

function axisDelta(dx: number, dy: number, axis: DragScrollAxis) {
  return {
    x: axis === "y" ? 0 : dx,
    y: axis === "x" ? 0 : dy,
  };
}

/** Whether the pointer has moved far enough along `axis` to start a pan. */
export function exceedsDragThreshold(
  dx: number,
  dy: number,
  axis: DragScrollAxis,
  threshold = DRAG_SCROLL_THRESHOLD_PX,
) {
  const delta = axisDelta(dx, dy, axis);
  return Math.hypot(delta.x, delta.y) > threshold;
}

/**
 * The scroll position for a pointer that has moved (dx, dy) since the pan
 * began at `origin`: the content follows the pointer 1:1.
 */
export function dragScrollPosition(
  origin: ScrollPosition,
  dx: number,
  dy: number,
  axis: DragScrollAxis,
): ScrollPosition {
  const delta = axisDelta(dx, dy, axis);
  return { left: origin.left - delta.x, top: origin.top - delta.y };
}

/**
 * The scroll velocity (px/ms) at release from recent pointer samples, oldest
 * first. Scrolling moves opposite to the pointer.
 */
export function releaseVelocity(
  samples: readonly DragScrollSample[],
  now: number,
  axis: DragScrollAxis,
): DragScrollVelocity {
  const recent = samples.filter(
    (sample) => now - sample.time <= DRAG_SCROLL_VELOCITY_WINDOW_MS,
  );
  const first = recent[0];
  const last = recent[recent.length - 1];
  const elapsed = first && last ? last.time - first.time : 0;
  if (!first || !last || elapsed <= 0) {
    return { x: 0, y: 0 };
  }

  const delta = axisDelta(last.x - first.x, last.y - first.y, axis);
  return { x: -delta.x / elapsed, y: -delta.y / elapsed };
}

/**
 * How far the fling has scrolled `elapsedMs` after release, for a velocity
 * that decays linearly to zero over `durationMs`. Holds at the final
 * distance once the fling is over.
 */
export function momentumOffset(
  velocity: DragScrollVelocity,
  elapsedMs: number,
  durationMs = DRAG_SCROLL_MOMENTUM_MS,
): { x: number; y: number } {
  const t = Math.min(Math.max(elapsedMs, 0), durationMs);
  // Integral of v * (1 - s / D) ds from 0 to t.
  const factor = t - (t * t) / (2 * durationMs);
  return { x: velocity.x * factor, y: velocity.y * factor };
}
