import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const layerInsertFxClipEntry: MenuEntryProvider<LayerMenuContext> = {
  id: "insert-fx",
  order: 70,
  entries: ({ disabled, actions }) =>
    actions.insertFx
      ? [
          {
            type: "item",
            id: "insert-fx",
            label: "Insert FX clip at playhead",
            disabled,
            onSelect: actions.insertFx,
          },
        ]
      : [],
};
