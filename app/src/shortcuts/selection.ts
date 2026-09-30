// The uncommitted selection and the selected clip.
import { isEditableEventTarget } from "../app/util.ts";
import { canEditTimeline } from "./guards.ts";
import type { Shortcut, ShortcutContext } from "./types.ts";

function hasPendingSelection(
  { pendingSelection }: ShortcutContext,
  event: KeyboardEvent,
) {
  return Boolean(pendingSelection) && !isEditableEventTarget(event.target);
}

// Escape drops the uncommitted selection, whatever modifiers are down.
export const clearSelectionShortcut: Shortcut = {
  id: "selection.clear",
  keys: ["Any+Escape"],
  when: hasPendingSelection,
  run: ({ setPendingSelection }) => {
    setPendingSelection(null);
  },
};

// The number keys commit the uncommitted selection to that source track.
export const commitSelectionShortcut: Shortcut = {
  id: "selection.commit-to-track",
  keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
    (key) => `Any+${key}`,
  ),
  when: hasPendingSelection,
  run: ({ commitPendingSelectionToSourceTrack }, event) => {
    event.preventDefault();
    commitPendingSelectionToSourceTrack(Number.parseInt(event.key, 10) - 1);
  },
};

export const deselectClipShortcut: Shortcut = {
  id: "selection.deselect-clip",
  keys: ["Escape"],
  when: canEditTimeline,
  run: ({ selectedClip, setSelectedClipId }, event) => {
    if (!selectedClip) {
      return;
    }

    event.preventDefault();
    setSelectedClipId(undefined);
  },
};
