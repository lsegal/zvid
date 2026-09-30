import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const duplicateLayerEntry: MenuEntryProvider<LayerMenuContext> = {
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
