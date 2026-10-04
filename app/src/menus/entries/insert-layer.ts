import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const insertLayerEntries: MenuEntryProvider<LayerMenuContext> = {
  id: "insert-layer",
  order: 90,
  entries: ({ disabled, actions }) => [
    {
      type: "item",
      id: "insert-above",
      label: "Insert layer above",
      disabled,
      onSelect: actions.insertAbove,
    },
    {
      type: "item",
      id: "insert-below",
      label: "Insert layer below",
      disabled,
      onSelect: actions.insertBelow,
    },
  ],
};
