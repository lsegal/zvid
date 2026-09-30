import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

export const clearSelectionEntry: MenuEntryProvider<SelectionMenuContext> = {
  id: "clear-selection",
  order: 70,
  entries: ({ clear }) => [
    {
      type: "item",
      id: "clear-selection",
      label: "Clear selection",
      shortcut: "Esc",
      onSelect: clear,
    },
  ],
};
