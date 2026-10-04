// The right-click menu for an arrangement clip, or for empty lane space.
import type { ContextMenuEntry } from "../context-menu.ts";
import { clipClipboardEntries } from "./entries/clip-clipboard.ts";
import { deleteClipEntry } from "./entries/delete-clip.ts";
import { duplicateClipEntry } from "./entries/duplicate-clip.ts";
import { jumpToClipStartEntry } from "./entries/jump-to-clip-start.ts";
import { splitClipEntry } from "./entries/split-clip.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export type ClipMenuActions = {
  jumpToStart: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  split: () => void;
  remove: () => void;
};

export type ClipMenuContext = {
  hasClip: boolean;
  // Whether the clipboard holds layer clips to paste onto a layer.
  canPaste: boolean;
  canSplit: boolean;
  mac: boolean;
  // Disables Cut, Paste, Duplicate, Split and Delete with this tooltip, such
  // as on a locked source track, where they would change its timing.
  lockedTitle?: string;
  // False leaves out the shortcut hint of Jump to start or Split, on a
  // source clip, where Ctrl/Cmd-click and Mod+E do something else.
  jumpShortcut?: boolean;
  splitShortcut?: boolean;
  actions: ClipMenuActions;
};

export const clipMenuEntries: readonly MenuEntryProvider<ClipMenuContext>[] = [
  jumpToClipStartEntry,
  menuSeparator("after-jump", 20),
  clipClipboardEntries,
  duplicateClipEntry,
  splitClipEntry,
  menuSeparator("before-delete", 60),
  deleteClipEntry,
];

/**
 * The menu for an arrangement clip, or for empty lane space when `hasClip`
 * is false, where only Paste is available.
 */
export function buildClipMenuEntries(
  context: ClipMenuContext,
): ContextMenuEntry[] {
  return assembleMenu(clipMenuEntries, context);
}
