import type { ClipMenuState } from "../app/types.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { ContextMenu } from "./ContextMenu";

type TimelineContextMenuProps = {
  clipMenu: ClipMenuState | null;
  getClipMenuEntries: (menu: ClipMenuState) => ContextMenuEntry[];
  onClose: () => void;
};

// The open timeline context menu: a clip's, a source clip's, a layer's or
// its header's, the range selection's, or the main audio's.
export function TimelineContextMenu({
  clipMenu,
  getClipMenuEntries,
  onClose,
}: TimelineContextMenuProps) {
  return (
    <ContextMenu
      anchor={clipMenu?.anchor ?? null}
      entries={clipMenu ? getClipMenuEntries(clipMenu) : []}
      label={
        clipMenu?.kind === "span"
          ? "Source clip actions"
          : clipMenu?.kind === "layer"
            ? "Layer header actions"
            : clipMenu?.kind === "audio"
              ? "Main audio actions"
              : clipMenu?.kind === "lane"
                ? "Layer actions"
                : clipMenu?.kind === "selection"
                  ? "Selection actions"
                  : "Clip actions"
      }
      onClose={onClose}
    />
  );
}
