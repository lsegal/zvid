import type { Dispatch, SetStateAction } from "react";
import type { ProjectState } from "../app/types.ts";
import { getHarness } from "../harness";
import type {
  CollaborationStateResult,
  useCollaboration,
} from "../hooks/useCollaboration.ts";
import type { useExport } from "../hooks/useExport.ts";
import type { useMediaHydration } from "../hooks/useMediaHydration.ts";
import type {
  useMediaLibrary,
  useMediaLibraryCommands,
} from "../hooks/useMediaLibrary.ts";
import type { useMediaStatus } from "../hooks/useMediaStatus.ts";
import type { usePeerMedia } from "../hooks/usePeerMedia.ts";
import type { useProjectStore } from "../hooks/useProjectStore.ts";
import type { useWorkspacePersistence } from "../hooks/useWorkspacePersistence.ts";
import {
  applySessionSettings,
  sessionSettingsFromProject,
} from "../session-settings.ts";
import { CaptureInstallerDialog } from "./CaptureInstallerDialog";
import { CollaborationDetailCard } from "./CollaborationDetailCard";
import { DesktopAppDialog } from "./DesktopAppDialog";
import { ExportDialog } from "./ExportDialog";
import { ImportNotice, type ImportNoticeContent } from "./ImportNotice";
import { MediaStorageDialog } from "./MediaStorageDialog";
import { MediaSyncDialog, type MediaSyncPeer } from "./MediaSyncDialog";
import { OfflineMediaDialog } from "./OfflineMediaDialog";
import { SessionSettingsDialog } from "./SessionSettingsDialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import "./app-dialogs.css";

type SetOpen = Dispatch<SetStateAction<boolean>>;
type ProjectStore = ReturnType<typeof useProjectStore>;

export type AppDialogsProps = Pick<
  ReturnType<typeof useCollaboration>,
  "handleConnectToShare" | "handleStartShare"
> &
  Pick<ReturnType<typeof useExport>, "exportDialog"> &
  Pick<
    ReturnType<typeof useMediaLibrary>,
    "handleMediaStorageCleared" | "mediaItemsById"
  > &
  Pick<
    ReturnType<typeof useMediaLibraryCommands>,
    "relinkOfflineMedia" | "relinkOfflineMediaItem" | "relinkingMediaIds"
  > &
  Pick<
    ReturnType<typeof useMediaStatus>,
    "mediaSyncEntries" | "mediaSyncSummary" | "offlineMedia"
  > &
  Pick<ReturnType<typeof usePeerMedia>, "retryPeerMedia"> &
  Pick<ReturnType<typeof useMediaHydration>, "retrySampleMedia"> &
  Pick<
    ProjectStore,
    | "isTakeOverPromptOpen"
    | "isWorkspaceReadOnly"
    | "projectHistory"
    | "setIsTakeOverPromptOpen"
    | "workspaceAccess"
  > &
  Pick<
    ReturnType<typeof useWorkspacePersistence>,
    "handleOpenWorkspaceReadOnly" | "handleTakeOverWorkspace"
  > & {
    collaboration: CollaborationStateResult;
    commitProjectChange: (
      label: string,
      updater: (current: ProjectState) => ProjectState,
    ) => void;
    importNotice: ImportNoticeContent | null;
    isCaptureInstallerDialogOpen: boolean;
    isDesktopAppDialogOpen: boolean;
    isMediaStorageDialogOpen: boolean;
    isMediaSyncDialogOpen: boolean;
    isOfflineMediaDialogOpen: boolean;
    isSessionSettingsOpen: boolean;
    mediaSyncPeer: MediaSyncPeer | undefined;
    setImportNotice: Dispatch<SetStateAction<ImportNoticeContent | null>>;
    setIsCaptureInstallerDialogOpen: SetOpen;
    setIsDesktopAppDialogOpen: SetOpen;
    setIsMediaStorageDialogOpen: SetOpen;
    setIsMediaSyncDialogOpen: SetOpen;
    setIsOfflineMediaDialogOpen: SetOpen;
    setIsSessionSettingsOpen: SetOpen;
  };

