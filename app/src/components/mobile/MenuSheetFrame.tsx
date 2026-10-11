import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import { menuSheetClosesAfterDrag } from "../../app/sheet-drag.ts";
import { useSheetDrag } from "../../hooks/useSheetDrag.ts";
import { prefersReducedMotion } from "../../hooks/useSheetPresence.ts";
import "./mobile-shell.css";
import "./mobile-sheet-motion.css";

type MenuSheetFrameProps = {
  label: string;
  // The open submenu's name, shown in a Back row above its items; absent at
  // the top level.
  parentLabel?: string;
  // Changes whenever another level shows, to focus its first item.
  levelKey: string;
  // Sliding away after it closed: it takes no taps, focus or Escape.
  closing?: boolean;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
};

// The bottom sheet every phone menu opens in: a backdrop and a grabber
// that close it, Escape, and a Back row while a submenu shows in place.
// It slides up as it opens and back down as it closes (the owner keeps it
// mounted with `closing` meanwhile, see useSheetPresence).
// Both the right-click menus (MenuSheet) and the dropdown menus
// (ui/phone-dropdown-menu.tsx) render their rows inside it.
export function MenuSheetFrame(props: MenuSheetFrameProps) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(<OpenMenuSheetFrame {...props} />, document.body);
}

let levelTransition: ViewTransition | null = null;

// Moves a menu sheet to a submenu (forward) or back to its parent, sliding
// the old level out and the new one in (the view transition styled in
// mobile-shell.css) while the sheet's height follows. Without view
// transitions, or with reduced motion, the level just changes.
export function navigateMenuSheet(
  direction: "forward" | "back",
  update: () => void,
) {
  const root = document.documentElement;
  if (!document.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  root.dataset.menuSheetNav = direction;
  const transition = document.startViewTransition(() => flushSync(update));
  levelTransition = transition;
  void transition.finished.finally(() => {
    if (levelTransition === transition) {
      levelTransition = null;
      delete root.dataset.menuSheetNav;
    }
  });
}

function OpenMenuSheetFrame({
  label,
  parentLabel,
  levelKey,
  closing = false,
  onBack,
  onClose,
  children,
}: MenuSheetFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Dragging the grabber down pulls the sheet with it and, far enough,
  // dismisses it, sliding on down from where it was let go.
  const drag = useSheetDrag({
    onMove(dy) {
      const panel = panelRef.current;
      if (panel) {
        panel.style.transition = "none";
        panel.style.transform = `translateY(${Math.max(dy, 0)}px)`;
      }
    },
    onRelease(dy) {
      const panel = panelRef.current;
      if (menuSheetClosesAfterDrag(dy)) {
        onClose();
      } else if (panel) {
        panel.style.transition = "";
        panel.style.transform = "";
      }
    },
  });

  useEffect(() => {
    void levelKey;
    const body = bodyRef.current;
    body?.scrollTo?.({ top: 0 });
    body
      ?.querySelector<HTMLButtonElement>(
        "button:not(:disabled):not([hidden] *)",
      )
      ?.focus({ preventScroll: true });
  }, [levelKey]);

  useEffect(() => {
    if (closing) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [closing]);

  return (
    <div
      aria-hidden={closing || undefined}
      className={[
        "mobile-sheet-layer mobile-menu-sheet-layer",
        closing ? "is-closing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      inert={closing}
    >
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
        <div className="mobile-menu-sheet__body" ref={bodyRef}>
          {parentLabel !== undefined ? (
            <button
              className="mobile-menu-sheet__item mobile-menu-sheet__back"
              onClick={() => navigateMenuSheet("back", onBack)}
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
    </div>
  );
}
