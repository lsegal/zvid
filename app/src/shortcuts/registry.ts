// The global keyboard shortcuts, one file per area. Every shortcut whose keys
// and `when` match a key press runs, in this order.

import { copyShortcut, cutShortcut, pasteShortcut } from "./clipboard.ts";
import {
  deleteShortcut,
  duplicateClipShortcut,
  splitClipShortcut,
} from "./clips.ts";
import { redoShortcut, undoShortcut } from "./history.ts";
import { matchesShortcutKey } from "./keys.ts";
import { stepLayerShortcut } from "./layers.ts";
import {
  clearSelectionShortcut,
  commitSelectionShortcut,
  deselectClipShortcut,
} from "./selection.ts";
import { jumpToEdgeShortcut, stepFrameShortcut } from "./transport.ts";
import type { Shortcut, ShortcutContext } from "./types.ts";

export const shortcuts: readonly Shortcut[] = [
  clearSelectionShortcut,
  commitSelectionShortcut,
  undoShortcut,
  redoShortcut,
  copyShortcut,
  cutShortcut,
  pasteShortcut,
  splitClipShortcut,
  duplicateClipShortcut,
  deselectClipShortcut,
  stepFrameShortcut,
  jumpToEdgeShortcut,
  stepLayerShortcut,
  deleteShortcut,
];

/** Runs the shortcuts in `table` that `event` triggers in `context`. */
export function dispatchShortcuts(
  table: readonly Shortcut[],
  context: ShortcutContext,
  event: KeyboardEvent,
) {
  for (const shortcut of table) {
    if (
      shortcut.keys.some((key) => matchesShortcutKey(key, event)) &&
      shortcut.when(context, event)
    ) {
      shortcut.run(context, event);
    }
  }
}
