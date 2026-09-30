import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const renameLayerEntry: MenuEntryProvider<LayerMenuContext> = {
  id: "rename",
  order: 10,
  entries: ({ disabled, actions }) => [
    {
      type: "item",
      id: "rename",
      label: "Rename…",
      disabled,
      onSelect: actions.rename,
    },
  ],
};
