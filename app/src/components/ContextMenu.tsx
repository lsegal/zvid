import { ChevronRightIcon } from "@heroicons/react/24/solid";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type ContextMenuEntry,
  type ContextMenuItem,
  type ContextMenuPath,
  getLevelEntries,
  handleMenuKey,
  hoverMenuPath,
  type MenuPoint,
  placeContextMenu,
  placeSubmenu,
} from "../context-menu";
import "./context-menu.css";

export type {
  ContextMenuEntry,
  ContextMenuItem,
  MenuPoint,
} from "../context-menu";

type ContextMenuProps = {
  // Viewport point the menu opens at, or null while it is closed. A new
  // object reopens the menu there.
  anchor: MenuPoint | null;
  entries: ContextMenuEntry[];
  label: string;
  onClose: () => void;
  // Runs once the menu has closed. Return true when it moved focus itself;
  // otherwise focus goes back to the element that had it before opening.
  onCloseFocus?: () => boolean;
};

/**
 * A right-click menu with shortcut hints, separators, disabled items and
 * hover- or keyboard-opened submenus. It stays inside the viewport and
 * closes on Escape, an outside click, scrolling or leaving the window.
 */
export function ContextMenu({ anchor, ...props }: ContextMenuProps) {
  if (!anchor || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <OpenContextMenu anchor={anchor} {...props} />,
    document.body,
  );
}

