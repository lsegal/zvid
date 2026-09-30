// Undo and redo.
import { isOutsideTextEntry } from "./guards.ts";
import type { Shortcut } from "./types.ts";

export const undoShortcut: Shortcut = {
  id: "history.undo",
  keys: ["Mod+Z"],
  when: (context, event) =>
    isOutsideTextEntry(context, event) && !event.shiftKey,
  run: ({ handleUndo }, event) => {
    event.preventDefault();
    handleUndo();
  },
};

export const redoShortcut: Shortcut = {
  id: "history.redo",
  keys: ["Mod+Shift+Z", "Mod+Y"],
  when: isOutsideTextEntry,
  run: ({ handleRedo }, event) => {
    event.preventDefault();
    handleRedo();
  },
};
