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
  // Arms or disarms the track for recording; without it the menu has no
  // arm entry.
  toggleArmed?: () => void;
};

export type SourceTrackMenuOptions = {
  tracks: readonly LaneLike[];
  trackId: string;
  // Disables every entry.
  disabled?: boolean;
  // Disables Delete and Move while the source tracks are locked.
  locked?: boolean;
  // Whether the track is armed for recording.
  armed?: boolean;
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
  removeTitle: string | undefined;
  canMove: boolean;
  moveTitle: string | undefined;
  armed: boolean;
  actions: SourceTrackMenuActions;
};

// Arming is this tab's UI state, so a read-only tab can arm too.
const armRecordingEntry: MenuEntryProvider<SourceTrackMenuContext> = {
  id: "arm-recording",
  order: 130,
  entries: ({ armed, actions }) =>
    actions.toggleArmed
      ? [
          { type: "separator" },
          {
            type: "item",
            id: "arm-recording",
            label: armed ? "Disarm Recording" : "Arm for Recording",
            onSelect: actions.toggleArmed,
          },
        ]
      : [],
};

export const sourceTrackMenuEntries: readonly MenuEntryProvider<SourceTrackMenuContext>[] =
  [
    renameLayerEntry,
    duplicateLayerEntry,
    deleteLayerEntry,
    menuSeparator("before-move", 100),
    moveLayerEntries,
    armRecordingEntry,
  ];

/** The menu for the label of source track `trackId`. */
export function buildSourceTrackMenuEntries({
  tracks,
  trackId,
  disabled = false,
  locked = false,
  armed = false,
  actions,
}: SourceTrackMenuOptions): ContextMenuEntry[] {
  const lockedTitle = locked ? SOURCE_TRACKS_LOCKED_TITLE : undefined;
  return assembleMenu(sourceTrackMenuEntries, {
    lanes: tracks,
    laneId: trackId,
    disabled,
    // Source tracks have no limit, and the last one can go too.
    canAdd: true,
    addTitle: undefined,
    canRemove: !locked,
    removeTitle: lockedTitle,
    canMove: !locked,
    moveTitle: lockedTitle,
    armed,
    actions,
  });
}
