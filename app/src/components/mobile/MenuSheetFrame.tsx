import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { menuSheetClosesAfterDrag } from "../../app/sheet-drag.ts";
import { useSheetDrag } from "../../hooks/useSheetDrag.ts";
import "./mobile-shell.css";

type MenuSheetFrameProps = {
  label: string;
  // The open submenu's name, shown in a Back row above its items; absent at
  // the top level.
  parentLabel?: string;
  // Changes whenever another level shows, to focus its first item.
  levelKey: string;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
};

// The bottom sheet every phone menu opens in: a backdrop and a grabber
// that close it, Escape, and a Back row while a submenu shows in place.
// Both the right-click menus (MenuSheet) and the dropdown menus
// (ui/phone-dropdown-menu.tsx) render their rows inside it.
export function MenuSheetFrame(props: MenuSheetFrameProps) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(<OpenMenuSheetFrame {...props} />, document.body);
}

function OpenMenuSheetFrame({
  label,
  parentLabel,
  levelKey,
  onBack,
  onClose,
  children,
}: MenuSheetFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Dragging the grabber down pulls the sheet with it and, far enough,
  // dismisses it.
  const drag = useSheetDrag({
    onMove(dy) {
      if (panelRef.current) {
        panelRef.current.style.transform = `translateY(${Math.max(dy, 0)}px)`;
      }
    },
    onRelease(dy) {
      if (panelRef.current) {
        panelRef.current.style.transform = "";
      }
      if (menuSheetClosesAfterDrag(dy)) {
        onClose();
      }
    },
  });

  useEffect(() => {
    void levelKey;
    const panel = panelRef.current;
    panel?.scrollTo?.({ top: 0 });
    panel
      ?.querySelector<HTMLButtonElement>(
        "button:not(:disabled):not([hidden] *)",
      )
      ?.focus({ preventScroll: true });
  }, [levelKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return (
    <div className="mobile-sheet-layer mobile-menu-sheet-layer">
      <button
        aria-label="Close menu"
        className="mobile-sheet-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={parentLabel ?? label}
        className="mobile-sheet mobile-menu-sheet"
        ref={panelRef}
        role="menu"
      >
        <div aria-hidden="true" className="mobile-sheet__handle" {...drag}>
          <span className="mobile-sheet__grabber" />
        </div>
        {parentLabel !== undefined ? (
          <button
            className="mobile-menu-sheet__item mobile-menu-sheet__back"
            onClick={onBack}
            role="menuitem"
            type="button"
          >
            <ChevronLeftIcon aria-hidden="true" />
            <span className="mobile-menu-sheet__label">{parentLabel}</span>
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
