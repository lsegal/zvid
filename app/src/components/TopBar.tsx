import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ProjectState } from "../app/types.ts";
import { isPristineProjectHistory } from "../app/workspace-boot.ts";
import type { ContextMenuEntry } from "../context-menu.ts";
import { supportsHarnessCapability } from "../harness";
import type {
  CollaborationStateResult,
  useCollaboration,
} from "../hooks/useCollaboration.ts";
import type { useMediaStatus } from "../hooks/useMediaStatus.ts";
import type { useProjectStore } from "../hooks/useProjectStore.ts";
import type { useSampleProject } from "../hooks/useSampleProject.tsx";
import type { useSessionIO } from "../hooks/useSessionIO.ts";
import { shareLinkVisible } from "../share-link";
import { APP_BUILD_LABEL, BrandMark, openBuildCommit } from "./BrandMark";
import { DropdownMenuEntries } from "./DropdownMenuEntries";
import { MenuChevron } from "./MenuChevron";
import { ShareLinkIconButton } from "./ShareLinkButton";
import { TempoPill } from "./TempoPill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type CollaborationActions = ReturnType<typeof useCollaboration>;
type SessionIO = ReturnType<typeof useSessionIO>;
type SetOpen = Dispatch<SetStateAction<boolean>>;

export type TopBarProps = Pick<
  CollaborationActions,
  "handleDisconnectConnection" | "handleStopShare" | "showShareCopiedBadge"
> &
  Pick<
    SessionIO,
    | "handleImport"
    | "handleOpenSession"
    | "handleOpenWorkspace"
    | "handleSaveSession"
  > &
  Pick<
    ReturnType<typeof useMediaStatus>,
    "inSharedMediaSession" | "offlineMedia"
  > & {
    bpm: number;
    collaboration: CollaborationStateResult;
    commitProjectChange: (
      label: string,
      updater: (current: ProjectState) => ProjectState,
    ) => void;
    exportButtonLabel: string;
    getEditMenuEntries: () => ContextMenuEntry[];
    handleCloseSession: () => void;
    isExporting: boolean;
    openExportDialog: () => void;
    projectHistory: ReturnType<typeof useProjectStore>["projectHistory"];
    renamingLaneIdRef: RefObject<string | undefined>;
    sample: Pick<ReturnType<typeof useSampleProject>, "handleOpenSample">;
    setIsCaptureInstallerDialogOpen: SetOpen;
    setIsMediaStorageDialogOpen: SetOpen;
    setIsMediaSyncDialogOpen: SetOpen;
    setIsOfflineMediaDialogOpen: SetOpen;
    setIsSessionSettingsOpen: SetOpen;
    setStatus: (message: string) => void;
  };

