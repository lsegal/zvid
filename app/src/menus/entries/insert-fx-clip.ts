import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

// Covers the selection with a new FX clip, when the menu offers it.
export const insertFxClipEntry: MenuEntryProvider<SelectionMenuContext> = {
  id: "insert-fx",
  order: 50,
  entries: ({ insertFx, disabled }) =>
    insertFx
      ? [
          {
            type: "item",
            id: "insert-fx",
            label: "Insert FX Clip",
            disabled,
            onSelect: insertFx,
          },
        ]
      : [],
};
