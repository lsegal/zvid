// The right-click menu for empty space in a source track's timeline row: the
// layer lane menu's entries, acting on the source track and its selected
// source clip, and New MIDI Clip.
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
  // Places an empty MIDI clip where the menu was opened.
  newMidiClip: () => void;
};

/**
 * The source lane menu: Jump to start, Cut, Copy, Paste, Duplicate, Split at
 * playhead and Delete, as on empty layer space. Paste goes into the track,
 * and the rest act on its selected source clip, disabled without one. Jump
 * to start and Split have no shortcut hint, as on a source clip. New MIDI
 * Clip follows, disabled like Paste while the source tracks are locked.
 */
export function buildSourceLaneMenuEntries({
  locked,
  newMidiClip,
  ...options
}: SourceLaneMenuOptions): ContextMenuEntry[] {
  const lockedTitle = locked ? SOURCE_TRACKS_LOCKED_TITLE : undefined;
  return [
    ...buildClipMenuEntries({
      ...options,
      lockedTitle,
      jumpShortcut: false,
      splitShortcut: false,
    }),
    { type: "separator" },
    {
      type: "item",
      id: "new-midi-clip",
      label: "New MIDI Clip",
      disabled: locked,
      title: lockedTitle,
      onSelect: newMidiClip,
    },
  ];
}