// The app's top bar: the brand mark, the File, Edit and Help menus, the
// tempo, and the export, collaboration status and share controls.
export function TopBar({
  bpm,
  collaboration,
  commitProjectChange,
  exportButtonLabel,
  getEditMenuEntries,
  handleCloseSession,
  handleDisconnectConnection,
  handleImport,
  handleOpenSession,
  handleOpenWorkspace,
  handleSaveSession,
  handleStopShare,
  inSharedMediaSession,
  isExporting,
  offlineMedia,
  openExportDialog,
  projectHistory,
  renamingLaneIdRef,
  sample,
  setIsCaptureInstallerDialogOpen,
  setIsMediaStorageDialogOpen,
  setIsMediaSyncDialogOpen,
  setIsOfflineMediaDialogOpen,
  setIsSessionSettingsOpen,
  setStatus,
  showShareCopiedBadge,
}: TopBarProps) {
  const {
    collaborationMode,
    collaborationView,
    hasCopiedShareInvite,
    isConnectedClient,
    isSharing,
    isStartingShare,
    setIsConnectDialogOpen,
    setIsDiagnosticsDialogOpen,
    setIsShareDialogOpen,
    shareUrl,
  } = collaboration;

  return (
    <header className="topbar">
      <div className="topbar__group">
        <BrandMark onStatus={setStatus} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ghost-button file-menu-button" type="button">
              <span>File</span>
              <MenuChevron />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => void handleOpenSession()}>
              Open Session
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleOpenWorkspace()}>
              Open Workspace
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={sample.handleOpenSample}>
              Open Sample
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleImport()}>
              Import Media
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                collaborationMode !== "idle" ||
                isPristineProjectHistory(projectHistory)
              }
              onSelect={handleCloseSession}
            >
              Close Session
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!offlineMedia.length}
              onSelect={() => setIsOfflineMediaDialogOpen(true)}
            >
              {offlineMedia.length
                ? "Locate Offline Media…"
                : "All Media Linked"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setIsMediaStorageDialogOpen(true)}
            >
              Media Storage…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsSessionSettingsOpen(true)}>
              Session Settings…
            </DropdownMenuItem>
            {inSharedMediaSession ? (
              <DropdownMenuItem onSelect={() => setIsMediaSyncDialogOpen(true)}>
                Media Sync Status…
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (isConnectedClient) {
                  handleDisconnectConnection();
                  return;
                }

                setIsConnectDialogOpen(true);
              }}
            >
              {isConnectedClient ? "Disconnect from Share" : "Connect to Share"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void handleSaveSession();
              }}
            >
              Save
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ghost-button file-menu-button" type="button">
              <span>Edit</span>
              <MenuChevron />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onCloseAutoFocus={(event) => {
              // Leave focus on the layer name field Rename… opened.
              if (renamingLaneIdRef.current) {
                event.preventDefault();
              }
            }}
          >
            <DropdownMenuEntries entries={getEditMenuEntries()} />
          </DropdownMenuContent>
        </DropdownMenu>
        <TempoPill bpm={bpm} commitProjectChange={commitProjectChange} />
      </div>

      <div className="topbar__group topbar__group--right">
        <button
          className="ghost-button"
          disabled={isExporting}
          onClick={openExportDialog}
          type="button"
        >
          {exportButtonLabel}
        </button>
        {collaborationMode === "idle" ? (
          <span
            className={`collaboration-status collaboration-status--${collaborationView.stateTone}`}
            aria-live="polite"
          >
            <span className="collaboration-status__dot" aria-hidden="true" />
            {collaborationView.stateLabel}
          </span>
        ) : (
          <button
            className={`collaboration-status collaboration-status--${collaborationView.stateTone} collaboration-status--button`}
            aria-live="polite"
            onClick={() => setIsDiagnosticsDialogOpen(true)}
            title="Show connection diagnostics"
            type="button"
          >
            <span className="collaboration-status__dot" aria-hidden="true" />
            {collaborationView.stateLabel}
          </button>
        )}
        <button
          className={`ghost-button share-button ${isSharing ? "is-sharing" : ""}`}
          disabled={isExporting || isStartingShare || isConnectedClient}
          onClick={() => {
            if (isSharing) {
              handleStopShare();
              return;
            }

            setIsShareDialogOpen(true);
          }}
          type="button"
        >
          <span className="share-button__icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" role="presentation">
              <path
                d="M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm4.82 5.75H10.9a12 12 0 0 0-.62-3.11a5.03 5.03 0 0 1 2.54 3.11ZM8 2.47c.36 0 1.14 1.02 1.45 3.28h-2.9C6.86 3.49 7.64 2.47 8 2.47ZM5.72 4.14a12 12 0 0 0-.62 3.11H3.18a5.03 5.03 0 0 1 2.54-3.11Zm-2.54 4.61H5.1c.08 1.13.29 2.19.62 3.11a5.03 5.03 0 0 1-2.54-3.11ZM8 13.53c-.36 0-1.14-1.02-1.45-3.28h2.9C9.14 12.51 8.36 13.53 8 13.53Zm1.62-4.78H6.38a10.7 10.7 0 0 1 0-1.5h3.24c.06.5.06 1 0 1.5Zm.66 3.11c.33-.92.54-1.98.62-3.11h1.92a5.03 5.03 0 0 1-2.54 3.11Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span>
            {isSharing
              ? "Stop Share"
              : isStartingShare
                ? "Sharing..."
                : "Share"}
          </span>
        </button>
        {shareLinkVisible(collaborationMode, shareUrl) ? (
          <ShareLinkIconButton
            key={shareUrl}
            onCopied={showShareCopiedBadge}
            url={shareUrl}
          />
        ) : null}
        {hasCopiedShareInvite ? (
          <span
            className="share-copy-badge"
            aria-live="polite"
            title={shareUrl}
          >
            <svg viewBox="0 0 20 20" role="presentation" aria-hidden="true">
              <path
                d="M10 1.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17Zm3.57 6.2l-4.2 5.1a.75.75 0 0 1-1.12.06l-1.82-1.82a.75.75 0 1 1 1.06-1.06l1.24 1.24l3.62-4.4a.75.75 0 0 1 1.22.88Z"
                fill="currentColor"
              />
            </svg>
            <span>Copied</span>
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ghost-button" type="button">
              Help
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                setStatus(
                  "Use File → Open Session to open a .lvp session or an Ableton .als set, or File → Import Media to add clips.",
                )
              }
            >
              Getting Started
            </DropdownMenuItem>
            {/* The desktop app has no downloads to offer. */}
            {supportsHarnessCapability("native-dialogs") ? null : (
              <DropdownMenuItem
                onSelect={() => setIsCaptureInstallerDialogOpen(true)}
              >
                Install Capture Plugin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="help-menu__build"
              onSelect={() => void openBuildCommit().then(setStatus)}
            >
              {APP_BUILD_LABEL}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
