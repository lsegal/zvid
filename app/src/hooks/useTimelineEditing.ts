import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useMemo,
} from "react";
import type { ClipClipboard } from "../app/clip-ops.ts";
import { findSelectedSourceTrack } from "../app/source-selection.ts";
import { getTimelineContentEndQ } from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import type { MediaItem } from "../media";
import { useMenus } from "../menus/useMenus.ts";
import { MAX_LAYERS } from "../selection-overlaps";
import { useKeyboardShortcuts } from "../shortcuts/useKeyboardShortcuts.ts";
import { useSpacePlayback } from "../shortcuts/useSpacePlayback.ts";
import type { createSpaceHold } from "../space-shortcut";
import type { AppLayout } from "./useAppLayout.ts";
import { useClipActions } from "./useClipActions.ts";
import { useClipDrag } from "./useClipDrag.ts";
import { useClipInsertion } from "./useClipInsertion.ts";
import type { useFxEditing } from "./useFxEditing.ts";
import { useLayerActions } from "./useLayerActions.ts";
import type { MediaPreviewModel } from "./useMediaPreview.ts";
import type { usePlayback } from "./usePlayback.ts";
import type {
  ProjectStore,
  useProjectHistoryCommands,
} from "./useProjectStore.ts";
import { useSourceClipActions } from "./useSourceClipActions.ts";
import { useSourceSpanDrag } from "./useSourceSpanDrag.ts";
import { useSourceTrackActions } from "./useSourceTrackActions.ts";
import type { LaneStatus } from "./useTimelineLanes.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import type { useTimelineViewport } from "./useTimelineViewport.ts";

