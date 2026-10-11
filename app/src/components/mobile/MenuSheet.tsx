import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuEntry, ContextMenuItem } from "../../context-menu.ts";
import "./mobile-shell.css";

type MenuSheetProps = {
  open: boolean;
  entries: ContextMenuEntry[];
  label: string;
  onClose: () => void;
};

// A menu as a bottom sheet with full-width rows, for touch: the same
// entries the right-click menu shows, with submenus opening in place
// behind a Back row.
export function MenuSheet({ open, entries, label, onClose }: MenuSheetProps) {
  if (!open || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <OpenMenuSheet entries={entries} label={label} onClose={onClose} />,
    document.body,
  );
}

function OpenMenuSheet({
  entries,
  label,
  onClose,
}: Omit<MenuSheetProps, "open">) {
  const [trail, setTrail] = useState<ContextMenuItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const parent = trail.at(-1);
  const level = parent?.submenu ?? entries;

  useEffect(() => {
    void trail;
    panelRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [trail]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function activate(item: ContextMenuItem) {
    if (item.disabled) {
      return;
    }
    if (item.submenu) {
      setTrail((current) => [...current, item]);
      return;
    }
    onClose();
    item.onSelect?.();
  }

  return (
    <div className="mobile-sheet-layer">
      <button
        aria-label="Close menu"
        className="mobile-sheet-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={parent?.label ?? label}
        className="mobile-sheet mobile-menu-sheet"
        ref={panelRef}
        role="menu"
      >
        <span aria-hidden="true" className="mobile-sheet__grabber" />
        {parent ? (
          <button
            className="mobile-menu-sheet__item mobile-menu-sheet__back"
            onClick={() => setTrail((current) => current.slice(0, -1))}
            role="menuitem"
            type="button"
          >
            <ChevronLeftIcon aria-hidden="true" />
            <span>{parent.label}</span>
          </button>
        ) : null}
        {level.map((entry, index) =>
          entry.type === "separator" ? (
            <hr
              className="mobile-menu-sheet__separator"
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no id and the list doesn't reorder
              key={`separator-${index}`}
            />
          ) : (
            <button
              aria-haspopup={entry.submenu ? "menu" : undefined}
              className="mobile-menu-sheet__item"
              disabled={entry.disabled}
              key={entry.id}
              onClick={() => activate(entry)}
              role="menuitem"
              title={entry.title}
              type="button"
            >
              {entry.swatch ? (
                <span
                  aria-hidden="true"
                  className="mobile-menu-sheet__swatch"
                  style={{ background: entry.swatch }}
                />
              ) : null}
              <span>{entry.label}</span>
              {entry.submenu ? <ChevronRightIcon aria-hidden="true" /> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
