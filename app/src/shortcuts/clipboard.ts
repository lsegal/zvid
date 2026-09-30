// Cut, copy and paste. Cut and copy act on the uncommitted selection's span
// when there is one, else on the selected clip.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const copyShortcut: Shortcut = {
  id: "clipboard.copy",
  keys: ["Mod+C"],
  when: canEditTimeline,
  run: ({ clipActionsRef, pendingSelection, selectedClip }, event) => {
    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.copySelection(pendingSelection);
      return;
    }

    if (!selectedClip) {
      return;
    }

    event.preventDefault();
    clipActions.copy(selectedClip);
  },
};

export const cutShortcut: Shortcut = {
  id: "clipboard.cut",
  keys: ["Mod+X"],
  when: canEditTimeline,
  run: ({ clipActionsRef, pendingSelection, selectedClip }, event) => {
    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.cutSelection(pendingSelection);
      return;
    }

    if (!selectedClip) {
      return;
    }

    event.preventDefault();
    clipActions.cut(selectedClip);
  },
};

export const pasteShortcut: Shortcut = {
  id: "clipboard.paste",
  keys: ["Mod+V"],
  when: canEditTimeline,
  run: ({ clipActionsRef, clipClipboardRef }, event) => {
    if (!clipClipboardRef.current) {
      return;
    }

    event.preventDefault();
    clipActionsRef.current.paste();
  },
};
