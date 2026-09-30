// The top-bar Edit menu, built from the same entries as the right-click
// menus so the two cannot drift apart.
import type { ContextMenuEntry } from "../context-menu.ts";
import { editAudioSubmenuEntry } from "./entries/edit-audio-submenu.ts";
import { editClipSubmenuEntry } from "./entries/edit-clip-submenu.ts";
import { editClipboardEntries } from "./entries/edit-clipboard.ts";
import { editHistoryEntries } from "./entries/edit-history.ts";
import { editLayerSubmenuEntry } from "./entries/edit-layer-submenu.ts";
import { editSelectionSubmenuEntry } from "./entries/edit-selection-submenu.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";
import { trimSeparators } from "./separators.ts";

export type EditMenuSelection = {
  // The selected clip's name and its right-click menu, or undefined when no
  // clip is selected. The Cut, Copy and Paste entries are taken from
  // `clipEntries`, which is also the menu for empty lane space, except for
  // the ones `selectionEntries` has.
  clip?: string;
  clipEntries: readonly ContextMenuEntry[];
  // The uncommitted selection's right-click menu, while there is one. Its
  // Cut and Copy act on the selected span and replace the clip's.
  selectionEntries?: readonly ContextMenuEntry[];
  // The selected layer's name and its header's right-click menu.
  layer?: { name: string; entries: readonly ContextMenuEntry[] };
  // The Audio row's right-click menu.
  audioEntries: readonly ContextMenuEntry[];
};

export type EditMenuContext = EditMenuSelection & {
  // Undo and Redo.
  history: readonly ContextMenuEntry[];
};

export const editMenuEntries: readonly MenuEntryProvider<EditMenuContext>[] = [
  editHistoryEntries,
  menuSeparator("after-history", 20),
  editClipboardEntries,
  menuSeparator("after-clipboard", 40),
  editSelectionSubmenuEntry,
  editClipSubmenuEntry,
  editLayerSubmenuEntry,
  editAudioSubmenuEntry,
];

/**
 * Undo and Redo, Cut/Copy/Paste, then Selection, Clip and Layer submenus for
 * the current selection (hidden when nothing of that kind is selected) and
 * the Audio submenu.
 */
export function buildEditMenuEntries(
  history: readonly ContextMenuEntry[],
  selection: EditMenuSelection,
): ContextMenuEntry[] {
  return trimSeparators(
    assembleMenu(editMenuEntries, { ...selection, history }),
  );
}
