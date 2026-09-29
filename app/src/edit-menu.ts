// The top-bar Edit menu, built from the same entries as the right-click
// menus so the two cannot drift apart.
import type { ContextMenuEntry, ContextMenuItem } from "./context-menu.ts";

// Clipboard actions stay at the top level of the Edit menu, as in other
// editors; the rest of the clip menu goes under Edit > Clip.
const CLIPBOARD_IDS = new Set(["cut", "copy", "paste"]);

// Drops separators at either end and repeated ones left behind by removed
// items.
function trimSeparators(entries: readonly ContextMenuEntry[]) {
  const trimmed: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "item" || trimmed.at(-1)?.type === "item") {
      trimmed.push(entry);
    }
  }
  if (trimmed.at(-1)?.type === "separator") {
    trimmed.pop();
  }

  return trimmed;
}

/** A submenu named after what its actions apply to, e.g. "Clip: Intro". */
function selectionSubmenu(
  id: string,
  kind: string,
  name: string,
  entries: readonly ContextMenuEntry[],
): ContextMenuItem {
  return {
    type: "item",
    id,
    label: `${kind}: ${name}`,
    submenu: trimSeparators(entries),
  };
}

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

function isClipboardEntry(entry: ContextMenuEntry) {
  return entry.type === "item" && CLIPBOARD_IDS.has(entry.id);
}

/**
 * Undo and Redo, Cut/Copy/Paste, then Selection, Clip and Layer submenus for
 * the current selection (hidden when nothing of that kind is selected) and
 * the Audio submenu.
 */
export function buildEditMenuEntries(
  history: readonly ContextMenuEntry[],
  {
    clip,
    clipEntries,
    selectionEntries,
    layer,
    audioEntries,
  }: EditMenuSelection,
): ContextMenuEntry[] {
  const clipboard = [...CLIPBOARD_IDS].flatMap((id) => {
    const isEntry = (entry: ContextMenuEntry) =>
      entry.type === "item" && entry.id === id;
    const entry = selectionEntries?.find(isEntry) ?? clipEntries.find(isEntry);
    return entry ? [entry] : [];
  });
  const clipActions = clipEntries.filter((entry) => !isClipboardEntry(entry));
  const selection: ContextMenuEntry[] = [];
  if (selectionEntries?.length) {
    selection.push({
      type: "item",
      id: "selection",
      label: "Selection",
      submenu: trimSeparators(
        selectionEntries.filter((entry) => !isClipboardEntry(entry)),
      ),
    });
  }
  if (clip !== undefined) {
    selection.push(selectionSubmenu("clip", "Clip", clip, clipActions));
  }
  if (layer) {
    selection.push(
      selectionSubmenu("layer", "Layer", layer.name, layer.entries),
    );
  }
  if (audioEntries.length) {
    selection.push({
      type: "item",
      id: "audio",
      label: "Audio",
      submenu: trimSeparators(audioEntries),
    });
  }

  return trimSeparators([
    ...history,
    { type: "separator" },
    ...clipboard,
    { type: "separator" },
    ...selection,
  ]);
}
