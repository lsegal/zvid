import { type KeyboardEvent, useCallback, useRef, useState } from "react";

// The menu Left/Right arrow keys move to from `id`, wrapping at the ends, or
// undefined for any other key.
export function menubarNeighbor<Id extends string>(
  ids: readonly Id[],
  id: Id,
  key: string,
): Id | undefined {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!step) return undefined;
  const index = ids.indexOf(id);
  return ids[(index + step + ids.length) % ids.length];
}

// Desktop menubar behavior for a row of Radix dropdown menus: one tab stop
// with Left/Right roving focus between the triggers, and, while any menu is
// open, hovering or arrowing to a neighbor switches to its menu. Spread
// `root`, `trigger` and `content` from `menu(id)` onto that menu's
// DropdownMenu, its trigger element and DropdownMenuContent.
export function useMenubar<Id extends string>(ids: readonly Id[]) {
  const [openMenu, setOpenMenu] = useState<Id | null>(null);
  const [tabStop, setTabStop] = useState<Id>(ids[0]);
  // Read by the close-focus and hover handlers, which run outside a render.
  const openMenuRef = useRef<Id | null>(null);
  const triggers = useRef(new Map<Id, HTMLElement>());

  const open = useCallback((id: Id | null) => {
    openMenuRef.current = id;
    setOpenMenu(id);
    if (id) setTabStop(id);
  }, []);

  return (id: Id) => ({
    root: {
      // Non-modal, like Radix Menubar, so the other triggers stay hoverable.
      modal: false,
      open: openMenu === id,
      onOpenChange: (isOpen: boolean) => {
        if (isOpen) open(id);
        else if (openMenuRef.current === id) open(null);
      },
    },
    trigger: {
      ref: (element: HTMLElement | null) => {
        if (element) triggers.current.set(id, element);
        else triggers.current.delete(id);
      },
      role: "menuitem",
      tabIndex: tabStop === id ? 0 : -1,
      onFocus: () => setTabStop(id),
      onPointerEnter: () => {
        if (openMenuRef.current && openMenuRef.current !== id) open(id);
      },
      onKeyDown: (event: KeyboardEvent) => {
        const next = menubarNeighbor(ids, id, event.key);
        if (!next) return;
        event.preventDefault();
        triggers.current.get(next)?.focus();
      },
    },
    content: {
      onKeyDown: (event: KeyboardEvent) => {
        // Submenu triggers and submenus claim their own arrow keys.
        if (event.defaultPrevented) return;
        const next = menubarNeighbor(ids, id, event.key);
        if (!next) return;
        event.preventDefault();
        open(next);
      },
      onCloseAutoFocus: (event: Event) => {
        // Switching menus keeps focus in the newly opened one.
        if (openMenuRef.current) event.preventDefault();
      },
    },
  });
}