export type TimelineEditingInputs = {
  project: ProjectState;
  store: Pick<
    ProjectStore,
    | "commitProjectChange"
    | "dispatchProject"
    | "canUndo"
    | "canRedo"
    | "undoLabel"
    | "redoLabel"
    | "playheadQRef"
    | "setPlayheadQ"
    | "isWorkspaceReadOnlyRef"
    | "refuseReadOnlyEdit"
  >;
  selection: Pick<
    TimelineSelectionState,
    | "dragPreviewClips"
    | "setDragPreviewClips"
    | "setSelectedClipId"
    | "setClipMenu"
    | "renamingLaneId"
    | "setRenamingLaneId"
    | "selectedLaneId"
    | "setSelectedLaneId"
    | "pendingSelection"
    | "setPendingSelection"
    | "dragState"
    | "setDragState"
    | "timelineDragState"
    | "sourceSpanDrag"
    | "setSourceSpanDrag"
    | "dragPreviewSourceSpans"
    | "setDragPreviewSourceSpans"
    | "timelineClips"
    | "selectedClip"
    | "selectLaneFromLabel"
    | "focusLaneLabel"
    | "sourceSelection"
    | "selectSource"
  >;
  viewport: Pick<
    ReturnType<typeof useTimelineViewport>,
    "barLength" | "beatUnit" | "snapUnit" | "quarterPx" | "totalQuarters"
  >;
  layout: Pick<
    AppLayout,
    | "labelWidth"
    | "isInspectorCollapsed"
    | "toggleInspectorCollapsed"
    | "shortcutLabels"
  >;
  playback: Pick<
    ReturnType<typeof usePlayback>,
    | "cancelScrubPlaybackResume"
    | "startPlayback"
    | "jumpPlayheadTo"
    | "jumpToClipStart"
    | "playableClipCount"
  >;
  historyCommands: ReturnType<typeof useProjectHistoryCommands>;
  fxEditing: Pick<
    ReturnType<typeof useFxEditing>,
    "addFxDevice" | "setLayerFxEnabled"
  >;
  // Re-resolves the audio mix, from the Audio row's menu.
  refreshAudio: () => void;
  fxLaneId: string | undefined;
  mediaItemsById: Map<string, MediaItem>;
  laneStatusById: Map<string, LaneStatus>;
  playbackOriginRef: RefObject<number>;
  spaceHoldRef: { current: ReturnType<typeof createSpaceHold> };
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  clipClipboardRef: RefObject<ClipClipboard | null>;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  mediaPreview: Pick<MediaPreviewModel, "previewTab" | "toggleMediaPlayback">;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Editing the timeline: inserting clips (useClipInsertion), clip and range
// commands (useClipActions, useSourceClipActions), layer and source track
// commands (useLayerActions, useSourceTrackActions), the context
// and Edit menus (useMenus), keyboard shortcuts and Space playback, and clip
// and source clip drags (useClipDrag, useSourceSpanDrag).
export function useTimelineEditing({
  project,
  store,
  selection,
  viewport,
  layout,
  playback,
  historyCommands,
  fxEditing,
  refreshAudio,
  fxLaneId,
  mediaItemsById,
  laneStatusById,
  playbackOriginRef,
  spaceHoldRef,
  timelineScrollRef,
  arrangementLanesRef,
  clipClipboardRef,
  isPlaying,
  setIsPlaying,
  mediaPreview,
  setStatus,
}: TimelineEditingInputs) {
  const {
    snapEnabled,
    bpm,
    fps,
    lanes,
    sourceTracks,
    sourceSpans,
    clips,
    effects,
    projectDurationFrames,
    sourceTracksLocked = false,
  } = project;
  const {
    commitProjectChange,
    dispatchProject,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    playheadQRef,
    setPlayheadQ,
    isWorkspaceReadOnlyRef,
    refuseReadOnlyEdit,
  } = store;
  const {
    dragPreviewClips,
    setDragPreviewClips,
    setSelectedClipId,
    setClipMenu,
    renamingLaneId,
    setRenamingLaneId,
    selectedLaneId,
    setSelectedLaneId,
    pendingSelection,
    setPendingSelection,
    dragState,
    setDragState,
    timelineDragState,
    timelineClips,
    selectedClip,
    selectLaneFromLabel,
    focusLaneLabel,
    sourceSpanDrag,
    setSourceSpanDrag,
    dragPreviewSourceSpans,
    setDragPreviewSourceSpans,
    sourceSelection,
    selectSource,
  } = selection;
  const { barLength, beatUnit, snapUnit, quarterPx, totalQuarters } = viewport;
  const {
    labelWidth,
    isInspectorCollapsed,
    toggleInspectorCollapsed,
    shortcutLabels,
  } = layout;
  const {
    cancelScrubPlaybackResume,
    startPlayback,
    jumpPlayheadTo,
    jumpToClipStart,
    playableClipCount,
  } = playback;
  const { handleUndo, handleRedo } = historyCommands;
  const { addFxDevice, setLayerFxEnabled } = fxEditing;

  const canCreateLayer = lanes.length < MAX_LAYERS;
  const timelineContentEndQ = useMemo(
    () =>
      getTimelineContentEndQ(
        timelineClips,
        sourceSpans,
        bpm,
        barLength,
      ),
    [barLength, bpm, sourceSpans, timelineClips],
  );

  const {
    commitPendingSelectionToSourceTrack,
    insertFillClip,
    insertTextClip,
    insertFxClip,
    createSourceSpanClip,
    addSourceSpanToArrangement,
    handleRandomizeTimeline,
  } = useClipInsertion({
    barLength,
    bpm,
    clips,
    commitProjectChange,
    dispatchProject,
    fps,
    lanes,
    mediaItemsById,
    pendingSelection,
    playbackOriginRef,
    projectDurationFrames,
    setDragPreviewClips,
    setIsPlaying,
    setPendingSelection,
    setPlayheadQ,
    setSelectedClipId,
    setStatus,
    sourceSpans,
    sourceTracks,
  });

  useSpacePlayback({
    cancelScrubPlaybackResume,
    clipCount: playableClipCount,
    dragState,
    isPlaying,
    isMediaTabActive: mediaPreview.previewTab === "media",
    toggleMediaPlayback: mediaPreview.toggleMediaPlayback,
    setIsPlaying,
    spaceHoldRef,
    startPlayback,
    timelineDragState,
    timelineScrollRef,
  });

  const {
    copyArrangementClip,
    cutArrangementClip,
    deleteArrangementClip,
    copySelectionRange,
    copySelection,
    cutSelection,
    deleteSelection,
    pasteArrangementClip,
    splitArrangementClip,
    duplicateArrangementClip,
    copySourceSpan,
    copySourceSpanToLayer,
    clipActionsRef,
  } = useClipActions({
    addSourceSpanToArrangement,
    bpm,
    clipClipboardRef,
    clips,
    commitProjectChange,
    createSourceSpanClip,
    dispatchProject,
    effects,
    fxLaneId,
    lanes,
    mediaItemsById,
    playheadQRef,
    selectedClip,
    selectedLaneId,
    setPendingSelection,
    setSelectedClipId,
    setStatus,
    timelineClips,
  });

  const { sourceClipActions, sourceClipActionsRef } = useSourceClipActions({
    bpm,
    clipClipboardRef,
    commitProjectChange,
    copySourceSpan,
    jumpPlayheadTo,
    playheadQRef,
    selectSource,
    setStatus,
    sourceTracksLocked,
  });
  const selectedSourceSpan = selectedClip
    ? undefined
    : sourceSpans.find((span) => span.id === sourceSelection?.sourceSpanId);

  const {
    handleCreateLayer,
    insertLayer,
    duplicateLayer,
    deleteLayer,
    moveLayer,
    layerReorder,
    commitLayerRename,
    addLayerFx,
  } = useLayerActions({
    addFxDevice,
    arrangementLanesRef,
    canCreateLayer,
    commitProjectChange,
    focusLaneLabel,
    isInspectorCollapsed,
    lanes,
    pendingSelection,
    selectLaneFromLabel,
    selectedClip,
    setPendingSelection,
    setRenamingLaneId,
    setSelectedClipId,
    setStatus,
    timelineScrollRef,
    toggleInspectorCollapsed,
  });

  const {
    sourceTracksListRef,
    renamingSourceTrackId,
    setRenamingSourceTrackId,
    commitSourceTrackRename,
    cancelSourceTrackRename,
    createEmptySourceTrack,
    duplicateSourceTrack,
    deleteSourceTrack,
    moveSourceTrack,
    sourceTrackReorder,
    setSourceTracksLocked,
  } = useSourceTrackActions({
    commitProjectChange,
    selectedClip,
    setSelectedClipId,
    selectSource,
    setStatus,
    sourceSelection,
    sourceTracks,
    sourceTracksLocked,
    timelineScrollRef,
  });
  const selectedSourceTrack = findSelectedSourceTrack(
    sourceSelection,
    sourceTracks,
  );

  const {
    openArrangementClipMenu,
    openLaneMenu,
    openLayerMenu,
    openAudioMenu,
    openSourceSpanMenu,
    openSourceTrackMenu,
    getClipMenuEntries,
    getEditMenuEntries,
  } = useMenus({
    addLayerFx,
    barLength,
    bpm,
    canRedo,
    canUndo,
    clipClipboardRef,
    commitPendingSelectionToSourceTrack,
    copyArrangementClip,
    copySelection,
    copySelectionRange,
    copySourceSpanToLayer,
    cutArrangementClip,
    cutSelection,
    deleteArrangementClip,
    deleteLayer,
    deleteSelection,
    deleteSourceTrack,
    duplicateArrangementClip,
    duplicateLayer,
    duplicateSourceTrack,
    fxLaneId,
    handleRedo,
    handleUndo,
    insertFillClip,
    insertFxClip,
    insertLayer,
    insertTextClip,
    jumpToClipStart,
    laneStatusById,
    lanes,
    moveLayer,
    moveSourceTrack,
    pasteArrangementClip,
    pendingSelection,
    playheadQRef,
    quarterPx,
    redoLabel,
    refreshAudio,
    renamingLaneId,
    renamingSourceTrackId,
    selectLaneFromLabel,
    selectedClip,
    selectedLaneId,
    selectedSourceSpan,
    selectedSourceTrack,
    setClipMenu,
    setLayerFxEnabled,
    setPendingSelection,
    setRenamingLaneId,
    setRenamingSourceTrackId,
    setSelectedClipId,
    setSelectedLaneId,
    shortcutLabels,
    sourceClipActions,
    sourceSpans,
    sourceTracks,
    sourceTracksLocked,
    splitArrangementClip,
    timelineClips,
    timelineScrollRef,
    undoLabel,
  });

  useKeyboardShortcuts({
    bpm,
    clipActionsRef,
    clipClipboardRef,
    commitPendingSelectionToSourceTrack,
    deleteSourceTrack,
    dragState,
    duplicateSourceTrack,
    fps,
    fxLaneId,
    handleRedo,
    handleUndo,
    lanes,
    pendingSelection,
    playbackOriginRef,
    playheadQRef,
    selectedClip,
    selectedSourceSpan,
    selectedSourceTrack,
    setPendingSelection,
    setPlayheadQ,
    setSelectedClipId,
    setSelectedLaneId,
    sourceClipActionsRef,
    timelineContentEndQ,
    timelineDragState,
    timelineScrollRef,
    totalQuarters,
  });

  useClipDrag({
    dragState,
    setDragState,
    dragPreviewClips,
    setDragPreviewClips,
    setPendingSelection,
    setSelectedClipId,
    clips,
    bpm,
    beatUnit,
    snapUnit,
    snapEnabled,
    quarterPx,
    totalQuarters,
    labelWidth,
    timelineScrollRef,
    playbackOriginRef,
    isWorkspaceReadOnlyRef,
    refuseReadOnlyEdit,
    setPlayheadQ,
    jumpToClipStart,
    commitProjectChange,
  });

  useSourceSpanDrag({
    sourceSpanDrag,
    setSourceSpanDrag,
    dragPreviewSourceSpans,
    setDragPreviewSourceSpans,
    sourceSpans,
    mediaItemsById,
    bpm,
    fps,
    snapUnit,
    snapEnabled,
    sourceTracksLocked,
    quarterPx,
    isWorkspaceReadOnlyRef,
    refuseReadOnlyEdit,
    commitProjectChange,
  });

  return {
    canCreateLayer,
    addSourceSpanToArrangement,
    handleRandomizeTimeline,
    handleCreateLayer,
    layerReorder,
    commitLayerRename,
    openArrangementClipMenu,
    openLaneMenu,
    openLayerMenu,
    openAudioMenu,
    openSourceSpanMenu,
    openSourceTrackMenu,
    sourceTracksListRef,
    sourceTrackReorder,
    sourceTracksLocked,
    setSourceTracksLocked,
    renamingSourceTrackId,
    commitSourceTrackRename,
    cancelSourceTrackRename,
    createEmptySourceTrack,
    getClipMenuEntries,
    getEditMenuEntries,
  };
}
