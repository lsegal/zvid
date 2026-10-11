import {
  ChatBubbleBottomCenterTextIcon,
  EllipsisHorizontalIcon,
  PaintBrushIcon,
  SparklesIcon,
  TrashIcon,
} from "@heroicons/react/24/solid";
import type { ContextMenuEntry } from "../../context-menu.ts";
import { pickMenuItems } from "../../mobile/timeline-touch.ts";
import { MenuItemButton } from "./MobileSelectionToolbar";

type MobileRangeToolbarProps = {
  entries: ContextMenuEntry[];
  onOpenMenu: () => void;
};

// Shown while a lane selection is drawn on the mobile timeline, in place of
// its right-click menu: Fill, Text, FX and Delete from the selection's menu
// (menus/selection-menu.ts), with the rest of it, Insert Track among them,
// behind More.
export function MobileRangeToolbar({
  entries,
  onOpenMenu,
}: MobileRangeToolbarProps) {
  const [fill, text, fx, remove] = pickMenuItems(entries, [
    "insert-fill",
    "insert-text",
    "insert-fx",
    "delete",
  ]);

  return (
    <div
      aria-label="Selection actions"
      className="mobile-selection-toolbar"
      role="toolbar"
    >
      <MenuItemButton icon={PaintBrushIcon} item={fill} label="Fill" />
      <MenuItemButton
        icon={ChatBubbleBottomCenterTextIcon}
        item={text}
        label="Text"
      />
      <MenuItemButton icon={SparklesIcon} item={fx} label="FX" />
      <MenuItemButton icon={TrashIcon} item={remove} />
      <button
        aria-haspopup="menu"
        aria-label="More selection actions"
        className="mobile-tool-button"
        onClick={onOpenMenu}
        type="button"
      >
        <EllipsisHorizontalIcon aria-hidden="true" />
        <span>More</span>
      </button>
    </div>
  );
}
