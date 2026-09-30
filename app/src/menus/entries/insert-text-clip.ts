import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

// Covers the selection with a new text clip, when the menu offers it.
export const insertTextClipEntry: MenuEntryProvider<SelectionMenuContext> = {
  id: "insert-text",
  order: 40,
  entries: ({ insertText, disabled }) =>
    insertText
      ? [
          {
            type: "item",
            id: "insert-text",
            label: "Insert Text Clip",
            disabled,
            onSelect: insertText,
          },
        ]
      : [],
};
