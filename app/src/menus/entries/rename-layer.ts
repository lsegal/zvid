import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus.
export const renameLayerEntry: MenuEntryProvider<{
  disabled: boolean;
  actions: { rename: () => void };
}> = {
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
