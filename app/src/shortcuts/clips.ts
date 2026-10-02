// Splitting, duplicating and deleting the selected clip, else the selected
// source clip or source track. Delete removes the uncommitted selection's
// span instead when there is one. Splitting only ever splits a layer clip:
// source clips split from their menu.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const splitClipShortcut: Shortcut = {
  id: "clips.split",
  keys: ["Mod+E"],
  when: canEditTimeline,
  run: ({ clipActionsRef, selectedClip }, event) => {
    // A selected source clip is never split from here.
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
    {
      clipActionsRef,
      duplicateSourceTrack,
      selectedClip,
      selectedSourceSpan,
      selectedSourceTrack,
      sourceClipActionsRef,
    },
    event,
  ) => {
    if (selectedClip) {
      event.preventDefault();
      clipActionsRef.current.duplicate(selectedClip);
      return;
    }

    if (selectedSourceSpan) {
      event.preventDefault();
      sourceClipActionsRef.current.duplicate(selectedSourceSpan);
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
      selectedSourceSpan,
      selectedSourceTrack,
      sourceClipActionsRef,
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

    if (selectedSourceSpan) {
      event.preventDefault();
      sourceClipActionsRef.current.remove(selectedSourceSpan);
      return;
    }

    if (!selectedSourceTrack) {
      return;
    }

    event.preventDefault();
    deleteSourceTrack(selectedSourceTrack);
  },
};
