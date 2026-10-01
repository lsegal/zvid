import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus.
export const duplicateLayerEntry: MenuEntryProvider<{
  disabled: boolean;
  canAdd: boolean;
  addTitle: string | undefined;
  actions: { duplicate: () => void };
}> = {
  id: "duplicate",
  order: 20,
  entries: ({ disabled, canAdd, addTitle, actions }) => [
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      disabled: disabled || !canAdd,
      title: addTitle,
      onSelect: actions.duplicate,
    },
  ],
};
