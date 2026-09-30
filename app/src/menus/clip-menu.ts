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
  canPaste: boolean;
  canSplit: boolean;
  mac: boolean;
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
