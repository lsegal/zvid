import { formatShortcut } from "../../clip-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

// Cut, Copy and Delete for the selected span, when the menu has them.
export const selectionClipboardEntries: MenuEntryProvider<SelectionMenuContext> =
  {
    id: "clipboard",
    order: 10,
    entries: ({ clipboard, disabled }) => {
      if (!clipboard) {
        return [];
      }

      const clipboardDisabled = disabled || !clipboard.hasContent;
      return [
        {
          type: "item",
          id: "cut",
          label: "Cut",
          shortcut: formatShortcut("X", clipboard.mac),
          disabled: clipboardDisabled,
          onSelect: clipboard.cut,
        },
        {
          type: "item",
          id: "copy",
          label: "Copy",
          shortcut: formatShortcut("C", clipboard.mac),
          disabled: clipboardDisabled,
          onSelect: clipboard.copy,
        },
        {
          type: "item",
          id: "delete",
          label: "Delete",
          shortcut: "Del",
          disabled: clipboardDisabled,
          onSelect: clipboard.remove,
        },
        { type: "separator" },
      ];
    },
  };
