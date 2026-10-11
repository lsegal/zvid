import {
  ChevronLeftIcon,
  EllipsisHorizontalIcon,
} from "@heroicons/react/24/solid";
import { useState } from "react";
import type { ContextMenuEntry } from "../../context-menu.ts";
import type { PhoneExportSupport } from "../../hooks/usePhoneExportSupport.ts";
import { DesktopAppDialog } from "../DesktopAppDialog";
import { MenuSheet } from "./MenuSheet";
import {
  MobileShareButton,
  type MobileShareButtonProps,
} from "./MobileShareButton";

type MobileTopBarProps = {
  sessionName: string | null;
  exportSupport: PhoneExportSupport;
  isExporting: boolean;
  onOpenSessions: () => void;
  onExport: () => void;
  getMenuEntries: () => ContextMenuEntry[];
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  share: MobileShareButtonProps;
};

// The mobile shell's top bar: back to the session list, the session's
// name, Export (or, without an encoder a phone can export with, the
// desktop app), Share, and the overflow menu. Export and Share are
// labeled so neither reads as the other; the name ellipsizes first.
export function MobileTopBar({
  sessionName,
  exportSupport,
  isExporting,
  onOpenSessions,
  onExport,
  getMenuEntries,
  isMenuOpen,
  setIsMenuOpen,
  share,
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
      <button
        aria-label={exportLabel}
        className="mobile-topbar-pill mobile-export-button"
        data-export-support={exportSupport}
        disabled={exportSupport === "checking" || isExporting}
        onClick={() =>
          exportSupport === "supported" ? onExport() : setIsDesktopAppOpen(true)
        }
        title={exportLabel}
        type="button"
      >
        Export
      </button>
      <MobileShareButton {...share} />
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
