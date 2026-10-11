import { GlobeAltIcon } from "@heroicons/react/24/solid";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CollaborationStateResult,
  useCollaboration,
} from "../../hooks/useCollaboration.ts";
import {
  phoneShareButtonLabel,
  phoneShareSheetEntries,
} from "../../mobile/share-control.ts";
import { copyShareLink } from "../../share-link";
import { ShareLinkFallback } from "../ShareLinkButton";
import { MenuSheet } from "./MenuSheet";

export type MobileShareButtonProps = {
  collaboration: Pick<
    CollaborationStateResult,
    | "collaborationMode"
    | "collaborationView"
    | "hasCopiedShareInvite"
    | "isStartingShare"
    | "setIsDiagnosticsDialogOpen"
    | "setIsShareDialogOpen"
    | "shareUrl"
  >;
  sharing: Pick<
    ReturnType<typeof useCollaboration>,
    "handleDisconnectConnection" | "handleStopShare" | "showShareCopiedBadge"
  >;
};

// The phone top bar's Share control: Share opens the Share dialog, and
// while a share is live it shows the connection's state and opens a sheet
// with what the desktop top bar offers.
export function MobileShareButton({
  collaboration,
  sharing,
}: MobileShareButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isFallbackOpen, setIsFallbackOpen] = useState(false);
  const {
    collaborationMode: mode,
    collaborationView,
    shareUrl,
  } = collaboration;
  const state = {
    mode,
    isStartingShare: collaboration.isStartingShare,
    hasCopiedShareInvite: collaboration.hasCopiedShareInvite,
    shareUrl,
    stateLabel: collaborationView.stateLabel,
  };
  const label = phoneShareButtonLabel(state);
  const isLive = mode !== "idle" && !state.isStartingShare;

  async function copyLink() {
    if ((await copyShareLink(shareUrl)) === "copied") {
      sharing.showShareCopiedBadge();
      return;
    }
    // Without a clipboard, the URL is shown selected to copy by hand.
    setIsFallbackOpen(true);
  }

  return (
    <>
      <button
        aria-haspopup={isLive ? "menu" : undefined}
        aria-label={isLive ? `${label}: ${state.stateLabel}` : label}
        className={`mobile-topbar-pill mobile-share-button collaboration-status--${collaborationView.stateTone}`}
        data-collaboration-mode={mode}
        disabled={state.isStartingShare}
        onClick={() =>
          isLive
            ? setIsSheetOpen(true)
            : collaboration.setIsShareDialogOpen(true)
        }
        ref={buttonRef}
        type="button"
      >
        {isLive ? (
          <span aria-hidden="true" className="collaboration-status__dot" />
        ) : (
          <GlobeAltIcon aria-hidden="true" />
        )}
        <span>{label}</span>
      </button>
      <MenuSheet
        entries={
          isSheetOpen
            ? phoneShareSheetEntries(state, {
                copyLink: () => void copyLink(),
                showDiagnostics: () =>
                  collaboration.setIsDiagnosticsDialogOpen(true),
                stopShare: sharing.handleStopShare,
                disconnect: sharing.handleDisconnectConnection,
              })
            : []
        }
        label="Sharing"
        onClose={() => setIsSheetOpen(false)}
        open={isSheetOpen}
      />
      {isFallbackOpen && shareUrl && typeof document !== "undefined"
        ? createPortal(
            <ShareLinkFallback
              anchorRef={buttonRef}
              onClose={() => setIsFallbackOpen(false)}
              placement="below"
              url={shareUrl}
            />,
            document.body,
          )
        : null}
    </>
  );
}
