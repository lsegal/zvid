import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus; the last layer cannot be
// deleted.
export const deleteLayerEntry: MenuEntryProvider<{
  disabled: boolean;
  canRemove: boolean;
  actions: { remove: () => void };
}> = {
  id: "delete",
  order: 30,
  entries: ({ disabled, canRemove, actions }) => [
    {
      type: "item",
      id: "delete",
      label: "Delete",
      disabled: disabled || !canRemove,
      onSelect: actions.remove,
    },
  ],
};
