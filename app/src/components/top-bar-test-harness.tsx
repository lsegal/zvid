// The desktop top bar as App renders it, for its component tests: real
// collaboration state, File and Edit menus, and an idle or sharing session.
import { useLayoutEffect } from "react";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import { EMPTY_COLLABORATION_DIAGNOSTICS } from "../collaboration-diagnostics.ts";
import { DesktopShell } from "../component-test/shells.tsx";
import { useCollaborationState } from "../hooks/useCollaboration.ts";
import { buildEditMenuEntries } from "../menus/edit-menu.ts";
import { buildHistoryEntries } from "../menus/entries/edit-history.ts";
import { TopBar } from "./TopBar";

const noop = () => {};

// A new session's Edit menu: Undo and Redo, Paste, and the Audio submenu.
function getEditMenuEntries() {
  const shortcuts = getShortcutLabels();
  return buildEditMenuEntries(
    buildHistoryEntries({
      undoLabel: undefined,
      redoLabel: undefined,
      canUndo: false,
      canRedo: false,
      shortcuts: { undo: shortcuts.undo, redo: shortcuts.redo },
      undo: noop,
      redo: noop,
    }),
    {
      clipEntries: [
        { type: "item", id: "paste", label: "Paste", disabled: true },
      ],
      audioEntries: [
        { type: "item", id: "audio-mute", label: "Mute Audio", onSelect: noop },
        {
          type: "item",
          id: "audio-normalize",
          label: "Normalize Audio",
          onSelect: noop,
        },
      ],
    },
  );
}

export const SHARE_URL =
  "https://zvid.app/?room=a1b2c3d4&password=b5c6d7e8f9a0&signal=wss%3A%2F%2Fsignal.zvid.app";

type TopBarHarnessProps = {
  // Hosting a share whose signaling server is up, waiting for a peer.
  sharing?: boolean;
};

export function TopBarHarness({ sharing = false }: TopBarHarnessProps) {
  const collaboration = useCollaborationState();
  const { setCollaborationMode, setCollaborationState, setShareUrl } =
    collaboration;
  useLayoutEffect(() => {
    if (!sharing) return;
    setCollaborationMode("sharing");
    setShareUrl(SHARE_URL);
    setCollaborationState((current) => ({
      ...current,
      connected: true,
      diagnostics: {
        ...EMPTY_COLLABORATION_DIAGNOSTICS,
        signaling: [{ url: "wss://signal.zvid.app", connected: true }],
      },
    }));
  }, [sharing, setCollaborationMode, setCollaborationState, setShareUrl]);

  return (
    <DesktopShell>
      <TopBar
        canStartNewSession
        collaboration={collaboration}
        exportButtonLabel="Export"
        getEditMenuEntries={getEditMenuEntries}
        handleDisconnectConnection={noop}
        handleImport={async () => {}}
        handleNewSession={noop}
        handleOpenSession={async () => {}}
        handleSaveToLibrary={async () => true}
        handleStopShare={() => setCollaborationMode("idle")}
        isExporting={false}
        offlineMedia={[]}
        openExportDialog={noop}
        renamingLaneIdRef={{ current: undefined }}
        sample={{ openSample: noop }}
        setIsCaptureInstallerDialogOpen={noop}
        setIsMediaStorageDialogOpen={noop}
        setIsMediaSyncDialogOpen={noop}
        setIsOfflineMediaDialogOpen={noop}
        setIsProjectExportDialogOpen={noop}
        setIsSessionSettingsOpen={noop}
        setStatus={noop}
        showShareCopiedBadge={() => collaboration.setHasCopiedShareInvite(true)}
        showsMediaSync={false}
      />
    </DesktopShell>
  );
}
