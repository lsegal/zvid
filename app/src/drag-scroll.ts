// Pure logic behind hand-grab drag scrolling (use-drag-scroll.ts): which
// presses start a pan, when a press becomes a drag, where the scroll lands,
// and the momentum that carries on after release.

import { isContextMenuPress } from "./context-menu.ts";

export type DragScrollAxis = "x" | "y" | "both";

export type ScrollPosition = { left: number; top: number };

export type DragScrollSample = { x: number; y: number; time: number };

export type DragScrollVelocity = { x: number; y: number };

// How far the pointer travels before a press becomes a pan, so a plain
// right-click still reads as a click.
export const DRAG_SCROLL_THRESHOLD_PX = 4;

// Only pointer movement this recent counts toward the release velocity, so
// pausing before letting go stops the pan dead.
export const DRAG_SCROLL_VELOCITY_WINDOW_MS = 100;

// Momentum decays by this factor every 16ms frame and stops below the
// minimum speed (px/ms).
const MOMENTUM_FRICTION_PER_FRAME = 0.92;
const MOMENTUM_FRAME_MS = 16;
export const DRAG_SCROLL_MIN_VELOCITY = 0.02;

/**
 * Whether a press on the timeline ruler pans rather than scrubs: the
 * secondary button (Ctrl-click on macOS) or the middle button.
 */
export function isRulerPanPress(
  event: { button: number; ctrlKey: boolean },
  mac: boolean,
) {
  return event.button === 1 || isContextMenuPress(event, mac);
}

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
  const elapsed = last && first ? last.time - first.time : 0;
  if (!first || !last || elapsed <= 0) {
    return { x: 0, y: 0 };
  }

  const delta = axisDelta(last.x - first.x, last.y - first.y, axis);
  return { x: 0 - delta.x / elapsed, y: 0 - delta.y / elapsed };
}

/**
 * One momentum step of `elapsedMs`: how far to scroll and the decayed
 * velocity, or null once it is too slow to keep going.
 */
export function stepMomentum(
  velocity: DragScrollVelocity,
  elapsedMs: number,
): { dx: number; dy: number; velocity: DragScrollVelocity } | null {
  if (Math.hypot(velocity.x, velocity.y) < DRAG_SCROLL_MIN_VELOCITY) {
    return null;
  }

  const decay = MOMENTUM_FRICTION_PER_FRAME ** (elapsedMs / MOMENTUM_FRAME_MS);
  return {
    dx: velocity.x * elapsedMs,
    dy: velocity.y * elapsedMs,
    velocity: { x: velocity.x * decay, y: velocity.y * decay },
  };
}
