import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const deleteClipEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "delete",
  order: 70,
  entries: ({ hasClip, lockedTitle, actions }) => [
    {
      type: "item",
      id: "delete",
      label: "Delete",
      shortcut: "Del",
      disabled: !hasClip || lockedTitle !== undefined,
      title: lockedTitle,
      onSelect: actions.remove,
    },
  ],
};
