import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import { selectionSubmenu } from "../separators.ts";

// Edit > Layer: the selected layer's header menu.
export const editLayerSubmenuEntry: MenuEntryProvider<EditMenuContext> = {
  id: "layer",
  order: 70,
  entries: ({ layer }) =>
    layer ? [selectionSubmenu("layer", "Layer", layer.name, layer.entries)] : [],
};
