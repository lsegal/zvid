// Right-click menus for a layer header and the Audio row, and the history
// labels of the layer actions.
import type { ContextMenuEntry } from "./context-menu.ts";
import type { FxEffectDefinition } from "./fx-registry.ts";
import { canAddLane, canMoveLane, type LaneLike } from "./lanes.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";

export const MAX_LAYERS_MESSAGE = `You already have the maximum of ${MAX_LAYERS} layers.`;

export type LayerMenuActions = {
  rename: () => void;
  duplicate: () => void;
  remove: () => void;
  toggleFx: () => void;
  addFx: (effectName: string) => void;
  insertAbove: () => void;
  insertBelow: () => void;
  moveUp: () => void;
  moveDown: () => void;
};

// History labels name the layer as the header shows it before the change.
export const layerHistoryLabels = {
  rename: (name: string) => `Rename ${name}`,
  duplicate: (name: string) => `Duplicate ${name}`,
  remove: (name: string) => `Delete ${name}`,
  insert: (name: string, where: "above" | "below") =>
    `Insert layer ${where} ${name}`,
  move: (name: string, direction: -1 | 1) =>
    `Move ${name} ${direction < 0 ? "up" : "down"}`,
};

/**
 * The menu for the header of layer `laneId`. `fxEnabled` is the layer-wide
 * FX bypass and `effectCount` its effects not counting Layout.
 */
export function buildLayerMenuEntries({
  lanes,
  laneId,
  fxEnabled,
  effectCount,
  effects,
  disabled = false,
  actions,
}: {
  lanes: readonly LaneLike[];
  laneId: string;
  fxEnabled: boolean;
  effectCount: number;
  effects: readonly FxEffectDefinition[];
  // Everything is disabled while exporting.
  disabled?: boolean;
  actions: LayerMenuActions;
}): ContextMenuEntry[] {
  const canAdd = canAddLane(lanes);
  const addTitle = canAdd ? undefined : MAX_LAYERS_MESSAGE;
  return [
    {
      type: "item",
      id: "rename",
      label: "Rename…",
      disabled,
      onSelect: actions.rename,
    },
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      disabled: disabled || !canAdd,
      title: addTitle,
      onSelect: actions.duplicate,
    },
    {
      type: "item",
      id: "delete",
      label: "Delete",
      disabled: disabled || lanes.length <= 1,
      onSelect: actions.remove,
    },
    { type: "separator" },
    {
      type: "item",
      id: "toggle-fx",
      label: fxEnabled ? "Disable FX" : "Enable FX",
      disabled: disabled || !effectCount,
      onSelect: actions.toggleFx,
    },
    {
      type: "item",
      id: "add-fx",
      label: "Add FX",
      disabled: disabled || !effects.length,
      submenu: effects.map((definition) => ({
        type: "item",
        id: `fx-${definition.effectName}`,
        label: definition.displayName,
        onSelect: () => actions.addFx(definition.effectName),
      })),
    },
    { type: "separator" },
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
    { type: "separator" },
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
  ];
}

/** The Audio row menu: Import, or Replace and Remove once there is audio. */
export function buildMainAudioMenuEntries({
  hasMainAudio,
  disabled = false,
  chooseFile,
  remove,
}: {
  hasMainAudio: boolean;
  disabled?: boolean;
  chooseFile: () => void;
  remove: () => void;
}): ContextMenuEntry[] {
  if (!hasMainAudio) {
    return [
      {
        type: "item",
        id: "import",
        label: "Import main audio…",
        disabled,
        onSelect: chooseFile,
      },
    ];
  }

  return [
    {
      type: "item",
      id: "replace",
      label: "Replace main audio…",
      disabled,
      onSelect: chooseFile,
    },
    {
      type: "item",
      id: "remove",
      label: "Remove main audio",
      disabled,
      onSelect: remove,
    },
  ];
}
