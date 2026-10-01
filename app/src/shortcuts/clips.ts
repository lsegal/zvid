// Splitting, duplicating and deleting the selected clip, or the selected
// source track when no clip is selected. Delete removes the uncommitted
// selection's span instead when there is one.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const splitClipShortcut: Shortcut = {
  id: "clips.split",
  keys: ["Mod+E"],
  when: canEditTimeline,
  run: ({ clipActionsRef, selectedClip }, event) => {
    if (!selectedClip) {
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
  run: (
    { clipActionsRef, duplicateSourceTrack, selectedClip, selectedSourceTrack },
    event,
  ) => {
    if (selectedClip) {
      event.preventDefault();
      clipActionsRef.current.duplicate(selectedClip);
      return;
    }

    if (!selectedSourceTrack) {
      return;
    }

    event.preventDefault();
    duplicateSourceTrack(selectedSourceTrack);
  },
};

export const deleteShortcut: Shortcut = {
  id: "clips.delete",
  keys: ["Delete", "Backspace"],
  when: canEditTimeline,
  run: (
    {
      clipActionsRef,
      deleteSourceTrack,
      pendingSelection,
      selectedClip,
      selectedSourceTrack,
    },
    event,
  ) => {
    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.deleteSelection(pendingSelection);
      return;
    }

    if (selectedClip) {
      event.preventDefault();
      clipActions.remove(selectedClip);
      return;
    }

    if (!selectedSourceTrack) {
      return;
    }

    event.preventDefault();
    deleteSourceTrack(selectedSourceTrack);
  },
};
