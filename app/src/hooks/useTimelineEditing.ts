import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useMemo,
} from "react";
import type { ClipClipboard } from "../app/clip-ops.ts";
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
import type { useMainAudio } from "./useMainAudio.ts";
import type { usePlayback } from "./usePlayback.ts";
import type {
  ProjectStore,
  useProjectHistoryCommands,
} from "./useProjectStore.ts";
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
    | "jumpToClipStart"
    | "playableClipCount"
  >;
  historyCommands: ReturnType<typeof useProjectHistoryCommands>;
  fxEditing: Pick<
    ReturnType<typeof useFxEditing>,
    "addFxDevice" | "setLayerFxEnabled"
  >;
  mainAudioModel: Pick<
    ReturnType<typeof useMainAudio>,
    "mainAudio" | "mainAudioInputRef" | "removeMainAudio"
  >;
  fxLaneId: string;
  mediaItemsById: Map<string, MediaItem>;
  laneStatusById: Map<string, LaneStatus>;
  playbackOriginRef: RefObject<number>;
  spaceHoldRef: { current: ReturnType<typeof createSpaceHold> };
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  clipClipboardRef: RefObject<ClipClipboard | null>;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Editing the timeline: inserting clips (useClipInsertion), clip and range
// commands (useClipActions), layer and source track commands
// (useLayerActions, useSourceTrackActions), the context
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
  mainAudioModel,
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
    mainAudioId,
    projectDurationFrames,
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
    jumpToClipStart,
    playableClipCount,
  } = playback;
  const { handleUndo, handleRedo } = historyCommands;
  const { addFxDevice, setLayerFxEnabled } = fxEditing;
  const { mainAudio, mainAudioInputRef, removeMainAudio } = mainAudioModel;

  const canCreateLayer = lanes.length < MAX_LAYERS;
  const timelineContentEndQ = useMemo(
    () =>
      getTimelineContentEndQ(
        timelineClips,
        sourceSpans,
        mainAudio?.durationSeconds,
        bpm,
        barLength,
      ),
    [barLength, bpm, mainAudio?.durationSeconds, sourceSpans, timelineClips],
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
    playheadQRef,
    selectedClip,
    selectedLaneId,
    setPendingSelection,
    setSelectedClipId,
    setStatus,
    timelineClips,
  });

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
    duplicateSourceTrack,
    deleteSourceTrack,
    moveSourceTrack,
    sourceTrackReorder,
  } = useSourceTrackActions({
    commitProjectChange,
    selectedClip,
    setSelectedClipId,
    setStatus,
    sourceTracks,
    timelineScrollRef,
  });

  const {
    openArrangementClipMenu,
    openLaneMenu,
    openLayerMenu,
    openMainAudioMenu,
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
    copySourceSpan,
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
    mainAudioId,
    mainAudioInputRef,
    moveLayer,
    moveSourceTrack,
    pasteArrangementClip,
    pendingSelection,
    playheadQRef,
    quarterPx,
    redoLabel,
    removeMainAudio,
    renamingLaneId,
    renamingSourceTrackId,
    selectLaneFromLabel,
    selectedClip,
    selectedLaneId,
    setClipMenu,
    setLayerFxEnabled,
    setPendingSelection,
    setRenamingLaneId,
    setRenamingSourceTrackId,
    setSelectedClipId,
    setSelectedLaneId,
    shortcutLabels,
    sourceSpans,
    sourceTracks,
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
    dragState,
    fps,
    fxLaneId,
    handleRedo,
    handleUndo,
    lanes,
    pendingSelection,
    playbackOriginRef,
    playheadQRef,
    selectedClip,
    setPendingSelection,
    setPlayheadQ,
    setSelectedClipId,
    setSelectedLaneId,
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
    openMainAudioMenu,
    openSourceSpanMenu,
    openSourceTrackMenu,
    sourceTracksListRef,
    sourceTrackReorder,
    renamingSourceTrackId,
    commitSourceTrackRename,
    cancelSourceTrackRename,
    getClipMenuEntries,
    getEditMenuEntries,
  };
}
