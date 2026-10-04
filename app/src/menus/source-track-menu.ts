// The right-click menu for a source track's label: the layer header's
// Rename, Duplicate, Delete and Move entries, for source tracks.
import type { ContextMenuEntry } from "../context-menu.ts";
import type { LaneLike } from "../lanes.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../source-tracks-section.ts";
import { deleteLayerEntry } from "./entries/delete-layer.ts";
import { duplicateLayerEntry } from "./entries/duplicate-layer.ts";
import { moveLayerEntries } from "./entries/move-layer.ts";
import { renameLayerEntry } from "./entries/rename-layer.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export type SourceTrackMenuActions = {
  rename: () => void;
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
  // Disables Delete and Move while the source tracks are locked.
  locked?: boolean;
  actions: SourceTrackMenuActions;
};

export type SourceTrackMenuContext = {
  // The source tracks, named like the layer entries they share expect.
  lanes: readonly LaneLike[];
  laneId: string;
  disabled: boolean;
  canRemove: boolean;
  removeTitle: string | undefined;
  canMove: boolean;
  moveTitle: string | undefined;
  actions: SourceTrackMenuActions;
};

export const sourceTrackMenuEntries: readonly MenuEntryProvider<SourceTrackMenuContext>[] =
  [
    renameLayerEntry,
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
  locked = false,
  actions,
}: SourceTrackMenuOptions): ContextMenuEntry[] {
  const lockedTitle = locked ? SOURCE_TRACKS_LOCKED_TITLE : undefined;
  return assembleMenu(sourceTrackMenuEntries, {
    lanes: tracks,
    laneId: trackId,
    disabled,
    canRemove: !locked,
    removeTitle: lockedTitle,
    canMove: !locked,
    moveTitle: lockedTitle,
    actions,
  });
}
