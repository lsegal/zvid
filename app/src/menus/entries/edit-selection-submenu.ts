import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import { trimSeparators } from "../separators.ts";
import { isClipboardEntry } from "./edit-clipboard.ts";

// Edit > Selection, while there is an uncommitted selection.
export const editSelectionSubmenuEntry: MenuEntryProvider<EditMenuContext> = {
  id: "selection",
  order: 50,
  entries: ({ selectionEntries }) =>
    selectionEntries?.length
      ? [
          {
            type: "item",
            id: "selection",
            label: "Selection",
            submenu: trimSeparators(
              selectionEntries.filter((entry) => !isClipboardEntry(entry)),
            ),
          },
        ]
      : [],
};