function OpenContextMenu({
  anchor,
  entries,
  label,
  onClose,
  onCloseFocus,
}: ContextMenuProps & { anchor: MenuPoint }) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [path, setPath] = useState<ContextMenuPath>([-1]);
  const [positions, setPositions] = useState<Array<MenuPoint | undefined>>([]);
  const onCloseRef = useRef(onClose);
  const onCloseFocusRef = useRef(onCloseFocus);
  onCloseRef.current = onClose;
  onCloseFocusRef.current = onCloseFocus;

  // Reopening at a new point starts over with nothing highlighted.
  useLayoutEffect(() => {
    void anchor;
    setPath([-1]);
  }, [anchor]);

  // Return focus to where it was once the menu is gone, unless the user
  // already moved it somewhere else (such as by clicking another control).
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      window.setTimeout(() => {
        if (onCloseFocusRef.current?.()) {
          return;
        }

        const active = document.activeElement;
        if (!active || active === document.body) {
          previous?.focus();
        }
      }, 0);
    };
  }, []);

  // Scrolling closes the menu when the user does it (wheel or touch), not
  // when the app scrolls the timeline itself, such as to follow playback.
  useEffect(() => {
    const close = () => onCloseRef.current();
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("wheel", closeOutside, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", closeOutside, {
      capture: true,
      passive: true,
    });
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("wheel", closeOutside, true);
      document.removeEventListener("touchmove", closeOutside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  // Measure each open level and place it inside the viewport: the root at
  // the anchor, each submenu beside the item that opened it.
  const openLevels = path.length;
  const pathKey = path.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures when a level opens or closes
  useLayoutEffect(() => {
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
    const next: Array<MenuPoint | undefined> = [];
    for (let level = 0; level < openLevels; level += 1) {
      const panel = panelRefs.current[level];
      if (!panel) {
        break;
      }

      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      if (level === 0) {
        next.push(placeContextMenu(anchor, size, viewport));
        continue;
      }

      const parentItem = panelRefs.current[level - 1]?.querySelector(
        `[data-menu-index="${path[level - 1]}"]`,
      );
      if (!parentItem) {
        break;
      }

      const parentPanel = panelRefs.current[level - 1];
      const padding = parentPanel
        ? Number.parseFloat(getComputedStyle(parentPanel).paddingTop) || 0
        : 0;
      next.push(
        placeSubmenu(
          parentItem.getBoundingClientRect(),
          size,
          viewport,
          padding,
        ),
      );
    }

    setPositions((current) =>
      current.length === next.length &&
      current.every(
        (point, index) =>
          point?.x === next[index]?.x && point?.y === next[index]?.y,
      )
        ? current
        : next,
    );
  }, [anchor, openLevels, pathKey]);

  // Keyboard focus follows the deepest open level. It waits a tick because
  // the right-click that opened the menu can still focus its own target.
  const deepestPositioned = positions[openLevels - 1] !== undefined;
  useEffect(() => {
    if (!deepestPositioned) {
      return;
    }

    const timeout = window.setTimeout(() => {
      panelRefs.current[openLevels - 1]?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [deepestPositioned, openLevels]);

  function activate(item: ContextMenuItem) {
    onCloseRef.current();
    item.onSelect?.();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const result = handleMenuKey(entries, path, event.key);
    // Keep app shortcuts (arrows move the playhead, Delete removes the clip)
    // away from the open menu.
    event.stopPropagation();
    if (result.type === "ignore") {
      return;
    }

    event.preventDefault();
    if (result.type === "close") {
      onCloseRef.current();
    } else if (result.type === "activate") {
      activate(result.item);
    } else {
      setPath(result.path);
    }
  }

  const levels = Array.from({ length: openLevels }, (_, level) =>
    getLevelEntries(entries, path, level),
  );

  return (
    <div className="context-menu-layer" ref={rootRef}>
      {levels.map((levelEntries, level) => {
        if (!levelEntries) {
          return null;
        }

        const position = positions[level];
        const active = path[level] ?? -1;
        const parentLabel =
          level > 0
            ? (getLevelEntries(entries, path, level - 1)?.[path[level - 1]] as
                | ContextMenuItem
                | undefined)
            : undefined;
        return (
          <div
            aria-activedescendant={
              active >= 0 ? `${baseId}-${level}-${active}` : undefined
            }
            aria-label={parentLabel?.label ?? label}
            className="context-menu"
            // biome-ignore lint/suspicious/noArrayIndexKey: one panel per open level
            key={level}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={handleKeyDown}
            onPointerLeave={() => {
              // Leaving a panel clears its highlight but keeps an open
              // submenu open, so the pointer can travel into it.
              if (path.length === level + 1) {
                setPath([...path.slice(0, level), -1]);
              }
            }}
            ref={(element) => {
              panelRefs.current[level] = element;
            }}
            role="menu"
            style={{
              left: position?.x ?? anchor.x,
              top: position?.y ?? anchor.y,
              visibility: position ? undefined : "hidden",
            }}
            tabIndex={-1}
          >
            {levelEntries.map((entry, index) => {
              if (entry.type === "separator") {
                return (
                  <hr
                    className="context-menu__separator"
                    // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
                    key={`separator-${index}`}
                  />
                );
              }

              const highlighted = index === active;
              const expanded =
                Boolean(entry.submenu) &&
                path[level + 1] !== undefined &&
                highlighted;
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the menu, which points at this item with aria-activedescendant
                // biome-ignore lint/a11y/useKeyWithClickEvents: the menu handles keys for every item
                <div
                  aria-disabled={entry.disabled || undefined}
                  aria-expanded={entry.submenu ? expanded : undefined}
                  aria-haspopup={entry.submenu ? "menu" : undefined}
                  className="context-menu__item"
                  data-disabled={entry.disabled ? "" : undefined}
                  data-highlighted={highlighted ? "" : undefined}
                  data-menu-index={index}
                  id={`${baseId}-${level}-${index}`}
                  key={entry.id}
                  onClick={() => {
                    if (entry.disabled) {
                      return;
                    }
                    if (entry.submenu) {
                      setPath(hoverMenuPath(entries, path, level, index));
                      return;
                    }
                    activate(entry);
                  }}
                  onPointerEnter={() =>
                    setPath(hoverMenuPath(entries, path, level, index))
                  }
                  role="menuitem"
                >
                  <span className="context-menu__label">{entry.label}</span>
                  {entry.shortcut ? (
                    <span className="context-menu__shortcut">
                      {entry.shortcut}
                    </span>
                  ) : null}
                  {entry.submenu ? (
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="context-menu__chevron"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
