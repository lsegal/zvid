// The right-click menu for a layer header.
import type { ContextMenuEntry } from "../context-menu.ts";
import type { FxEffectDefinition } from "../fx-registry.ts";
import { canAddLane, type LaneLike } from "../lanes.ts";
import { MAX_LAYERS_MESSAGE } from "../layer-menu.ts";
import { deleteLayerEntry } from "./entries/delete-layer.ts";
import { duplicateLayerEntry } from "./entries/duplicate-layer.ts";
import { insertLayerEntries } from "./entries/insert-layer.ts";
import { layerFxEntries } from "./entries/layer-fx.ts";
import { layerInsertFxClipEntry } from "./entries/layer-insert-fx-clip.ts";
import { layerInsertTextClipEntry } from "./entries/layer-insert-text-clip.ts";
import { moveLayerEntries } from "./entries/move-layer.ts";
import { renameLayerEntry } from "./entries/rename-layer.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export type LayerMenuActions = {
  rename: () => void;
  duplicate: () => void;
  remove: () => void;
  toggleFx: () => void;
  addFx: (effectName: string) => void;
  // Adds a text clip on the layer at the playhead; omitted where there is
  // no playhead to insert at.
  insertText?: () => void;
  // Adds an empty FX clip on the layer at the playhead; omitted where there
  // is no playhead to insert at.
  insertFx?: () => void;
  insertAbove: () => void;
  insertBelow: () => void;
  moveUp: () => void;
  moveDown: () => void;
};

export type LayerMenuOptions = {
  lanes: readonly LaneLike[];
  laneId: string;
  fxEnabled: boolean;
  effectCount: number;
  effects: readonly FxEffectDefinition[];
  // Disables every entry.
  disabled?: boolean;
  actions: LayerMenuActions;
};

export type LayerMenuContext = LayerMenuOptions & {
  disabled: boolean;
  // Whether another layer fits, and the tooltip saying why when it does not.
  canAdd: boolean;
  addTitle: string | undefined;
};

export const layerMenuEntries: readonly MenuEntryProvider<LayerMenuContext>[] =
  [
    renameLayerEntry,
    duplicateLayerEntry,
    deleteLayerEntry,
    menuSeparator("before-fx", 40),
    layerFxEntries,
    layerInsertTextClipEntry,
    layerInsertFxClipEntry,
    menuSeparator("before-insert-layer", 80),
    insertLayerEntries,
    menuSeparator("before-move", 100),
    moveLayerEntries,
  ];

/**
 * The menu for the header of layer `laneId`. `fxEnabled` is the layer-wide
 * FX bypass and `effectCount` its effects not counting Layout.
 */
export function buildLayerMenuEntries({
  disabled = false,
  ...options
}: LayerMenuOptions): ContextMenuEntry[] {
  const canAdd = canAddLane(options.lanes);
  return assembleMenu(layerMenuEntries, {
    ...options,
    disabled,
    canAdd,
    addTitle: canAdd ? undefined : MAX_LAYERS_MESSAGE,
  });
}
