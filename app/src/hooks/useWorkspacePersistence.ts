import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatSessionMediaCheckStatus } from "../app/format.ts";
import {
  createNewSessionHistory,
  isPristineProjectHistory,
} from "../app/new-session.ts";
import {
  type SourceSelection,
  toSourceSelectionView,
} from "../app/source-selection.ts";
import type {
  ArrangementClip,
  CollaborationMode,
  DragState,
  ProjectState,
  SessionMediaCheck,
  TimelineDragState,
  TimelineSelection,
  TimelineViewport,
} from "../app/types.ts";
import { logClient } from "../app/util.ts";
import {
  CORRUPT_WORKSPACE_NOTICE,
  findRestoredSelection,
  formatRestoredStatus,
  readSavedWorkspaceSession,
  workspaceLockEvents,
} from "../app/workspace-boot.ts";
import type {
  SavedWorkspaceSession,
  WorkspaceAccess,
  WorkspaceBoot,
} from "../app/workspace-types.ts";
import { isArrangementEmptyStateDismissedOnOpen } from "../arrangement-empty-state.ts";
import type { ImportNoticeContent } from "../components/ImportNotice";
import type {
  ProjectHistoryAction,
  ProjectHistoryState,
} from "../project-history";
import { createWorkspaceAutosave } from "../workspace-autosave.ts";
import {
  serializeWorkspaceSession,
  toProjectHistoryState,
  type WorkspaceSessionSource,
} from "../workspace-session.ts";
import { clearCurrentSession, saveCurrentSession } from "../workspace-store.ts";

export type WorkspacePersistenceInputs = {
  boot: WorkspaceBoot;
  restoredSession: SavedWorkspaceSession | null;
  projectHistory: ProjectHistoryState<ProjectState>;
  dispatchProjectHistory: Dispatch<ProjectHistoryAction<ProjectState>>;
  playheadQ: number;
  playheadQRef: { current: number };
  setPlayheadQ: (nextQ: number) => void;
  playbackOriginRef: { current: number };
  selectedClipId: string | undefined;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  selectedLaneId: string | undefined;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  sourceSelection: SourceSelection | undefined;
  setSourceSelection: Dispatch<SetStateAction<SourceSelection | undefined>>;
  timelineScrollRef: { current: HTMLDivElement | null };
  timelineViewport: TimelineViewport;
  sessionSource: WorkspaceSessionSource;
  setSessionSource: Dispatch<SetStateAction<WorkspaceSessionSource>>;
  importNotice: ImportNoticeContent | null;
  setImportNotice: Dispatch<SetStateAction<ImportNoticeContent | null>>;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  dragState: DragState | null;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  timelineDragState: TimelineDragState | null;
  setTimelineDragState: Dispatch<SetStateAction<TimelineDragState | null>>;
  isTimelineAudibleScrubbing: boolean;
  stopTimelineAudibleScrub: () => void;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setArrangementEmptyStateDismissed: Dispatch<SetStateAction<boolean>>;
  workspaceAccess: WorkspaceAccess;
  setWorkspaceAccess: Dispatch<SetStateAction<WorkspaceAccess>>;
  setIsTakeOverPromptOpen: Dispatch<SetStateAction<boolean>>;
  refuseReadOnlyEdit: () => boolean;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: Dispatch<SetStateAction<boolean>>;
  collaborationMode: CollaborationMode;
  viewingSharedSessionRef: { current: boolean };
  sessionMediaCheckRef: { current: SessionMediaCheck | null };
  setStatus: Dispatch<SetStateAction<string>>;
};

