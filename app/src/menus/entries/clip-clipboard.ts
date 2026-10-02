import { formatShortcut } from "../../clip-menu.ts";
import type { ClipMenuContext } from "../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Cut, Copy and Paste; Paste is also available on empty lane space.
export const clipClipboardEntries: MenuEntryProvider<ClipMenuContext> = {
  id: "clipboard",
  order: 30,
  entries: ({ hasClip, canPaste, mac, lockedTitle, actions }) => [
    {
      type: "item",
      id: "cut",
      label: "Cut",
      shortcut: formatShortcut("X", mac),
      disabled: !hasClip || lockedTitle !== undefined,
      title: lockedTitle,
      onSelect: actions.cut,
    },
    {
      type: "item",
      id: "copy",
      label: "Copy",
      shortcut: formatShortcut("C", mac),
      disabled: !hasClip,
      onSelect: actions.copy,
    },
    {
      type: "item",
      id: "paste",
      label: "Paste",
      shortcut: formatShortcut("V", mac),
      disabled: !canPaste || lockedTitle !== undefined,
      title: lockedTitle,
      onSelect: actions.paste,
    },
  ],
};
