import {
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ChevronLeftIcon,
  EllipsisHorizontalIcon,
} from "@heroicons/react/24/solid";
import { useState } from "react";
import type { ContextMenuEntry } from "../../context-menu.ts";
import type { PhoneExportSupport } from "../../hooks/usePhoneExportSupport.ts";
import { DesktopAppDialog } from "../DesktopAppDialog";
import { MenuSheet } from "./MenuSheet";

type MobileTopBarProps = {
  sessionName: string | null;
  exportSupport: PhoneExportSupport;
  isExporting: boolean;
  onOpenSessions: () => void;
  onExport: () => void;
  getMenuEntries: () => ContextMenuEntry[];
  // Undo and Redo, as the Edit menu has them.
  historyEntries: ContextMenuEntry[];
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
};

// The mobile shell's top bar: back to the session list, the session's
// name, Undo and Redo, Export (or, without an encoder a phone can export
// with, the desktop app), and the overflow menu.
export function MobileTopBar({
  sessionName,
  exportSupport,
  isExporting,
  onOpenSessions,
  onExport,
  getMenuEntries,
  historyEntries,
  isMenuOpen,
  setIsMenuOpen,
}: MobileTopBarProps) {
  const [isDesktopAppOpen, setIsDesktopAppOpen] = useState(false);
  const exportLabel =
    exportSupport === "unsupported"
      ? "Export needs the desktop app"
      : isExporting
        ? "Exporting"
        : "Export";

  return (
    <header className="mobile-topbar">
      <button
        aria-label="Sessions"
        className="mobile-icon-button"
        onClick={onOpenSessions}
        type="button"
      >
        <ChevronLeftIcon aria-hidden="true" />
      </button>
      <h1 className="mobile-topbar__title">{sessionName || "Untitled"}</h1>
      {historyEntries.map((entry) =>
        entry.type === "item" ? (
          <button
            aria-label={entry.label}
            className="mobile-icon-button"
            disabled={entry.disabled}
            key={entry.id}
            onClick={entry.onSelect}
            title={entry.label}
            type="button"
          >
            {entry.id === "undo" ? (
              <ArrowUturnLeftIcon aria-hidden="true" />
            ) : (
              <ArrowUturnRightIcon aria-hidden="true" />
            )}
          </button>
        ) : null,
      )}
      <button
        aria-label={exportLabel}
        className="mobile-icon-button"
        data-export-support={exportSupport}
        disabled={exportSupport === "checking" || isExporting}
        onClick={() =>
          exportSupport === "supported" ? onExport() : setIsDesktopAppOpen(true)
        }
        title={exportLabel}
        type="button"
      >
        <ArrowUpTrayIcon aria-hidden="true" />
      </button>
      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label="More"
        className="mobile-icon-button"
        onClick={() => setIsMenuOpen(true)}
        type="button"
      >
        <EllipsisHorizontalIcon aria-hidden="true" />
      </button>
      <MenuSheet
        entries={isMenuOpen ? getMenuEntries() : []}
        label="More"
        onClose={() => setIsMenuOpen(false)}
        open={isMenuOpen}
      />
      <DesktopAppDialog
        onOpenChange={setIsDesktopAppOpen}
        open={isDesktopAppOpen}
      />
    </header>
  );
}
