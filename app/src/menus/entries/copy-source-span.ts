import { formatShortcut } from "../../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import type { SourceSpanMenuContext } from "../source-span-menu.ts";

export const copySourceSpanEntry: MenuEntryProvider<SourceSpanMenuContext> = {
  id: "copy",
  order: 10,
  entries: ({ mac, copy }) => [
    {
      type: "item",
      id: "copy",
      label: "Copy",
      shortcut: formatShortcut("C", mac),
      onSelect: copy,
    },
  ],
};
