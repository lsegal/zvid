// The right-click menu for a source clip.
import type { CopyToLayerTarget } from "../clip-menu.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import type { DropLane } from "../source-clip-drop.ts";
import { copySourceSpanEntry } from "./entries/copy-source-span.ts";
import { copySourceSpanToLayerEntry } from "./entries/copy-source-span-to-layer.ts";
import { assembleMenu, type MenuEntryProvider } from "./registry.ts";

export type SourceSpanMenuContext = {
  lanes: readonly (DropLane & { name: string })[];
  mac: boolean;
  copy: () => void;
  copyToLayer: (target: CopyToLayerTarget) => void;
};

export const sourceSpanMenuEntries: readonly MenuEntryProvider<SourceSpanMenuContext>[] =
  [copySourceSpanEntry, copySourceSpanToLayerEntry];

/** The source clip menu: Copy, and "Copy to layer" with every layer. */
export function buildSourceSpanMenuEntries(
  context: SourceSpanMenuContext,
): ContextMenuEntry[] {
  return assembleMenu(sourceSpanMenuEntries, context);
}
