import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const insertLayerEntries: MenuEntryProvider<LayerMenuContext> = {
  id: "insert-layer",
  order: 90,
  entries: ({ disabled, canAdd, addTitle, actions }) => [
    {
      type: "item",
      id: "insert-above",
      label: "Insert layer above",
      disabled: disabled || !canAdd,
      title: addTitle,
      onSelect: actions.insertAbove,
    },
    {
      type: "item",
      id: "insert-below",
      label: "Insert layer below",
      disabled: disabled || !canAdd,
      title: addTitle,
      onSelect: actions.insertBelow,
    },
  ],
};
