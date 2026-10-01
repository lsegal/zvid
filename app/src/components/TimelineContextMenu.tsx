import type { ClipMenuState } from "../app/types.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { ContextMenu } from "./ContextMenu";

type TimelineContextMenuProps = {
  clipMenu: ClipMenuState | null;
  getClipMenuEntries: (menu: ClipMenuState) => ContextMenuEntry[];
  onClose: () => void;
};

const MENU_LABELS: Record<ClipMenuState["kind"], string> = {
  clip: "Clip actions",
  lane: "Layer actions",
  selection: "Selection actions",
  span: "Source clip actions",
  layer: "Layer header actions",
  "source-track": "Source track actions",
  audio: "Main audio actions",
};

// The open timeline context menu: a clip's, a source clip's, a layer's or
// its header's, a source track's, the range selection's, or the main
// audio's.
export function TimelineContextMenu({
  clipMenu,
  getClipMenuEntries,
  onClose,
}: TimelineContextMenuProps) {
  return (
    <ContextMenu
      anchor={clipMenu?.anchor ?? null}
      entries={clipMenu ? getClipMenuEntries(clipMenu) : []}
      label={clipMenu ? MENU_LABELS[clipMenu.kind] : "Clip actions"}
      onClose={onClose}
    />
  );
}
