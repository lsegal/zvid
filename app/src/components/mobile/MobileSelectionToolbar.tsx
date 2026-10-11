import {
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  ScissorsIcon,
  TrashIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";
import type { ContextMenuEntry, ContextMenuItem } from "../../context-menu.ts";
import { pickMenuItems } from "../../mobile/timeline-touch.ts";

// The clip menu's entries the toolbar shows, by id. They come from the same
// registry as the menu (menus/clip-menu.ts), so they share its labels,
// disabled states and actions.
const MENU_ITEM_ICONS: Record<
  string,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  split: ScissorsIcon,
  duplicate: DocumentDuplicateIcon,
  delete: TrashIcon,
};

type MobileSelectionToolbarProps = {
  entries: ContextMenuEntry[];
  isTrimming: boolean;
  onToggleTrim: () => void;
  onOpenFx: () => void;
  onOpenMenu: () => void;
};

// Shown while a clip is selected on the mobile timeline, in place of a
// right-click menu: Split, Duplicate, Trim, FX and Delete, with the rest
// of the clip's menu behind More.
export function MobileSelectionToolbar({
  entries,
  isTrimming,
  onToggleTrim,
  onOpenFx,
  onOpenMenu,
}: MobileSelectionToolbarProps) {
  const [split, duplicate, remove] = pickMenuItems(entries, [
    "split",
    "duplicate",
    "delete",
  ]);

  return (
    <div
      aria-label="Clip actions"
      className="mobile-selection-toolbar"
      role="toolbar"
    >
      <MenuItemButton item={split} />
      <MenuItemButton item={duplicate} />
      <button
        aria-pressed={isTrimming}
        className="mobile-tool-button"
        onClick={onToggleTrim}
        type="button"
      >
        <ArrowsRightLeftIcon aria-hidden="true" />
        <span>Trim</span>
      </button>
      <button className="mobile-tool-button" onClick={onOpenFx} type="button">
        <AdjustmentsHorizontalIcon aria-hidden="true" />
        <span>FX</span>
      </button>
      <MenuItemButton item={remove} />
      <button
        aria-haspopup="menu"
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

function MenuItemButton({ item }: { item: ContextMenuItem | undefined }) {
  if (!item) {
    return null;
  }
  const Icon = MENU_ITEM_ICONS[item.id];
  return (
    <button
      aria-label={item.label}
      className="mobile-tool-button"
      disabled={item.disabled}
      onClick={item.onSelect}
      title={item.title}
      type="button"
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{shortLabel(item.label)}</span>
    </button>
  );
}

// "Split at Playhead" fits as "Split"; the toolbar's buttons are narrow.
function shortLabel(label: string) {
  return label.split(" ")[0] ?? label;
}
