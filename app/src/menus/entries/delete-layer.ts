import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// The last layer cannot be deleted.
export const deleteLayerEntry: MenuEntryProvider<LayerMenuContext> = {
  id: "delete",
  order: 30,
  entries: ({ lanes, disabled, actions }) => [
    {
      type: "item",
      id: "delete",
      label: "Delete",
      disabled: disabled || lanes.length <= 1,
      onSelect: actions.remove,
    },
  ],
};
