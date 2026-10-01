import { canMoveLane, type LaneLike } from "../../lanes.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Shared by the layer and source track menus; locked source tracks say why
// they can't move.
export const moveLayerEntries: MenuEntryProvider<{
  lanes: readonly LaneLike[];
  laneId: string;
  disabled: boolean;
  canMove?: boolean;
  moveTitle?: string;
  actions: { moveUp: () => void; moveDown: () => void };
}> = {
  id: "move",
  order: 110,
  entries: ({
    lanes,
    laneId,
    disabled,
    canMove = true,
    moveTitle,
    actions,
  }) => [
    {
      type: "item",
      id: "move-up",
      label: "Move up",
      disabled: disabled || !canMove || !canMoveLane(lanes, laneId, -1),
      title: moveTitle,
      onSelect: actions.moveUp,
    },
    {
      type: "item",
      id: "move-down",
      label: "Move down",
      disabled: disabled || !canMove || !canMoveLane(lanes, laneId, 1),
      title: moveTitle,
      onSelect: actions.moveDown,
    },
  ],
};
