// The right-click menu for empty space in a source track's timeline row: the
// layer lane menu's entries, acting on the source track and its selected
// source clip.
import type { ContextMenuEntry } from "../context-menu.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../source-tracks-section.ts";
import { buildClipMenuEntries, type ClipMenuActions } from "./clip-menu.ts";

export type SourceLaneMenuOptions = {
  // Whether the track has a selected source clip for the entries that need one.
  hasClip: boolean;
  // Whether the clipboard holds something to paste into a source track.
  canPaste: boolean;
  canSplit: boolean;
  mac: boolean;
  // Disables the entries that change the source track's timing or content.
  locked: boolean;
  actions: ClipMenuActions;
};

/**
 * The source lane menu: Jump to start, Cut, Copy, Paste, Duplicate, Split at
 * playhead and Delete, as on empty layer space. Paste goes into the track,
 * and the rest act on its selected source clip, disabled without one. Jump
 * to start and Split have no shortcut hint, as on a source clip.
 */
export function buildSourceLaneMenuEntries({
  locked,
  ...options
}: SourceLaneMenuOptions): ContextMenuEntry[] {
  return buildClipMenuEntries({
    ...options,
    lockedTitle: locked ? SOURCE_TRACKS_LOCKED_TITLE : undefined,
    jumpShortcut: false,
    splitShortcut: false,
  });
}