// Keeps the session in this browser: autosaves it, flushes it when the tab
// hides or the lock asks, and restores, takes over or closes it. Also
// reports the media check that follows opening a session.
export function useWorkspacePersistence({
  boot,
  restoredSession,
  projectHistory,
  dispatchProjectHistory,
  playheadQ,
  playheadQRef,
  setPlayheadQ,
  playbackOriginRef,
  selectedClipId,
  setSelectedClipId,
  selectedLaneId,
  setSelectedLaneId,
  sourceSelection,
  setSourceSelection,
  timelineScrollRef,
  timelineViewport,
  sessionSource,
  setSessionSource,
  importNotice,
  setImportNotice,
  isPlaying,
  setIsPlaying,
  dragState,
  setDragState,
  timelineDragState,
  setTimelineDragState,
  isTimelineAudibleScrubbing,
  stopTimelineAudibleScrub,
  setDragPreviewClips,
  setPendingSelection,
  setArrangementEmptyStateDismissed,
  workspaceAccess,
  setWorkspaceAccess,
  setIsTakeOverPromptOpen,
  refuseReadOnlyEdit,
  hasUnsavedChanges,
  setHasUnsavedChanges,
  collaborationMode,
  viewingSharedSessionRef,
  sessionMediaCheckRef,
  setStatus,
}: WorkspacePersistenceInputs) {
  // Everything a refresh brings back, read when an autosave serializes.
  const readWorkspaceSession = (): SavedWorkspaceSession => ({
    history: {
      past: projectHistory.past,
      present: projectHistory.present,
      future: projectHistory.future,
    },
    view: {
      playheadQ: playheadQRef.current,
      selectedClipId,
      selectedLaneId,
      ...toSourceSelectionView(sourceSelection),
      scrollLeft: timelineScrollRef.current?.scrollLeft ?? 0,
      scrollTop: timelineScrollRef.current?.scrollTop ?? 0,
      hasUnsavedChanges,
    },
    source: sessionSource,
    // Failures are about the attempt, not the session, so they are not kept.
    importNotice: importNotice?.tone === "error" ? null : importNotice,
  });
  const readWorkspaceSessionRef = useRef(readWorkspaceSession);
  readWorkspaceSessionRef.current = readWorkspaceSession;
  const workspaceBusyRef = useRef(false);
  // Playback and gestures change the session many times a second; it is
  // saved once they stop.
  workspaceBusyRef.current = Boolean(
    isPlaying ||
      dragState ||
      timelineDragState ||
      isTimelineAudibleScrubbing ||
      projectHistory.transientBase !== undefined,
  );
  const canSaveWorkspace =
    workspaceAccess === "owner" && collaborationMode !== "connected";
  const canSaveWorkspaceRef = useRef(canSaveWorkspace);
  canSaveWorkspaceRef.current = canSaveWorkspace;
  const [workspaceAutosave] = useState(() =>
    createWorkspaceAutosave({
      serialize: () =>
        serializeWorkspaceSession(readWorkspaceSessionRef.current()),
      write: (payload) => saveCurrentSession({ savedAt: Date.now(), payload }),
      isBusy: () => workspaceBusyRef.current,
      onError: (error) =>
        logClient("workspace:save:error", {
          message: error instanceof Error ? error.message : String(error),
        }),
    }),
  );
  const shouldSaveWorkspace = useCallback(
    () => canSaveWorkspaceRef.current && !viewingSharedSessionRef.current,
    [viewingSharedSessionRef],
  );

  // Saves every change to the session after a short pause. A session that
  // was closed, or never started, clears the saved record instead.
  useEffect(() => {
    void [
      canSaveWorkspace,
      hasUnsavedChanges,
      playheadQ,
      selectedClipId,
      selectedLaneId,
      sourceSelection,
      sessionSource,
      importNotice,
      timelineViewport.scrollLeft,
    ];
    if (!shouldSaveWorkspace()) {
      return;
    }
    if (isPristineProjectHistory(projectHistory)) {
      workspaceAutosave.cancel();
      void clearCurrentSession().catch((error: unknown) =>
        logClient("workspace:clear:error", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    workspaceAutosave.markDirty();
  }, [
    canSaveWorkspace,
    hasUnsavedChanges,
    importNotice,
    playheadQ,
    projectHistory,
    selectedClipId,
    selectedLaneId,
    sessionSource,
    shouldSaveWorkspace,
    sourceSelection,
    timelineViewport.scrollLeft,
    workspaceAutosave,
  ]);

  const flushWorkspaceSession = useCallback(async () => {
    if (!shouldSaveWorkspace()) {
      return;
    }
    // Playback moves only the live playhead, so mark the session dirty to
    // capture where it is now.
    workspaceAutosave.markDirty();
    await workspaceAutosave.flush();
  }, [shouldSaveWorkspace, workspaceAutosave]);

  useEffect(() => {
    const flush = () => {
      void flushWorkspaceSession();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [flushWorkspaceSession]);

  useEffect(() => {
    workspaceLockEvents.flush = flushWorkspaceSession;
    workspaceLockEvents.lost = () => {
      workspaceAutosave.cancel();
      setWorkspaceAccess("taken-over");
      setStatus(
        "This session was taken over in another tab. Changes here are no longer saved.",
      );
    };
    return () => {
      workspaceLockEvents.flush = async () => {};
      workspaceLockEvents.lost = () => {};
    };
  }, [flushWorkspaceSession, setStatus, setWorkspaceAccess, workspaceAutosave]);

  // Puts the saved scroll position back once the timeline has laid out.
  useLayoutEffect(() => {
    const scroller = timelineScrollRef.current;
    const view = restoredSession?.view;
    if (scroller && view) {
      scroller.scrollLeft = view.scrollLeft;
      scroller.scrollTop = view.scrollTop;
    }
  }, [restoredSession, timelineScrollRef]);

  const applyWorkspaceSession = useCallback(
    (session: SavedWorkspaceSession | null) => {
      stopTimelineAudibleScrub();
      setIsPlaying(false);
      setDragPreviewClips(null);
      setDragState(null);
      setPendingSelection(null);
      setTimelineDragState(null);
      sessionMediaCheckRef.current = null;
      dispatchProjectHistory({
        type: "restore",
        history: session
          ? toProjectHistoryState(session.history)
          : createNewSessionHistory(),
      });
      setHasUnsavedChanges(
        session ? (session.view.hasUnsavedChanges ?? true) : false,
      );
      const selection = findRestoredSelection(session);
      setSelectedClipId(selection.selectedClipId);
      setSelectedLaneId(selection.selectedLaneId);
      setSourceSelection(selection.sourceSelection);
      setPlayheadQ(session?.view.playheadQ ?? 0);
      playbackOriginRef.current = session?.view.playheadQ ?? 0;
      setSessionSource(session?.source ?? { kind: "none" });
      setImportNotice(session?.importNotice ?? null);
      setArrangementEmptyStateDismissed(
        session
          ? isArrangementEmptyStateDismissedOnOpen(
              session.history.present.clips.length,
            )
          : false,
      );
      const scroller = timelineScrollRef.current;
      if (scroller) {
        scroller.scrollLeft = session?.view.scrollLeft ?? 0;
        scroller.scrollTop = session?.view.scrollTop ?? 0;
      }
    },
    [
      dispatchProjectHistory,
      playbackOriginRef,
      sessionMediaCheckRef,
      setArrangementEmptyStateDismissed,
      setDragPreviewClips,
      setDragState,
      setHasUnsavedChanges,
      setImportNotice,
      setIsPlaying,
      setPendingSelection,
      setPlayheadQ,
      setSelectedClipId,
      setSelectedLaneId,
      setSessionSource,
      setSourceSelection,
      setTimelineDragState,
      stopTimelineAudibleScrub,
      timelineScrollRef,
    ],
  );

  // A session this tab opens or closes itself is its own again, so it is
  // saved once this tab owns the saved session.
  const claimWorkspaceSession = useCallback(() => {
    viewingSharedSessionRef.current = false;
    if (workspaceAccess === "joiner") {
      void boot.lock.acquire().then((owner) => {
        setWorkspaceAccess(owner ? "owner" : "read-only");
      });
    }
  }, [boot.lock, setWorkspaceAccess, viewingSharedSessionRef, workspaceAccess]);

  async function handleTakeOverWorkspace() {
    setIsTakeOverPromptOpen(false);
    setStatus("Taking over the session from the other tab...");
    await boot.lock.takeOver();
    const { session, corruptKey } = await readSavedWorkspaceSession();
    viewingSharedSessionRef.current = false;
    applyWorkspaceSession(session);
    if (corruptKey) {
      setImportNotice(CORRUPT_WORKSPACE_NOTICE);
    }
    setWorkspaceAccess("owner");
    setStatus(
      session
        ? formatRestoredStatus(session)
        : "Took over the session from the other tab.",
    );
  }

  function handleOpenWorkspaceReadOnly() {
    setWorkspaceAccess("read-only");
    setStatus(
      "Opened read-only. The session is open in another tab, so changes here are not saved.",
    );
  }

  // Replaces the session with a blank one: File → Close Session, and File →
  // New Session once any unsaved changes are dealt with.
  function resetSession(status: string) {
    if (refuseReadOnlyEdit()) {
      return;
    }

    workspaceAutosave.cancel();
    claimWorkspaceSession();
    applyWorkspaceSession(null);
    setStatus(status);
  }

  function handleCloseSession() {
    resetSession("Closed the session.");
  }

  function startNewSession() {
    resetSession("Started a new session.");
  }

  // Replaces the session with one from the Sessions library, as a refresh
  // would restore it.
  function openWorkspaceSession(session: SavedWorkspaceSession) {
    workspaceAutosave.cancel();
    claimWorkspaceSession();
    applyWorkspaceSession(session);
  }

  const reportSessionMediaCheck = useCallback(() => {
    const check = sessionMediaCheckRef.current;
    if (!check || check.pendingIds.size || check.analyzingFromDisk) {
      return;
    }

    sessionMediaCheckRef.current = null;
    setStatus(formatSessionMediaCheckStatus(check));
  }, [sessionMediaCheckRef, setStatus]);

  const settleSessionMediaCheck = useCallback(
    (mediaId: string, outcome: "restored" | "offline") => {
      const check = sessionMediaCheckRef.current;
      if (!check?.pendingIds.delete(mediaId)) {
        return;
      }

      if (outcome === "restored") {
        check.restored += 1;
      } else {
        check.offline += 1;
      }
      reportSessionMediaCheck();
    },
    [reportSessionMediaCheck, sessionMediaCheckRef],
  );

  return {
    flushWorkspaceSession,
    claimWorkspaceSession,
    handleTakeOverWorkspace,
    handleOpenWorkspaceReadOnly,
    handleCloseSession,
    openWorkspaceSession,
    // The session as it would be saved now.
    readWorkspaceSession: () => readWorkspaceSessionRef.current(),
    startNewSession,
    reportSessionMediaCheck,
    settleSessionMediaCheck,
  };
}
