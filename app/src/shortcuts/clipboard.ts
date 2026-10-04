// Cut, copy and paste. Cut and copy act on the uncommitted selection's span
// when there is one, else on the selected clip or source clip. Paste goes
// into the selected source clip's track, or the selected source track, when
// one is selected. Source clips paste only into source tracks and layer clips
// only onto layers; the other kind does nothing but say so in the status bar.
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
      selectedSourceTrack,
      sourceClipActionsRef,
    },
    event,
  ) => {
    if (!clipClipboardRef.current) {
      return;
    }

    event.preventDefault();
    const sourceTrackId =
      selectedSourceSpan?.sourceTrackId ?? selectedSourceTrack?.id;
    if (sourceTrackId && !selectedClip) {
      sourceClipActionsRef.current.paste({ sourceTrackId });
      return;
    }

    clipActionsRef.current.paste();
  },
};
