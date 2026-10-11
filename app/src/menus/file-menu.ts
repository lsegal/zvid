// The File menu, built as context-menu entries so the desktop menubar and
// the phone's More sheet show the same items.
import type { Dispatch, SetStateAction } from "react";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { supportsHarnessCapability } from "../harness";

type SetOpen = Dispatch<SetStateAction<boolean>>;

export type FileMenuInputs = {
  canStartNewSession: boolean;
  handleNewSession: () => void;
  handleOpenSession: () => Promise<unknown>;
  sample: { handleOpenSample: () => void };
  handleImport: () => Promise<unknown>;
  offlineMedia: readonly unknown[];
  showsMediaSync: boolean;
  collaboration: {
    isConnectedClient: boolean;
    setIsConnectDialogOpen: (open: boolean) => void;
  };
  handleDisconnectConnection: () => void;
  handleSaveToLibrary: () => Promise<boolean>;
  isExporting: boolean;
  openExportDialog: () => void;
  setIsMediaStorageDialogOpen: SetOpen;
  setIsMediaSyncDialogOpen: SetOpen;
  setIsOfflineMediaDialogOpen: SetOpen;
  setIsProjectExportDialogOpen: SetOpen;
  setIsSessionSettingsOpen: SetOpen;
};

/**
 * New Session, Open, Import Media and the media and session settings, then
 * Connect to Share, then Save and Export.
 */
export function buildFileMenuEntries(
  inputs: FileMenuInputs,
): ContextMenuEntry[] {
  const { collaboration, offlineMedia } = inputs;
  const shortcuts = getShortcutLabels();
  return [
    {
      type: "item",
      id: "new-session",
      label: "New Session",
      // Browsers keep the shortcut for a new window.
      shortcut: supportsHarnessCapability("native-dialogs")
        ? shortcuts.newSession
        : undefined,
      disabled: !inputs.canStartNewSession,
      onSelect: inputs.handleNewSession,
    },
    {
      type: "item",
      id: "open",
      label: "Open",
      submenu: [
        {
          type: "item",
          id: "open-session",
          label: "Session…",
          onSelect: () => void inputs.handleOpenSession(),
        },
        {
          type: "item",
          id: "open-sample",
          label: "Sample",
          onSelect: inputs.sample.handleOpenSample,
        },
      ],
    },
    {
      type: "item",
      id: "import-media",
      label: "Import Media",
      onSelect: () => void inputs.handleImport(),
    },
    {
      type: "item",
      id: "offline-media",
      label: offlineMedia.length ? "Locate Offline Media…" : "All Media Linked",
      disabled: !offlineMedia.length,
      onSelect: () => inputs.setIsOfflineMediaDialogOpen(true),
    },
    {
      type: "item",
      id: "media-storage",
      label: "Media Storage…",
      onSelect: () => inputs.setIsMediaStorageDialogOpen(true),
    },
    {
      type: "item",
      id: "session-settings",
      label: "Session Settings…",
      onSelect: () => inputs.setIsSessionSettingsOpen(true),
    },
    ...(inputs.showsMediaSync
      ? [
          {
            type: "item",
            id: "media-sync",
            label: "Media Sync Status…",
            onSelect: () => inputs.setIsMediaSyncDialogOpen(true),
          } as const,
        ]
      : []),
    { type: "separator" },
    {
      type: "item",
      id: "connect",
      label: collaboration.isConnectedClient
        ? "Disconnect from Share"
        : "Connect to Share",
      onSelect: () => {
        if (collaboration.isConnectedClient) {
          inputs.handleDisconnectConnection();
          return;
        }
        collaboration.setIsConnectDialogOpen(true);
      },
    },
    { type: "separator" },
    {
      type: "item",
      id: "save",
      label: "Save",
      shortcut: shortcuts.save,
      onSelect: () => void inputs.handleSaveToLibrary(),
    },
    {
      type: "item",
      id: "export",
      label: "Export",
      submenu: [
        // Like the Export button, one export at a time.
        {
          type: "item",
          id: "export-video",
          label: "Video…",
          disabled: inputs.isExporting,
          onSelect: inputs.openExportDialog,
        },
        {
          type: "item",
          id: "export-project",
          label: "Project…",
          onSelect: () => inputs.setIsProjectExportDialogOpen(true),
        },
      ],
    },
  ];
}
