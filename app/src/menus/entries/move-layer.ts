import { canMoveLane, type LaneLike } from "../../lanes.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus.
export const moveLayerEntries: MenuEntryProvider<{
  lanes: readonly LaneLike[];
  laneId: string;
  disabled: boolean;
  actions: { moveUp: () => void; moveDown: () => void };
}> = {
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
