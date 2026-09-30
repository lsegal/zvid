import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import { selectionSubmenu } from "../separators.ts";
import { isClipboardEntry } from "./edit-clipboard.ts";

// Edit > Clip: the selected clip's menu without the clipboard actions.
export const editClipSubmenuEntry: MenuEntryProvider<EditMenuContext> = {
  id: "clip",
  order: 60,
  entries: ({ clip, clipEntries }) =>
    clip !== undefined
      ? [
          selectionSubmenu(
            "clip",
            "Clip",
            clip,
            clipEntries.filter((entry) => !isClipboardEntry(entry)),
          ),
        ]
      : [],
};
