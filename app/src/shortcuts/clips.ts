// Splitting, duplicating and deleting the selected clip. Delete removes the
// uncommitted selection's span instead when there is one.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const splitClipShortcut: Shortcut = {
  id: "clips.split",
  keys: ["Mod+E"],
  when: canEditTimeline,
  run: ({ clipActionsRef, isExporting, selectedClip }, event) => {
    if (!selectedClip || isExporting) {
      return;
    }

    event.preventDefault();
    clipActionsRef.current.split(selectedClip);
  },
};

export const duplicateClipShortcut: Shortcut = {
  id: "clips.duplicate",
  keys: ["Mod+D"],
  when: canEditTimeline,
  run: ({ clipActionsRef, isExporting, selectedClip }, event) => {
    if (!selectedClip || isExporting) {
      return;
    }

    event.preventDefault();
    clipActionsRef.current.duplicate(selectedClip);
  },
};

export const deleteShortcut: Shortcut = {
  id: "clips.delete",
  keys: ["Delete", "Backspace"],
  when: canEditTimeline,
  run: (
    { clipActionsRef, isExporting, pendingSelection, selectedClip },
    event,
  ) => {
    if (isExporting) {
      return;
    }

    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.deleteSelection(pendingSelection);
      return;
    }

    if (!selectedClip) {
      return;
    }

    event.preventDefault();
    clipActions.remove(selectedClip);
  },
};
