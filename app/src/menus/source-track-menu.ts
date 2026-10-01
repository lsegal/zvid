// The right-click menu for a source track's label: the layer header's
// Duplicate, Delete and Move entries, for source tracks.
import type { ContextMenuEntry } from "../context-menu.ts";
import type { LaneLike } from "../lanes.ts";
import { deleteLayerEntry } from "./entries/delete-layer.ts";
import { duplicateLayerEntry } from "./entries/duplicate-layer.ts";
import { moveLayerEntries } from "./entries/move-layer.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export type SourceTrackMenuActions = {
  duplicate: () => void;
  remove: () => void;
  moveUp: () => void;
  moveDown: () => void;
};

export type SourceTrackMenuOptions = {
  tracks: readonly LaneLike[];
  trackId: string;
  // Disables every entry.
  disabled?: boolean;
  actions: SourceTrackMenuActions;
};

export type SourceTrackMenuContext = {
  // The source tracks, named like the layer entries they share expect.
  lanes: readonly LaneLike[];
  laneId: string;
  disabled: boolean;
  canAdd: boolean;
  addTitle: string | undefined;
  canRemove: boolean;
  actions: SourceTrackMenuActions;
};

export const sourceTrackMenuEntries: readonly MenuEntryProvider<SourceTrackMenuContext>[] =
  [
    duplicateLayerEntry,
    deleteLayerEntry,
    menuSeparator("before-move", 100),
    moveLayerEntries,
  ];

/** The menu for the label of source track `trackId`. */
export function buildSourceTrackMenuEntries({
  tracks,
  trackId,
  disabled = false,
  actions,
}: SourceTrackMenuOptions): ContextMenuEntry[] {
  return assembleMenu(sourceTrackMenuEntries, {
    lanes: tracks,
    laneId: trackId,
    disabled,
    // Source tracks have no limit, and the last one can go too.
    canAdd: true,
    addTitle: undefined,
    canRemove: true,
    actions,
  });
}
