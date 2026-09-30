import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import { formatHistoryStatus } from "../app/format.ts";
import { patchProjectState } from "../app/session-project.ts";
import type {
  ArrangementClip,
  DragState,
  ProjectState,
  TimelineDragState,
  TimelineSelection,
} from "../app/types.ts";
import type {
  SavedWorkspaceSession,
  WorkspaceAccess,
} from "../app/workspace-types.ts";
import { createPlayheadSignal } from "../playhead-signal";
import {
  createProjectHistoryState,
  isProjectEditAction,
  type ProjectHistoryAction,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history";
import { toProjectHistoryState } from "../workspace-session.ts";

export type ProjectStoreInputs = {
  access: WorkspaceAccess;
  restoredSession: SavedWorkspaceSession | null;
};

// The project's undo history, the edits that go through it, the read-only
// guard that refuses them in a tab that doesn't save, and the playhead.
export function useProjectStore({
  access,
  restoredSession,
}: ProjectStoreInputs) {
  const [projectHistory, dispatchProjectHistory] = useReducer(
    projectHistoryReducer<ProjectState>,
    restoredSession,
    (session) =>
      session
        ? toProjectHistoryState(session.history)
        : createProjectHistoryState(INITIAL_PROJECT_STATE),
  );
  const canUndo = projectHistory.past.length > 0;
  const canRedo = projectHistory.future.length > 0;
  const undoLabel = projectHistory.past[projectHistory.past.length - 1]?.label;
  const redoLabel = projectHistory.future[0]?.label;

  const [initialPlayheadQ] = useState(
    () => restoredSession?.view.playheadQ ?? 0,
  );
  const [playheadQ, setPlayheadQState] = useState(initialPlayheadQ);

  const [workspaceAccess, setWorkspaceAccess] = useState(access);
  // Edits in a tab that doesn't save the session would be lost, so a
  // read-only tab refuses them and asks to take the session over instead.
  const isWorkspaceReadOnly =
    workspaceAccess === "read-only" || workspaceAccess === "taken-over";
  const isWorkspaceReadOnlyRef = useRef(isWorkspaceReadOnly);
  isWorkspaceReadOnlyRef.current = isWorkspaceReadOnly;
  const [isTakeOverPromptOpen, setIsTakeOverPromptOpen] = useState(false);
  // Returns true, and opens the Take over prompt, when this tab is read-only.
  const refuseReadOnlyEdit = useCallback(() => {
    if (!isWorkspaceReadOnlyRef.current) {
      return false;
    }

    setIsTakeOverPromptOpen(true);
    return true;
  }, []);
  const dispatchProject = useCallback(
    (action: ProjectHistoryAction<ProjectState>) => {
      if (isProjectEditAction(action) && refuseReadOnlyEdit()) {
        return;
      }

      dispatchProjectHistory(action);
    },
    [refuseReadOnlyEdit],
  );

  const playheadQRef = useRef(initialPlayheadQ);
  const [playheadSignal] = useState(() =>
    createPlayheadSignal(initialPlayheadQ),
  );
  // Seeks move the live playhead and state together. Playback advances only
  // the live playhead each frame and commits it to state now and then.
  const setPlayheadQ = useCallback(
    (nextQ: number) => {
      playheadQRef.current = nextQ;
      playheadSignal.set(nextQ);
      setPlayheadQState(nextQ);
    },
    [playheadSignal],
  );
  const projectSnapshotRef = useRef(projectHistory.present);

  const commitProjectChange = useCallback(
    (label: string, updater: (current: ProjectState) => ProjectState) => {
      dispatchProject({ type: "commit", label, updater });
    },
    [dispatchProject],
  );

  // Zoom and media hydration change the project without editing it, so a
  // read-only tab still applies them.
  const commitViewChange = useCallback(
    (label: string, updater: (current: ProjectState) => ProjectState) => {
      dispatchProjectHistory({ type: "commit", label, updater });
    },
    [],
  );

  const commitProjectPatch = useCallback(
    (label: string, patch: Partial<ProjectState>) => {
      commitProjectChange(label, (current) =>
        patchProjectState(current, patch),
      );
    },
    [commitProjectChange],
  );

  return {
    projectHistory,
    dispatchProjectHistory,
    dispatchProject,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    initialPlayheadQ,
    playheadQ,
    setPlayheadQState,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    workspaceAccess,
    setWorkspaceAccess,
    isWorkspaceReadOnly,
    isWorkspaceReadOnlyRef,
    isTakeOverPromptOpen,
    setIsTakeOverPromptOpen,
    refuseReadOnlyEdit,
    projectSnapshotRef,
    commitProjectChange,
    commitViewChange,
    commitProjectPatch,
  };
}

export type ProjectHistoryCommandsInputs = {
  projectHistory: ProjectHistoryState<ProjectState>;
  dispatchProjectHistory: Dispatch<ProjectHistoryAction<ProjectState>>;
  projectSnapshotRef: { current: ProjectState };
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  refuseReadOnlyEdit: () => boolean;
  finishTextEdit: () => void;
  stopTimelineAudibleScrub: () => void;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setTimelineDragState: Dispatch<SetStateAction<TimelineDragState | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Undo and redo, which first end whatever gesture or text edit is open.
// App calls this where it declared them, so the snapshot ref still syncs in
// the same effect order.
export function useProjectHistoryCommands({
  projectHistory,
  dispatchProjectHistory,
  projectSnapshotRef,
  undoLabel,
  redoLabel,
  refuseReadOnlyEdit,
  finishTextEdit,
  stopTimelineAudibleScrub,
  setIsPlaying,
  setDragPreviewClips,
  setDragState,
  setPendingSelection,
  setTimelineDragState,
  setStatus,
}: ProjectHistoryCommandsInputs) {
  const handleUndo = useCallback(() => {
    if (!undoLabel || refuseReadOnlyEdit()) {
      return;
    }

    // An open text edit is committed first, so undo steps over it whole.
    finishTextEdit();
    stopTimelineAudibleScrub();
    setIsPlaying(false);
    setDragPreviewClips(null);
    setDragState(null);
    setPendingSelection(null);
    setTimelineDragState(null);
    dispatchProjectHistory({ type: "undo" });
    setStatus(formatHistoryStatus("Undid", undoLabel));
  }, [
    dispatchProjectHistory,
    finishTextEdit,
    refuseReadOnlyEdit,
    setDragPreviewClips,
    setDragState,
    setIsPlaying,
    setPendingSelection,
    setStatus,
    setTimelineDragState,
    stopTimelineAudibleScrub,
    undoLabel,
  ]);

  const handleRedo = useCallback(() => {
    if (!redoLabel || refuseReadOnlyEdit()) {
      return;
    }

    // An open text edit is committed first, before redoing.
    finishTextEdit();
    stopTimelineAudibleScrub();
    setIsPlaying(false);
    setDragPreviewClips(null);
    setDragState(null);
    setPendingSelection(null);
    setTimelineDragState(null);
    dispatchProjectHistory({ type: "redo" });
    setStatus(formatHistoryStatus("Redid", redoLabel));
  }, [
    dispatchProjectHistory,
    finishTextEdit,
    redoLabel,
    refuseReadOnlyEdit,
    setDragPreviewClips,
    setDragState,
    setIsPlaying,
    setPendingSelection,
    setStatus,
    setTimelineDragState,
    stopTimelineAudibleScrub,
  ]);

  useEffect(() => {
    projectSnapshotRef.current = projectHistory.present;
  }, [projectHistory.present, projectSnapshotRef]);

  return { handleUndo, handleRedo };
}
