import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import type {
  CollaborationMode,
  SessionMediaCheck,
  TimelineViewport,
} from "../app/types.ts";
import { CORRUPT_WORKSPACE_NOTICE } from "../app/workspace-boot.ts";
import type { WorkspaceBoot } from "../app/workspace-types.ts";
import type { ImportNoticeContent } from "../components/ImportNotice";
import type { WorkspaceSessionSource } from "../workspace-session.ts";
import type { usePlayback } from "./usePlayback.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import { useWorkspacePersistence } from "./useWorkspacePersistence.ts";

export type WorkspaceSessionInputs = {
  boot: WorkspaceBoot;
  store: Pick<
    ProjectStore,
    | "projectHistory"
    | "dispatchProjectHistory"
    | "playheadQ"
    | "playheadQRef"
    | "setPlayheadQ"
    | "workspaceAccess"
    | "setWorkspaceAccess"
    | "setIsTakeOverPromptOpen"
    | "refuseReadOnlyEdit"
  >;
  selection: Pick<
    TimelineSelectionState,
    | "selectedClipId"
    | "setSelectedClipId"
    | "selectedLaneId"
    | "setSelectedLaneId"
    | "sourceSelection"
    | "setSourceSelection"
    | "dragState"
    | "setDragState"
    | "timelineDragState"
    | "setTimelineDragState"
    | "setDragPreviewClips"
    | "setPendingSelection"
  >;
  playback: Pick<
    ReturnType<typeof usePlayback>,
    "isTimelineAudibleScrubbing" | "stopTimelineAudibleScrub"
  >;
  playbackOriginRef: RefObject<number>;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineViewport: TimelineViewport;
  setArrangementEmptyStateDismissed: Dispatch<SetStateAction<boolean>>;
  collaborationMode: CollaborationMode;
  setStatus: Dispatch<SetStateAction<string>>;
};

// The workspace session in this browser: where the open session came from,
// the restore or import notice, and its persistence
// (useWorkspacePersistence).
export function useWorkspaceSession({
  boot,
  store,
  selection,
  playback,
  playbackOriginRef,
  isPlaying,
  setIsPlaying,
  timelineScrollRef,
  timelineViewport,
  setArrangementEmptyStateDismissed,
  collaborationMode,
  setStatus,
}: WorkspaceSessionInputs) {
  const restoredSession = boot.session;
  const [importNotice, setImportNotice] = useState<ImportNoticeContent | null>(
    () =>
      boot.corruptKey
        ? CORRUPT_WORKSPACE_NOTICE
        : (restoredSession?.importNotice ?? null),
  );
  const [sessionSource, setSessionSource] = useState<WorkspaceSessionSource>(
    () => restoredSession?.source ?? { kind: "none" },
  );
  // True while the project is someone else's shared session, which is never
  // saved over this browser's own session.
  const viewingSharedSessionRef = useRef(boot.access === "joiner");
  const sessionMediaCheckRef = useRef<SessionMediaCheck | null>(null);

  const persistence = useWorkspacePersistence({
    boot,
    restoredSession,
    projectHistory: store.projectHistory,
    dispatchProjectHistory: store.dispatchProjectHistory,
    playheadQ: store.playheadQ,
    playheadQRef: store.playheadQRef,
    setPlayheadQ: store.setPlayheadQ,
    playbackOriginRef,
    selectedClipId: selection.selectedClipId,
    setSelectedClipId: selection.setSelectedClipId,
    selectedLaneId: selection.selectedLaneId,
    setSelectedLaneId: selection.setSelectedLaneId,
    sourceSelection: selection.sourceSelection,
    setSourceSelection: selection.setSourceSelection,
    timelineScrollRef,
    timelineViewport,
    sessionSource,
    setSessionSource,
    importNotice,
    setImportNotice,
    isPlaying,
    setIsPlaying,
    dragState: selection.dragState,
    setDragState: selection.setDragState,
    timelineDragState: selection.timelineDragState,
    setTimelineDragState: selection.setTimelineDragState,
    isTimelineAudibleScrubbing: playback.isTimelineAudibleScrubbing,
    stopTimelineAudibleScrub: playback.stopTimelineAudibleScrub,
    setDragPreviewClips: selection.setDragPreviewClips,
    setPendingSelection: selection.setPendingSelection,
    setArrangementEmptyStateDismissed,
    workspaceAccess: store.workspaceAccess,
    setWorkspaceAccess: store.setWorkspaceAccess,
    setIsTakeOverPromptOpen: store.setIsTakeOverPromptOpen,
    refuseReadOnlyEdit: store.refuseReadOnlyEdit,
    collaborationMode,
    viewingSharedSessionRef,
    sessionMediaCheckRef,
    setStatus,
  });

  return {
    ...persistence,
    importNotice,
    setImportNotice,
    sessionSource,
    setSessionSource,
    viewingSharedSessionRef,
    sessionMediaCheckRef,
  };
}

export type WorkspaceSession = ReturnType<typeof useWorkspaceSession>;
