import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { useRef, useState } from "react";
import type { ContextMenuEntry, ContextMenuItem } from "../../context-menu.ts";
import { useSheetPresence } from "../../hooks/useSheetPresence.ts";
import { MenuSheetFrame, navigateMenuSheet } from "./MenuSheetFrame.tsx";

type MenuSheetProps = {
  open: boolean;
  entries: ContextMenuEntry[];
  label: string;
  onClose: () => void;
};

// A menu as a bottom sheet with full-width rows, for touch: the same
// entries the right-click menu shows, with submenus opening in place
// behind a Back row.
export function MenuSheet({ open, ...props }: MenuSheetProps) {
  const presence = useSheetPresence(open);
  if (!presence.present) {
    return null;
  }
  return (
    <OpenMenuSheet {...props} closing={presence.closing} key={presence.key} />
  );
}

function OpenMenuSheet({
  entries,
  label,
  closing,
  onClose,
}: Omit<MenuSheetProps, "open"> & { closing: boolean }) {
  const [trail, setTrail] = useState<ContextMenuItem[]>([]);
  // Owners drop their entries once the menu closes; the sheet keeps
  // showing its rows as it slides away.
  const shownEntries = useRef(entries);
  if (!closing) {
    shownEntries.current = entries;
  }
  const parent = trail.at(-1);
  const level = parent?.submenu ?? shownEntries.current;

  function activate(item: ContextMenuItem) {
    if (item.disabled) {
      return;
    }
    if (item.submenu) {
      navigateMenuSheet("forward", () =>
        setTrail((current) => [...current, item]),
      );
      return;
    }
    onClose();
    item.onSelect?.();
  }

  return (
    <MenuSheetFrame
      closing={closing}
      label={label}
      levelKey={trail.map((item) => item.id).join("/")}
      onBack={() => setTrail((current) => current.slice(0, -1))}
      onClose={onClose}
      parentLabel={parent?.label}
    >
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
            <span className="mobile-menu-sheet__label">{entry.label}</span>
            {entry.shortcut ? (
              <span className="mobile-menu-sheet__shortcut">
                {entry.shortcut}
              </span>
            ) : null}
            {entry.submenu ? <ChevronRightIcon aria-hidden="true" /> : null}
          </button>
        ),
      )}
    </MenuSheetFrame>
  );
}
