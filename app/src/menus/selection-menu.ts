// The right-click menu for an uncommitted selection.
import type { ContextMenuEntry } from "../context-menu.ts";
import { clearSelectionEntry } from "./entries/clear-selection.ts";
import { insertFillClipEntry } from "./entries/insert-fill-clip.ts";
import { insertFxClipEntry } from "./entries/insert-fx-clip.ts";
import { insertTextClipEntry } from "./entries/insert-text-clip.ts";
import { insertTrackEntry } from "./entries/insert-track.ts";
import { selectionClipboardEntries } from "./entries/selection-clipboard.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export { NO_FOOTAGE_TITLE } from "./entries/insert-track.ts";

export type SelectionMenuTrack = {
  id: string;
  name: string;
  // CSS color of the track's swatch.
  color: string;
  // Whether the track has footage anywhere in the selected range.
  hasFootage: boolean;
};

// Cut, Copy and Delete for the content in a selection's span on its layer.
// They are disabled when the span holds none.
export type SelectionClipboardActions = {
  mac: boolean;
  hasContent: boolean;
  cut: () => void;
  copy: () => void;
  remove: () => void;
};

export type SelectionMenuOptions = {
  tracks: readonly SelectionMenuTrack[];
  // Disables every editing entry.
  disabled?: boolean;
  clipboard?: SelectionClipboardActions;
  insertTrack: (index: number) => void;
  insertFill?: () => void;
  insertText?: () => void;
  insertFx?: () => void;
  clear: () => void;
};

export type SelectionMenuContext = SelectionMenuOptions & { disabled: boolean };

export const selectionMenuEntries: readonly MenuEntryProvider<SelectionMenuContext>[] =
  [
    selectionClipboardEntries,
    insertTrackEntry,
    insertFillClipEntry,
    insertTextClipEntry,
    insertFxClipEntry,
    menuSeparator("before-clear", 60),
    clearSelectionEntry,
  ];

/**
 * The menu for an uncommitted selection: Cut, Copy and Delete for the span
 * when `clipboard` is available; Insert Track with every source track,
 * committed like pressing its number key; Insert Fill Clip, Insert Text
 * Clip and Insert FX Clip when `insertFill`, `insertText` and `insertFx`
 * are available; and Clear selection.
 */
export function buildSelectionMenuEntries({
  disabled = false,
  ...options
}: SelectionMenuOptions): ContextMenuEntry[] {
  return assembleMenu(selectionMenuEntries, { ...options, disabled });
}