// The app's dialogs (share, connect, diagnostics, offline media, media sync,
// media storage, session settings, export, capture installer, desktop app
// download and the
// workspace lock prompts), plus the workspace lock banner and the import
// notice.
export function AppDialogs({
  collaboration,
  commitProjectChange,
  exportDialog,
  handleConnectToShare,
  handleMediaStorageCleared,
  handleOpenWorkspaceReadOnly,
  handleStartShare,
  handleTakeOverWorkspace,
  importNotice,
  isCaptureInstallerDialogOpen,
  isDesktopAppDialogOpen,
  isMediaStorageDialogOpen,
  isMediaSyncDialogOpen,
  isOfflineMediaDialogOpen,
  isSessionSettingsOpen,
  isTakeOverPromptOpen,
  isWorkspaceReadOnly,
  mediaItemsById,
  mediaSyncEntries,
  mediaSyncPeer,
  mediaSyncSummary,
  offlineMedia,
  projectHistory,
  relinkOfflineMedia,
  relinkOfflineMediaItem,
  relinkingMediaIds,
  retryPeerMedia,
  retrySampleMedia,
  setImportNotice,
  setIsCaptureInstallerDialogOpen,
  setIsDesktopAppDialogOpen,
  setIsMediaStorageDialogOpen,
  setIsMediaSyncDialogOpen,
  setIsOfflineMediaDialogOpen,
  setIsSessionSettingsOpen,
  setIsTakeOverPromptOpen,
  workspaceAccess,
}: AppDialogsProps) {
  const {
    activeShareRoom,
    collaborationMode,
    collaborationView,
    connectInviteValue,
    isConnectDialogOpen,
    isDiagnosticsDialogOpen,
    isShareDialogOpen,
    isStartingConnect,
    isStartingShare,
    setConnectInviteValue,
    setIsConnectDialogOpen,
    setIsDiagnosticsDialogOpen,
    setIsShareDialogOpen,
  } = collaboration;

  return (
    <>
      <CaptureInstallerDialog
        open={isCaptureInstallerDialogOpen}
        onOpenChange={setIsCaptureInstallerDialogOpen}
      />

      <DesktopAppDialog
        open={isDesktopAppDialogOpen}
        onOpenChange={setIsDesktopAppDialogOpen}
      />

      <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this session publicly?</DialogTitle>
            <DialogDescription>
              This will start the collaboration websocket, generate a public
              room, and copy a shareable address to your clipboard. Click Stop
              Share any time to disconnect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog__body">
            <CollaborationDetailCard
              label="Room"
              value={collaborationView.pendingShareRoom}
            />
            <CollaborationDetailCard
              label="Signal"
              value={collaborationView.signalingLabel}
            />
            <CollaborationDetailCard
              label="Connection"
              value={collaborationView.stateLabel}
              meta={collaborationView.remoteCollaboratorNames || undefined}
            />
            <p className="share-dialog__note">
              The invite links to this app's address and copies automatically.
              Any room password travels in the link's fragment, which is never
              sent to servers.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                className="ghost-button"
                disabled={isStartingShare}
                type="button"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button ghost-button--accent"
              disabled={isStartingShare}
              onClick={handleStartShare}
              type="button"
            >
              {isStartingShare ? "Starting..." : "Start Sharing"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDiagnosticsDialogOpen && collaborationMode !== "idle"}
        onOpenChange={setIsDiagnosticsDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connection diagnostics</DialogTitle>
            <DialogDescription>
              {collaborationMode === "sharing" ? "Sharing" : "Joined"} room{" "}
              {activeShareRoom}. Peers find each other through the signaling
              servers, then connect directly over WebRTC.
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog__body">
            <CollaborationDetailCard
              label="Connection"
              value={collaborationView.stateLabel}
              meta={collaborationView.remoteCollaboratorNames || undefined}
            />
            <dl className="collaboration-diagnostics">
              {collaborationView.diagnosticsRows.map((row) => (
                <div
                  className={`collaboration-diagnostics__row${row.tone ? ` collaboration-diagnostics__row--${row.tone}` : ""}`}
                  key={row.label}
                >
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="share-dialog__note">
              Tabs of the same browser sync without WebRTC, so test with two
              different browsers or machines. Peers behind strict NATs connect
              through the TURN relay, which the deployed app provides.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button className="ghost-button" type="button">
                Close
              </button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OfflineMediaDialog
        canLocateFolder={Boolean(getHarness().pickMediaFolder)}
        mediaItemsById={mediaItemsById}
        offlineMedia={offlineMedia}
        onOpenChange={setIsOfflineMediaDialogOpen}
        open={isOfflineMediaDialogOpen}
        relinkMedia={relinkOfflineMedia}
        relinkMediaItem={relinkOfflineMediaItem}
        relinkingIds={relinkingMediaIds}
      />

      <MediaStorageDialog
        onCleared={handleMediaStorageCleared}
        onOpenChange={setIsMediaStorageDialogOpen}
        open={isMediaStorageDialogOpen}
      />

      <SessionSettingsDialog
        onApply={(settings) =>
          commitProjectChange("Session Settings", (current) =>
            applySessionSettings(current, settings),
          )
        }
        onOpenChange={setIsSessionSettingsOpen}
        open={isSessionSettingsOpen}
        settings={sessionSettingsFromProject(projectHistory.present)}
      />

      <ExportDialog model={exportDialog} />

      <MediaSyncDialog
        entries={mediaSyncEntries}
        onOpenChange={setIsMediaSyncDialogOpen}
        open={isMediaSyncDialogOpen}
        peer={mediaSyncPeer}
        relinkMediaItem={relinkOfflineMediaItem}
        relinkingIds={relinkingMediaIds}
        retryMedia={(mediaId) => {
          retrySampleMedia(mediaId);
          retryPeerMedia(mediaId);
        }}
        summary={mediaSyncSummary}
      />

      <Dialog open={workspaceAccess === "blocked"}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This session is open in another tab</DialogTitle>
            <DialogDescription>
              Only one tab saves the session. Take over to continue here with
              the latest saved session, or open it read-only so changes in this
              tab are not saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="ghost-button"
              onClick={handleOpenWorkspaceReadOnly}
              type="button"
            >
              Open read-only
            </button>
            <button
              className="ghost-button ghost-button--accent"
              onClick={() => void handleTakeOverWorkspace()}
              type="button"
            >
              Take over
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isTakeOverPromptOpen && isWorkspaceReadOnly}
        onOpenChange={setIsTakeOverPromptOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This tab is read-only</DialogTitle>
            <DialogDescription>
              {workspaceAccess === "taken-over"
                ? "This session was taken over in another tab,"
                : "This session is open in another tab,"}{" "}
              so edits here would not be saved. Take over to edit in this tab,
              starting from the latest saved session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="ghost-button"
              onClick={() => setIsTakeOverPromptOpen(false)}
              type="button"
            >
              Stay read-only
            </button>
            <button
              className="ghost-button ghost-button--accent"
              onClick={() => void handleTakeOverWorkspace()}
              type="button"
            >
              Take over
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect to a shared session</DialogTitle>
            <DialogDescription>
              Paste the invite copied from Share. The room, signaling server,
              and optional password will be pulled from that URL and the
              collaboration websocket will connect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog__body">
            <label className="connect-dialog__field">
              <span className="share-dialog__label">Shared invite</span>
              <textarea
                className="connect-dialog__input"
                onChange={(event) => setConnectInviteValue(event.target.value)}
                placeholder="http://public-ip:1420/?room=...&signal=wss://y-webrtc-eu.fly.dev"
                rows={4}
                value={connectInviteValue}
              />
            </label>
            <CollaborationDetailCard
              label="Connection"
              value={collaborationView.stateLabel}
              meta={collaborationView.remoteCollaboratorNames || undefined}
            />
            <p className="share-dialog__note">
              If the host shared from this app, just paste the copied invite URL
              here and press Connect.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                className="ghost-button"
                disabled={isStartingConnect}
                type="button"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button ghost-button--accent"
              disabled={isStartingConnect}
              onClick={handleConnectToShare}
              type="button"
            >
              {isStartingConnect ? "Connecting..." : "Connect"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {workspaceAccess === "read-only" || workspaceAccess === "taken-over" ? (
        <output className="workspace-lock-banner">
          <span>
            {workspaceAccess === "taken-over"
              ? "This session was taken over in another tab."
              : "This session is open in another tab."}{" "}
            Changes here are not saved.
          </span>
          <button
            className="ghost-button ghost-button--accent"
            onClick={() => void handleTakeOverWorkspace()}
            type="button"
          >
            Take over
          </button>
        </output>
      ) : null}
      {importNotice ? (
        <ImportNotice
          notice={importNotice}
          onDismiss={() => setImportNotice(null)}
        />
      ) : null}
    </>
  );
}
