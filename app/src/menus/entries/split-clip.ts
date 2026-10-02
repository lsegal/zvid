import { formatShortcut } from "../../clip-menu.ts";
import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const splitClipEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "split",
  order: 50,
  entries: ({
    hasClip,
    canSplit,
    mac,
    lockedTitle,
    splitShortcut = true,
    actions,
  }) => [
    {
      type: "item",
      id: "split",
      label: "Split at playhead",
      shortcut: splitShortcut ? formatShortcut("E", mac) : undefined,
      disabled: !hasClip || !canSplit || lockedTitle !== undefined,
      title: lockedTitle,
      onSelect: actions.split,
    },
  ],
};
