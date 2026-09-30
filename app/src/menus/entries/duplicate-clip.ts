import { formatShortcut } from "../../clip-menu.ts";
import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const duplicateClipEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "duplicate",
  order: 40,
  entries: ({ hasClip, mac, actions }) => [
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      shortcut: formatShortcut("D", mac),
      disabled: !hasClip,
      onSelect: actions.duplicate,
    },
  ],
};
