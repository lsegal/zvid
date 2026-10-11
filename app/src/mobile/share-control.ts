// The phone top bar's Share control (components/mobile/MobileShareButton):
// what it says in each collaboration mode and what its sheet offers while a
// share is live. Kept free of React so it can be unit tested directly.
import type { CollaborationMode } from "../app/types.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { shareLinkVisible } from "../share-link.ts";

export type PhoneShareState = {
  mode: CollaborationMode;
  isStartingShare: boolean;
  hasCopiedShareInvite: boolean;
  shareUrl: string;
  // The desktop top bar's connection status, such as "1 peer connected".
  stateLabel: string;
};

export type PhoneShareActions = {
  copyLink: () => void;
  showDiagnostics: () => void;
  stopShare: () => void;
  disconnect: () => void;
};

// Short enough for a 375px top bar; the full status is in the sheet.
export function phoneShareButtonLabel(state: PhoneShareState) {
  if (state.isStartingShare) {
    return "Sharing…";
  }
  if (state.mode === "connected") {
    return "Joined";
  }
  if (state.mode === "sharing") {
    return state.hasCopiedShareInvite ? "Copied" : "Sharing";
  }
  return "Share";
}

// While sharing or joined: the connection status, then what the desktop
// top bar offers (copy the invite, diagnostics, and Stop Share or
// Disconnect).
export function phoneShareSheetEntries(
  state: PhoneShareState,
  actions: PhoneShareActions,
): ContextMenuEntry[] {
  const status: ContextMenuEntry = {
    type: "item",
    id: "status",
    label: state.stateLabel,
    disabled: true,
  };
  const diagnostics: ContextMenuEntry = {
    type: "item",
    id: "diagnostics",
    label: "Connection Details…",
    onSelect: actions.showDiagnostics,
  };
  if (state.mode === "connected") {
    return [
      status,
      diagnostics,
      { type: "separator" },
      {
        type: "item",
        id: "disconnect",
        label: "Disconnect from Share",
        onSelect: actions.disconnect,
      },
    ];
  }
  return [
    status,
    {
      type: "item",
      id: "copy-link",
      label: "Copy Invite Link",
      disabled: !shareLinkVisible(state.mode, state.shareUrl),
      onSelect: actions.copyLink,
    },
    diagnostics,
    { type: "separator" },
    {
      type: "item",
      id: "stop",
      label: "Stop Sharing",
      onSelect: actions.stopShare,
    },
  ];
}
