import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const layerInsertTextClipEntry: MenuEntryProvider<LayerMenuContext> = {
  id: "insert-text",
  order: 60,
  entries: ({ disabled, actions }) =>
    actions.insertText
      ? [
          {
            type: "item",
            id: "insert-text",
            label: "Insert text at playhead",
            disabled,
            onSelect: actions.insertText,
          },
        ]
      : [],
};
