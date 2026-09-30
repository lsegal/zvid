import { canMoveLane } from "../../lanes.ts";
import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const moveLayerEntries: MenuEntryProvider<LayerMenuContext> = {
  id: "move",
  order: 110,
  entries: ({ lanes, laneId, disabled, actions }) => [
    {
      type: "item",
      id: "move-up",
      label: "Move up",
      disabled: disabled || !canMoveLane(lanes, laneId, -1),
      onSelect: actions.moveUp,
    },
    {
      type: "item",
      id: "move-down",
      label: "Move down",
      disabled: disabled || !canMoveLane(lanes, laneId, 1),
      onSelect: actions.moveDown,
    },
  ],
};
