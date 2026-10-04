import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus.
export const duplicateLayerEntry: MenuEntryProvider<{
  disabled: boolean;
  actions: { duplicate: () => void };
}> = {
  id: "duplicate",
  order: 20,
  entries: ({ disabled, actions }) => [
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      disabled,
      onSelect: actions.duplicate,
    },
  ],
};
