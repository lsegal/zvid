// Pure logic behind the shared right-click menu (components/ContextMenu.tsx):
// which item is active at each open level, keyboard navigation between items
// and submenus, and placing menus inside the viewport.

export type ContextMenuItem = {
  type: "item";
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  // Tooltip, such as why the item is disabled.
  title?: string;
  // A color chip shown before the label, such as a source track's color.
  swatch?: string;
  onSelect?: () => void;
  submenu?: ContextMenuEntry[];
};

export type ContextMenuSeparator = { type: "separator" };

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

// One active index per open level: `[2]` highlights the third root item,
// `[2, -1]` also opens its submenu with nothing highlighted in it.
export type ContextMenuPath = number[];

export type ContextMenuKeyResult =
  | { type: "path"; path: ContextMenuPath }
  | { type: "activate"; item: ContextMenuItem }
  | { type: "close" }
  | { type: "ignore" };

export type MenuPoint = { x: number; y: number };
export type MenuSize = { width: number; height: number };
export type MenuRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// Keeps menus off the very edge of the window.
export const MENU_VIEWPORT_MARGIN = 4;

function isEnabledItem(
  entry: ContextMenuEntry | undefined,
): entry is ContextMenuItem {
  return entry?.type === "item" && !entry.disabled;
}

/** Whether a key press asks for a context menu: the menu key or Shift+F10. */
export function isContextMenuKey(event: {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}) {
  if (event.key === "ContextMenu") {
    return true;
  }

  return (
    event.key === "F10" &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

/**
 * Whether a pointer press opens a context menu rather than acting as a click
 * or drag: the secondary button, or Ctrl with the primary button on macOS,
 * which browsers there also report as a contextmenu event.
 */
export function isContextMenuPress(
  event: { button: number; ctrlKey: boolean },
  mac: boolean,
) {
  return event.button === 2 || (mac && event.button === 0 && event.ctrlKey);
}

/** The entries shown at `level`, or undefined when that level is not open. */
export function getLevelEntries(
  entries: readonly ContextMenuEntry[],
  path: ContextMenuPath,
  level: number,
): readonly ContextMenuEntry[] | undefined {
  let current: readonly ContextMenuEntry[] | undefined = entries;
  for (let index = 0; index < level; index += 1) {
    const parent: ContextMenuEntry | undefined = current?.[path[index]];
    current = parent?.type === "item" ? parent.submenu : undefined;
  }

  return current;
}

/**
 * The next enabled item after `from` in `direction`, wrapping around, or -1
 * when the level has none. `from = -1` starts before the first item.
 */
export function stepEnabledIndex(
  entries: readonly ContextMenuEntry[],
  from: number,
  direction: 1 | -1,
) {
  const count = entries.length;
  if (!count) {
    return -1;
  }

  let index = from < 0 ? (direction === 1 ? -1 : count) : from;
  for (let step = 0; step < count; step += 1) {
    index = (index + direction + count) % count;
    if (isEnabledItem(entries[index])) {
      return index;
    }
  }

  return -1;
}

export function firstEnabledIndex(entries: readonly ContextMenuEntry[]) {
  return stepEnabledIndex(entries, -1, 1);
}

function lastEnabledIndex(entries: readonly ContextMenuEntry[]) {
  return stepEnabledIndex(entries, -1, -1);
}

function withActive(path: ContextMenuPath, index: number) {
  return [...path.slice(0, -1), index];
}

/**
 * The path after the pointer moves onto item `index` of `level`. Hovering an
 * enabled item with a submenu opens it.
 */
export function hoverMenuPath(
  entries: readonly ContextMenuEntry[],
  path: ContextMenuPath,
  level: number,
  index: number,
): ContextMenuPath {
  const levelEntries = getLevelEntries(entries, path, level);
  const entry = levelEntries?.[index];
  const next = [...path.slice(0, level), index];
  if (!isEnabledItem(entry)) {
    return [...path.slice(0, level), -1];
  }

  return entry.submenu ? [...next, -1] : next;
}

/** How a key press inside an open menu changes it. */
export function handleMenuKey(
  entries: readonly ContextMenuEntry[],
  path: ContextMenuPath,
  key: string,
): ContextMenuKeyResult {
  const level = path.length - 1;
  const levelEntries = getLevelEntries(entries, path, level) ?? [];
  const active = path[level] ?? -1;
  const activeEntry = levelEntries[active];

  switch (key) {
    case "ArrowDown":
      return {
        type: "path",
        path: withActive(path, stepEnabledIndex(levelEntries, active, 1)),
      };
    case "ArrowUp":
      return {
        type: "path",
        path: withActive(path, stepEnabledIndex(levelEntries, active, -1)),
      };
    case "Home":
      return {
        type: "path",
        path: withActive(path, firstEnabledIndex(levelEntries)),
      };
    case "End":
      return {
        type: "path",
        path: withActive(path, lastEnabledIndex(levelEntries)),
      };
    case "ArrowRight":
      if (isEnabledItem(activeEntry) && activeEntry.submenu) {
        return {
          type: "path",
          path: [...path, firstEnabledIndex(activeEntry.submenu)],
        };
      }
      return { type: "ignore" };
    case "ArrowLeft":
      return level > 0
        ? { type: "path", path: path.slice(0, -1) }
        : { type: "ignore" };
    case "Enter":
    case " ":
      if (!isEnabledItem(activeEntry)) {
        return { type: "ignore" };
      }
      if (activeEntry.submenu) {
        return {
          type: "path",
          path: [...path, firstEnabledIndex(activeEntry.submenu)],
        };
      }
      return { type: "activate", item: activeEntry };
    case "Escape":
      return level > 0
        ? { type: "path", path: path.slice(0, -1) }
        : { type: "close" };
    case "Tab":
      return { type: "close" };
    default:
      return { type: "ignore" };
  }
}

function clampStart(start: number, size: number, limit: number) {
  const max = limit - MENU_VIEWPORT_MARGIN - size;
  return Math.max(MENU_VIEWPORT_MARGIN, Math.min(start, max));
}

/**
 * Top-left corner for a menu opened at `anchor`: below and to the right of
 * it, flipping left or up when it would leave the viewport.
 */
export function placeContextMenu(
  anchor: MenuPoint,
  size: MenuSize,
  viewport: MenuSize,
): MenuPoint {
  const fitsRight =
    anchor.x + size.width <= viewport.width - MENU_VIEWPORT_MARGIN;
  const fitsBelow =
    anchor.y + size.height <= viewport.height - MENU_VIEWPORT_MARGIN;
  return {
    x: clampStart(
      fitsRight ? anchor.x : anchor.x - size.width,
      size.width,
      viewport.width,
    ),
    y: clampStart(
      fitsBelow ? anchor.y : anchor.y - size.height,
      size.height,
      viewport.height,
    ),
  };
}

/**
 * Top-left corner for a submenu beside its parent item: to the right and
 * aligned with the item's top, flipping left or up near the edges.
 */
export function placeSubmenu(
  item: MenuRect,
  size: MenuSize,
  viewport: MenuSize,
  // Pulls the submenu's first row level with the item past its padding.
  offset = 0,
): MenuPoint {
  const fitsRight =
    item.right + size.width <= viewport.width - MENU_VIEWPORT_MARGIN;
  const top = item.top - offset;
  const fitsBelow = top + size.height <= viewport.height - MENU_VIEWPORT_MARGIN;
  return {
    x: clampStart(
      fitsRight ? item.right : item.left - size.width,
      size.width,
      viewport.width,
    ),
    y: clampStart(
      fitsBelow ? top : item.bottom + offset - size.height,
      size.height,
      viewport.height,
    ),
  };
}
