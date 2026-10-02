import { formatClipJumpShortcut } from "../../clip-jump.ts";
import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const jumpToClipStartEntry: MenuEntryProvider<ClipMenuContext> = {
  id: "jump-to-start",
  order: 10,
  entries: ({ hasClip, mac, jumpShortcut = true, actions }) => [
    {
      type: "item",
      id: "jump-to-start",
      label: "Jump to start",
      shortcut: jumpShortcut ? formatClipJumpShortcut(mac) : undefined,
      disabled: !hasClip,
      onSelect: actions.jumpToStart,
    },
  ],
};
