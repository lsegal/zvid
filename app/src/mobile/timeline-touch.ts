// The math behind the mobile timeline: the playhead stays at the center of
// the view while the timeline scrolls under it, two fingers zoom, and a
// press held still turns into a clip move.
import type { ContextMenuEntry, ContextMenuItem } from "../context-menu.ts";
import { clampZoom } from "../zoom.ts";

// How long a finger has to stay still before the press picks up a clip.
export const LONG_PRESS_MS = 450;
// How far a finger may wander and still count as holding still or tapping.
export const TOUCH_SLOP_PX = 10;

type CenterGeometry = {
  // The space ahead of time 0. The mobile shell makes it half the view, so
  // time 0 can reach the center.
  labelWidth: number;
  quarterPx: number;
  clientWidth: number;
};

/** The scroll that puts `playheadQ` at the center of the view. */
export function centeredScrollLeft(
  playheadQ: number,
  { labelWidth, quarterPx, clientWidth }: CenterGeometry,
) {
  return Math.max(0, labelWidth + playheadQ * quarterPx - clientWidth / 2);
}

/** The time under the center of the view at `scrollLeft`, never before 0. */
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
 * The loop the mobile transport's loop button sets: around the selected
 * clip when there is one, otherwise the bar the playhead is in.
 */
export function quickLoopRegion(
  playheadQ: number,
  barLength: number,
  clip?: { startQ: number; endQ: number },
) {
  if (clip && clip.endQ > clip.startQ) {
    return { startQ: clip.startQ, endQ: clip.endQ };
  }
  const bar = barLength > 0 ? barLength : 4;
  const startQ = Math.floor(Math.max(0, playheadQ) / bar) * bar;
  return { startQ, endQ: startQ + bar };
}
