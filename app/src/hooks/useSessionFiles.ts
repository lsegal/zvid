import type { Dispatch, SetStateAction } from "react";
import { isPristineProjectHistory } from "../app/workspace-boot.ts";
import type { WorkspaceBoot } from "../app/workspace-types.ts";
import type { AppMedia } from "./useAppMedia.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import { useSampleProject } from "./useSampleProject.ts";
import { useSessionIO } from "./useSessionIO.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import type { WorkspaceSession } from "./useWorkspaceSession.ts";

export type SessionFilesInputs = {
  boot: WorkspaceBoot;
  store: Pick<
    ProjectStore,
    | "projectHistory"
    | "commitProjectChange"
    | "commitViewChange"
    | "playheadQRef"
    | "setPlayheadQ"
    | "refuseReadOnlyEdit"
  >;
  selection: Pick<
    TimelineSelectionState,
    | "selectedClipId"
    | "setSelectedClipId"
    | "setSelectedLaneId"
    | "setDragPreviewClips"
    | "setPendingSelection"
  >;
  media: Pick<
    AppMedia,
    | "mediaItems"
    | "seedLocalMediaItems"
    | "cacheLocalMediaItems"
    | "localMediaOverridesRef"
  >;
  workspace: Pick<
    WorkspaceSession,
    | "sessionSource"
    | "setSessionSource"
    | "setImportNotice"
    | "sessionMediaCheckRef"
    | "claimWorkspaceSession"
    | "reportSessionMediaCheck"
  >;
  setArrangementEmptyStateDismissed: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Opening, importing and saving sessions and media (useSessionIO), and the
// bundled sample (useSampleProject).
export function useSessionFiles({
  boot,
  store,
  selection,
  media,
  workspace,
  setArrangementEmptyStateDismissed,
  setStatus,
}: SessionFilesInputs) {
  const { projectHistory, refuseReadOnlyEdit } = store;
  const sessionIO = useSessionIO({
    projectHistory,
    commitProjectChange: store.commitProjectChange,
    commitViewChange: store.commitViewChange,
    sessionName: projectHistory.present.sessionName,
    mediaItems: media.mediaItems,
    projectMediaItems: projectHistory.present.mediaItems,
    playheadQRef: store.playheadQRef,
    setPlayheadQ: store.setPlayheadQ,
    selectedClipId: selection.selectedClipId,
    setSelectedClipId: selection.setSelectedClipId,
    setSelectedLaneId: selection.setSelectedLaneId,
    sessionSource: workspace.sessionSource,
    setSessionSource: workspace.setSessionSource,
    setImportNotice: workspace.setImportNotice,
    setDragPreviewClips: selection.setDragPreviewClips,
    setPendingSelection: selection.setPendingSelection,
    setArrangementEmptyStateDismissed,
    seedLocalMediaItems: media.seedLocalMediaItems,
    cacheLocalMediaItems: media.cacheLocalMediaItems,
    localMediaOverridesRef: media.localMediaOverridesRef,
    sessionMediaCheckRef: workspace.sessionMediaCheckRef,
    claimWorkspaceSession: workspace.claimWorkspaceSession,
    reportSessionMediaCheck: workspace.reportSessionMediaCheck,
    refuseReadOnlyEdit,
    setStatus,
  });
  const sample = useSampleProject({
    boot,
    isPristine: () => isPristineProjectHistory(projectHistory),
    refuseReadOnlyEdit,
    openSamplePayload: sessionIO.openSamplePayload,
    setStatus,
  });

  return { ...sessionIO, sample };
}
