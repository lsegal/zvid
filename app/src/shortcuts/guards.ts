import { isEditableEventTarget } from "../app/util.ts";
import type { ShortcutContext } from "./types.ts";

/**
 * Whether the timeline editing shortcuts may act: not while typing or
 * dragging, and not when a focused control already handled the key, such as
 * the preview nudging a layer with the arrows.
 */
export function canEditTimeline(
  { dragState, timelineDragState }: ShortcutContext,
  event: KeyboardEvent,
) {
  return (
    !event.defaultPrevented &&
    !isEditableEventTarget(event.target) &&
    !dragState &&
    !timelineDragState
  );
}

/** Whether the key press comes from outside text entry. */
export function isOutsideTextEntry(_: ShortcutContext, event: KeyboardEvent) {
  return !isEditableEventTarget(event.target);
}
