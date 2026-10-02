// Cut, copy and paste. Cut and copy act on the uncommitted selection's span
// when there is one, else on the selected clip or source clip. Paste goes
// into the selected source clip's track when one is selected.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const copyShortcut: Shortcut = {
  id: "clipboard.copy",
  keys: ["Mod+C"],
  when: canEditTimeline,
  run: (
    {
      clipActionsRef,
      pendingSelection,
      selectedClip,
      selectedSourceSpan,
      sourceClipActionsRef,
    },
    event,
  ) => {
    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.copySelection(pendingSelection);
      return;
    }

    if (selectedClip) {
      event.preventDefault();
      clipActions.copy(selectedClip);
      return;
    }

    if (!selectedSourceSpan) {
      return;
    }

    event.preventDefault();
    sourceClipActionsRef.current.copy(selectedSourceSpan);
  },
};

export const cutShortcut: Shortcut = {
  id: "clipboard.cut",
  keys: ["Mod+X"],
  when: canEditTimeline,
  run: (
    {
      clipActionsRef,
      pendingSelection,
      selectedClip,
      selectedSourceSpan,
      sourceClipActionsRef,
    },
    event,
  ) => {
    const clipActions = clipActionsRef.current;
    if (pendingSelection) {
      event.preventDefault();
      clipActions.cutSelection(pendingSelection);
      return;
    }

    if (selectedClip) {
      event.preventDefault();
      clipActions.cut(selectedClip);
      return;
    }

    if (!selectedSourceSpan) {
      return;
    }

    event.preventDefault();
    sourceClipActionsRef.current.cut(selectedSourceSpan);
  },
};

export const pasteShortcut: Shortcut = {
  id: "clipboard.paste",
  keys: ["Mod+V"],
  when: canEditTimeline,
  run: (
    {
      clipActionsRef,
      clipClipboardRef,
      selectedClip,
      selectedSourceSpan,
      sourceClipActionsRef,
    },
    event,
  ) => {
    if (!clipClipboardRef.current) {
      return;
    }

    event.preventDefault();
    if (selectedSourceSpan && !selectedClip) {
      sourceClipActionsRef.current.paste(selectedSourceSpan);
      return;
    }

    clipActionsRef.current.paste();
  },
};
