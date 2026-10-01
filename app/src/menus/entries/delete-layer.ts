import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus; the last layer cannot be
// deleted, and locked source tracks say why they can't be.
export const deleteLayerEntry: MenuEntryProvider<{
  disabled: boolean;
  canRemove: boolean;
  removeTitle?: string;
  actions: { remove: () => void };
}> = {
  id: "delete",
  order: 30,
  entries: ({ disabled, canRemove, removeTitle, actions }) => [
    {
      type: "item",
      id: "delete",
      label: "Delete",
      disabled: disabled || !canRemove,
      title: removeTitle,
      onSelect: actions.remove,
    },
  ],
};
