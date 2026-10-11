import type { ClipMenuState } from "../app/types.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { ContextMenu } from "./ContextMenu";
import { MenuSheet } from "./mobile/MenuSheet";

type TimelineContextMenuProps = {
  clipMenu: ClipMenuState | null;
  getClipMenuEntries: (menu: ClipMenuState) => ContextMenuEntry[];
  onClose: () => void;
  // Shows the menu as a bottom sheet, as the mobile shell does.
  asSheet?: boolean;
};

const MENU_LABELS: Record<ClipMenuState["kind"], string> = {
  clip: "Clip actions",
  lane: "Layer actions",
  selection: "Selection actions",
  span: "Source clip actions",
  layer: "Layer header actions",
  "source-track": "Source track actions",
  "source-lane": "Source track timeline actions",
  audio: "Audio actions",
};

// The open timeline context menu: a clip's, a source clip's, a layer's or
// its header's, a source track's or its timeline space's, the range selection's, or the main
// audio's.
export function TimelineContextMenu({
  clipMenu,
  getClipMenuEntries,
  onClose,
  asSheet = false,
}: TimelineContextMenuProps) {
  if (asSheet) {
    return (
      <MenuSheet
        entries={clipMenu ? getClipMenuEntries(clipMenu) : []}
        label={clipMenu ? MENU_LABELS[clipMenu.kind] : "Clip actions"}
        onClose={onClose}
        open={clipMenu !== null}
      />
    );
  }
  return (
    <ContextMenu
      anchor={clipMenu?.anchor ?? null}
      entries={clipMenu ? getClipMenuEntries(clipMenu) : []}
      label={clipMenu ? MENU_LABELS[clipMenu.kind] : "Clip actions"}
      onClose={onClose}
    />
  );
}
