import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import { trimSeparators } from "../separators.ts";

// Edit > Audio: the Audio row's menu.
export const editAudioSubmenuEntry: MenuEntryProvider<EditMenuContext> = {
  id: "audio",
  order: 80,
  entries: ({ audioEntries }) =>
    audioEntries.length
      ? [
          {
            type: "item",
            id: "audio",
            label: "Audio",
            submenu: trimSeparators(audioEntries),
          },
        ]
      : [],
};
