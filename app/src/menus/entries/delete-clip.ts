import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const deleteClipEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "delete",
  order: 70,
  entries: ({ hasClip, actions }) => [
    {
      type: "item",
      id: "delete",
      label: "Delete",
      shortcut: "Del",
      disabled: !hasClip,
      onSelect: actions.remove,
    },
  ],
};
