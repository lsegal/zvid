import type { ContextMenuEntry } from "../../context-menu.ts";
import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Clipboard actions stay at the top level of the Edit menu, as in other
// editors; the rest of the clip menu goes under Edit > Clip.
const CLIPBOARD_IDS = new Set(["cut", "copy", "paste"]);

export function isClipboardEntry(entry: ContextMenuEntry) {
  return entry.type === "item" && CLIPBOARD_IDS.has(entry.id);
}

// Cut, Copy and Paste from the selection's menu when it has them, else from
// the clip's.
export const editClipboardEntries: MenuEntryProvider<EditMenuContext> = {
  id: "clipboard",
  order: 30,
  entries: ({ selectionEntries, clipEntries }) =>
    [...CLIPBOARD_IDS].flatMap((id) => {
      const isEntry = (entry: ContextMenuEntry) =>
        entry.type === "item" && entry.id === id;
      const entry =
        selectionEntries?.find(isEntry) ?? clipEntries.find(isEntry);
      return entry ? [entry] : [];
    }),
};
