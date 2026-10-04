// The right-click menu for a source clip: the layer clip menu's entries,
// acting within its source track, then "Copy to layer".
import type { CopyToLayerTarget } from "../clip-menu.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import type { DropLane } from "../source-clip-drop.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../source-tracks-section.ts";
import {
  type ClipMenuActions,
  type ClipMenuContext,
  clipMenuEntries,
} from "./clip-menu.ts";
import { copySourceSpanToLayerEntry } from "./entries/copy-source-span-to-layer.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";

export type SourceSpanMenuContext = ClipMenuContext & {
  lanes: readonly (DropLane & { name: string })[];
  copyToLayer: (target: CopyToLayerTarget) => void;
};

export type SourceSpanMenuOptions = {
  lanes: readonly (DropLane & { name: string })[];
  mac: boolean;
  // Whether the clipboard holds a source clip to paste into a source track.
  canPaste: boolean;
  canSplit: boolean;
  // Disables the entries that change the source track's timing or content.
  locked: boolean;
  actions: ClipMenuActions;
  copyToLayer: (target: CopyToLayerTarget) => void;
};

export const sourceSpanMenuEntries: readonly MenuEntryProvider<SourceSpanMenuContext>[] =
  [
    ...clipMenuEntries,
    menuSeparator("before-copy-to-layer", 80),
    copySourceSpanToLayerEntry,
  ];

/**
 * The source clip menu: Jump to start, Cut, Copy, Paste, Duplicate, Split at
 * playhead and Delete, as for a layer clip, then "Copy to layer" with every
 * layer. Split has no shortcut hint, since Mod+E never splits a source
 * clip, and Jump to start none, since Ctrl/Cmd-click adds the clip to the
 * arrangement instead.
 */
export function buildSourceSpanMenuEntries({
  locked,
  ...options
}: SourceSpanMenuOptions): ContextMenuEntry[] {
  return assembleMenu(sourceSpanMenuEntries, {
    ...options,
    hasClip: true,
    lockedTitle: locked ? SOURCE_TRACKS_LOCKED_TITLE : undefined,
    jumpShortcut: false,
    splitShortcut: false,
  });
}
