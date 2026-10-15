// The File menu, built as context-menu entries so the desktop menubar and
// the phone's More sheet show the same items.
import type { Dispatch, SetStateAction } from "react";
import type { ContextMenuEntry } from "../context-menu.ts";
import { SAMPLE_CHOICES, type SampleId } from "../sample/samples.ts";
import { type Theme, themeMenuItem } from "../theme.ts";

type SetOpen = Dispatch<SetStateAction<boolean>>;

export type FileMenuInputs = {
  canStartNewSession: boolean;
  handleNewSession: () => void;
  handleOpenSession: () => Promise<unknown>;
  sample: { openSample: (id: SampleId) => void };
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

// The app-wide theme, switched from the File menu since it isn't a session
// setting (#1488).
export type ThemeMenuInputs = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

/**
 * New Session, Open, Import Media, the media and session settings and the
 * theme, then Connect to Share, then Save and Export. `shortcuts` are the
 * ones to show, if any.
 */
export function buildFileMenuEntries(
  inputs: FileMenuInputs & ThemeMenuInputs,
  shortcuts: { newSession?: string; save?: string } = {},
): ContextMenuEntry[] {
  const { collaboration, offlineMedia } = inputs;
  return [
    {
      type: "item",
      id: "new-session",
      label: "New Session",
      shortcut: shortcuts.newSession,
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
          id: "open-samples",
          label: "Samples",
          submenu: SAMPLE_CHOICES.map(({ id, label }) => ({
            type: "item",
            id: `open-sample-${id}`,
            label,
            onSelect: () => inputs.sample.openSample(id),
          })),
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
    themeMenuItem(inputs.theme, inputs.setTheme),
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
