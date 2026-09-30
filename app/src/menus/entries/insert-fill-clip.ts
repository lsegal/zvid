import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

// Covers the selection with a new fill clip, when the menu offers it.
export const insertFillClipEntry: MenuEntryProvider<SelectionMenuContext> = {
  id: "insert-fill",
  order: 30,
  entries: ({ insertFill, disabled }) =>
    insertFill
      ? [
          {
            type: "item",
            id: "insert-fill",
            label: "Insert Fill Clip",
            disabled,
            onSelect: insertFill,
          },
        ]
      : [],
};
