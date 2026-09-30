import { formatShortcut } from "../../clip-menu.ts";
import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const splitClipEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "split",
  order: 50,
  entries: ({ hasClip, canSplit, mac, actions }) => [
    {
      type: "item",
      id: "split",
      label: "Split at playhead",
      shortcut: formatShortcut("E", mac),
      disabled: !hasClip || !canSplit,
      onSelect: actions.split,
    },
  ],
};
