// The math behind the mobile timeline: the playhead stays at the center of
// the view while the timeline scrolls under it (near the start, where it
// can't, the playhead moves from the labels' edge to the center), two fingers zoom, and a
// press held still picks up a clip or starts a lane selection.
import type { ContextMenuEntry, ContextMenuItem } from "../context-menu.ts";
import { clampZoom } from "../zoom.ts";

// How long a finger has to stay still before the press picks up a clip or
// starts a selection.
export const LONG_PRESS_MS = 450;
// How far a finger may wander and still count as holding still or tapping.
export const TOUCH_SLOP_PX = 10;
// How soon, and how close, a second tap lands to count as a double tap.
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 24;

export type TouchTap = { x: number; y: number; timeMs: number };

type CenterGeometry = {
  // The track labels' width: time 0 starts at their edge.
  labelWidth: number;
  quarterPx: number;
  clientWidth: number;
};

/**
 * The scroll that puts `playheadQ` at the center of the view, unclamped: it
 * is negative near the start, where the timeline can't scroll that far and
 * the playhead sits left of the center instead.
 */
export function playheadScrollLeft(
  playheadQ: number,
  { labelWidth, quarterPx, clientWidth }: CenterGeometry,
) {
  return labelWidth + playheadQ * quarterPx - clientWidth / 2;
}

/** The scroll that puts `playheadQ` at the center of the view, or 0. */
export function centeredScrollLeft(
  playheadQ: number,
  geometry: CenterGeometry,
) {
  return Math.max(0, playheadScrollLeft(playheadQ, geometry));
}

/**
 * The time a sideways swipe `dx` pixels long scrubs to from `startQ`, as
 * though the timeline could scroll past its start (`playheadScrollLeft`), up
 * to `maxScrollLeft`. At the start the playhead moves instead of the
 * timeline: from the labels' edge to the center.
 */
export function swipePlayheadQ(
  startQ: number,
  dx: number,
  maxScrollLeft: number,
  geometry: CenterGeometry,
) {
  return centerPlayheadQ(
    Math.min(
      Math.max(0, maxScrollLeft),
      playheadScrollLeft(startQ, geometry) - dx,
    ),
    geometry,
  );
}

/**
 * The time under the center of the view at `scrollLeft`, never before 0.
 * Takes a negative scroll from `playheadScrollLeft` too.
 */
export function centerPlayheadQ(
  scrollLeft: number,
  { labelWidth, quarterPx, clientWidth }: CenterGeometry,
) {
  if (!(quarterPx > 0)) {
    return 0;
  }
  return Math.max(0, (scrollLeft + clientWidth / 2 - labelWidth) / quarterPx);
}

/**
 * The zoom while two fingers pinch: it scales with the distance between
 * them, from `originZoom` at `originDistance`.
 */
export function pinchZoom(
  originZoom: number,
  originDistance: number,
  distance: number,
) {
  if (!(originDistance > 0) || !(distance > 0)) {
    return clampZoom(originZoom);
  }
  return clampZoom(originZoom * (distance / originDistance));
}

/** Whether a finger has moved past the slop since it touched down. */
export function exceedsTouchSlop(dx: number, dy: number) {
  return Math.hypot(dx, dy) > TOUCH_SLOP_PX;
}

/**
 * Whether a finger lifted after `elapsedMs`, `dx` and `dy` from where it
 * touched down, was a tap: quick, and without wandering past the slop.
 */
export function isTouchTap(dx: number, dy: number, elapsedMs: number) {
  return elapsedMs < LONG_PRESS_MS && !exceedsTouchSlop(dx, dy);
}

/** Whether `next` follows `previous` closely enough to be a double tap. */
export function isDoubleTap(previous: TouchTap | null, next: TouchTap) {
  return (
    previous !== null &&
    next.timeMs - previous.timeMs <= DOUBLE_TAP_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX
  );
}

/**
 * The menu items with the given ids, in that order: the selection toolbar
 * shows these from the clip's own menu, so both stay in step.
 */
export function pickMenuItems(
  entries: readonly ContextMenuEntry[],
  ids: readonly string[],
): ContextMenuItem[] {
  const items = new Map<string, ContextMenuItem>();
  const collect = (list: readonly ContextMenuEntry[]) => {
    for (const entry of list) {
      if (entry.type !== "item") {
        continue;
      }
      if (!items.has(entry.id)) {
        items.set(entry.id, entry);
      }
      if (entry.submenu) {
        collect(entry.submenu);
      }
    }
  };
  collect(entries);
  return ids.flatMap((id) => {
    const item = items.get(id);
    return item ? [item] : [];
  });
}

/**
 * The loop the mobile transport's loop button sets: around the first
 * non-empty range given (the timeline selection, then the selected clip),
 * otherwise the bar the playhead is in.
 */
export function quickLoopRegion(
  playheadQ: number,
  barLength: number,
  ...ranges: ({ startQ: number; endQ: number } | undefined)[]
) {
  const range = ranges.find((range) => range && range.endQ > range.startQ);
  if (range) {
    return { startQ: range.startQ, endQ: range.endQ };
  }
  const bar = barLength > 0 ? barLength : 4;
  const startQ = Math.floor(Math.max(0, playheadQ) / bar) * bar;
  return { startQ, endQ: startQ + bar };
}
