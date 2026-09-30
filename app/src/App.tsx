import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import type { ClipClipboard } from "./app/clip-ops.ts";
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESIZE_KEY_STEP,
  PREVIEW_WIDTH_STORAGE_KEY,
} from "./app/constants.ts";
import {
  getPreviewMaxWidth,
  readInspectorCollapsed,
  readPreviewWidth,
} from "./app/layout-prefs.ts";
import { getShortcutLabels } from "./app/shortcut-labels.ts";
import {
  findClipAtPlayhead,
  getClipEndQ,
  getTimelineContentEndQ,
  isClipAtPlayhead,
  quartersToSeconds,
} from "./app/timeline-math.ts";
import type {
  ArrangementClip,
  ClipMenuState,
  DragState,
  SessionMediaCheck,
  SourceSpan,
  TimelineDragState,
  TimelineSelection,
} from "./app/types.ts";
import { clamp, logClient } from "./app/util.ts";
import {
  CORRUPT_WORKSPACE_NOTICE,
  findRestoredSelection,
  formatRestoredStatus,
  isPristineProjectHistory,
} from "./app/workspace-boot.ts";
import type { WorkspaceBoot } from "./app/workspace-types.ts";
import {
  hasArrangementActivity,
  isArrangementEmptyStateDismissedOnOpen,
  shouldShowArrangementEmptyState,
} from "./arrangement-empty-state.ts";
import type { CompositionPlayerHandle } from "./CompositionPlayer";
import {
  describeClipMediaState,
  describeMediaAvailability,
  isGeneratedClip,
} from "./clip-media-state";
import { AppDialogs } from "./components/AppDialogs";
import { AppStatusBar } from "./components/AppStatusBar";
import { ArrangementEmptyState } from "./components/ArrangementEmptyState";
import { ContextMenu } from "./components/ContextMenu";
import { FxPanel } from "./components/FxPanel";
import type { ImportNoticeContent } from "./components/ImportNotice";
import type { MediaSyncPeer } from "./components/MediaSyncDialog";
import { usePrefersReducedMotion } from "./components/MediaSyncSkeleton";
import { PreviewPanel } from "./components/PreviewPanel";
import { TopBar } from "./components/TopBar";
import { ArrangementLanes } from "./components/timeline/ArrangementLanes";
import { MainAudioRow } from "./components/timeline/MainAudioRow";
import { Ruler } from "./components/timeline/Ruler";
import { SourceTracks } from "./components/timeline/SourceTracks";
import { Timeline } from "./components/timeline/Timeline";
import { TimelineToolbar } from "./components/timeline/TimelineToolbar";
import { TransportBar } from "./components/timeline/TransportBar";
import { previewDuplicateClipEffects } from "./fx-stack";
import { useClipActions } from "./hooks/useClipActions.ts";
import { useClipDrag } from "./hooks/useClipDrag.ts";
import { useClipInsertion } from "./hooks/useClipInsertion.ts";
import {
  useCollaboration,
  useCollaborationState,
} from "./hooks/useCollaboration.ts";
import { useExport, useExportState } from "./hooks/useExport.ts";
import { useFxEditing } from "./hooks/useFxEditing.ts";
import { useFxPanelModel } from "./hooks/useFxPanelModel.ts";
import { useLabelResize } from "./hooks/useLabelResize.ts";
import { useLayerActions } from "./hooks/useLayerActions.ts";
import { useMainAudio, useMainAudioDrop } from "./hooks/useMainAudio.ts";
import { useMediaHydration } from "./hooks/useMediaHydration.ts";
import {
  useMediaLibrary,
  useMediaLibraryCommands,
} from "./hooks/useMediaLibrary.ts";
import { useMediaStatus } from "./hooks/useMediaStatus.ts";
import { usePeerMedia, usePeerMediaState } from "./hooks/usePeerMedia.ts";
import { usePlayback } from "./hooks/usePlayback.ts";
import { usePreviewEditing } from "./hooks/usePreviewEditing.ts";
import { usePreviewLayers } from "./hooks/usePreviewLayers.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "./hooks/useProjectStore.ts";
import { useRulerGestures } from "./hooks/useRulerGestures.ts";
import { useSampleProject } from "./hooks/useSampleProject.ts";
import { useSessionIO } from "./hooks/useSessionIO.ts";
import { useSourceTrackDrop } from "./hooks/useSourceTrackDrop.ts";
import { useTimelineLanes } from "./hooks/useTimelineLanes.ts";
import { useTimelineThumbnails } from "./hooks/useTimelineThumbnails.ts";
import { useTimelineViewport } from "./hooks/useTimelineViewport.ts";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence.ts";
import type { MediaItem } from "./media";
import { migrateMediaCache, setCachedMediaSession } from "./media-cache";
import { useMenus } from "./menus/useMenus.ts";
import { MAX_LAYERS } from "./selection-overlaps";
import { offlineSessionMediaIds } from "./session-media.ts";
import { useKeyboardShortcuts } from "./shortcuts/useKeyboardShortcuts.ts";
import { useSpacePlayback } from "./shortcuts/useSpacePlayback.ts";
import {
  isSourceTracksSectionCollapsed,
  readSourceTracksCollapsed,
  writeSourceTracksCollapsed,
} from "./source-tracks-section.ts";
import { createSpaceHold } from "./space-shortcut";
import { loadFontFace, resolveFontFace } from "./text-fonts.ts";
import { isTextEffectName, readTextStyle } from "./text-style.ts";
import type { WorkspaceSessionSource } from "./workspace-session.ts";

function App({ boot }: { boot: WorkspaceBoot }) {
  const collaboration = useCollaborationState();
  const {
    collaborationMode,
    shareUrl,
    collaborationState,
    shareCopyResetTimeoutRef,
    collaborationView,
  } = collaboration;
  const restoredSession = boot.session;
  const [restoredSelection] = useState(() =>
    findRestoredSelection(restoredSession),
  );
  const {
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
  } = useProjectStore({ access: boot.access, restoredSession });
  const {
    timelineMode,
    signatureId,
    snapMode,
    snapEnabled,
    bpm,
    fps,
    canvasWidth,
    canvasHeight,
    zoom,
    sessionName,
    mediaItems: projectMediaItems,
    lanes,
    sourceTracks,
    sourceSpans,
    clips,
    effects,
    mainAudioId,
    projectDurationFrames,
  } = projectHistory.present;

  const [dragPreviewClips, setDragPreviewClips] = useState<
    ArrangementClip[] | null
  >(null);
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(
    restoredSelection.selectedClipId,
  );
  const [clipMenu, setClipMenu] = useState<ClipMenuState | null>(null);
  // The layer whose name is being edited in its header.
  const [renamingLaneId, setRenamingLaneId] = useState<string>();
  const renamingLaneIdRef = useRef(renamingLaneId);
  renamingLaneIdRef.current = renamingLaneId;
  // The layer the FX chain edits. Selecting a clip selects its layer, and
  // clearing the clip selection keeps the layer.
  const [selectedLaneId, setSelectedLaneId] = useState<string | undefined>(
    restoredSelection.selectedLaneId,
  );
  const [pendingSelection, setPendingSelection] =
    useState<TimelineSelection | null>(null);
  const [arrangementEmptyStateDismissed, setArrangementEmptyStateDismissed] =
    useState(() =>
      restoredSession
        ? isArrangementEmptyStateDismissedOnOpen(
            restoredSession.history.present.clips.length,
          )
        : false,
    );
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(
    readInspectorCollapsed,
  );
  const [sourceTracksCollapsedPref, setSourceTracksCollapsedPref] = useState(
    () =>
      readSourceTracksCollapsed(
        typeof window === "undefined" ? undefined : window.localStorage,
      ),
  );
  const labelResize = useLabelResize();
  const { labelWidth } = labelResize;
  const [previewWidth, setPreviewWidth] = useState(readPreviewWidth);
  const [editorGridWidth, setEditorGridWidth] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState(() =>
    restoredSession
      ? formatRestoredStatus(restoredSession)
      : "Open a session or import media to get started.",
  );
  const {
    isExporting,
    setIsExporting,
    setExportState,
    updateExportState,
    exportButtonLabel,
  } = useExportState();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [importNotice, setImportNotice] = useState<ImportNoticeContent | null>(
    () =>
      boot.corruptKey
        ? CORRUPT_WORKSPACE_NOTICE
        : (restoredSession?.importNotice ?? null),
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineDragState, setTimelineDragState] =
    useState<TimelineDragState | null>(null);
  const [isCaptureInstallerDialogOpen, setIsCaptureInstallerDialogOpen] =
    useState(false);
  const [isOfflineMediaDialogOpen, setIsOfflineMediaDialogOpen] =
    useState(false);
  const [isMediaSyncDialogOpen, setIsMediaSyncDialogOpen] = useState(false);
  const [isMediaStorageDialogOpen, setIsMediaStorageDialogOpen] =
    useState(false);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [mediaHydrationTick, setMediaHydrationTick] = useState(0);

  const [sessionSource, setSessionSource] = useState<WorkspaceSessionSource>(
    () => restoredSession?.source ?? { kind: "none" },
  );
  // True while the project is someone else's shared session, which is never
  // saved over this browser's own session.
  const viewingSharedSessionRef = useRef(boot.access === "joiner");

  const playbackOriginRef = useRef(initialPlayheadQ);
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const spaceHoldRef = useRef(createSpaceHold());
  const arrangementLanesRef = useRef<HTMLDivElement | null>(null);
  const editorGridRef = useRef<HTMLDivElement | null>(null);
  const previewResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const clipClipboardRef = useRef<ClipClipboard | null>(null);
  const mediaHydrationInFlightRef = useRef(new Set<string>());
  const sessionMediaCheckRef = useRef<SessionMediaCheck | null>(null);

  const {
    mediaItems,
    mediaItemsById,
    localMediaOverridesRef,
    setLocalMediaOverride,
    seedLocalMediaItems,
    adoptMediaBlob,
    cacheLocalMediaItems,
    handleMediaStorageCleared,
  } = useMediaLibrary({
    projectMediaItems,
    projectSnapshotRef,
    commitViewChange,
    setStatus,
  });
  const peerMedia = usePeerMediaState({
    localMediaOverridesRef,
    projectSnapshotRef,
  });
  const { remoteMediaProgress, revealedMediaIds, peerMediaMissIds } = peerMedia;
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
  const timelineClips = dragPreviewClips ?? clips;
  const timelineClipsRef = useRef(timelineClips);
  timelineClipsRef.current = timelineClips;
  // A clip being Ctrl/Cmd-dragged to duplicate it is drawn with its source
  // clip's stack; the drop commits the copy's own.
  const isDuplicateDragging = Boolean(
    dragPreviewClips && dragState?.kind === "move" && dragState.duplicateOnDrag,
  );
  const timelineEffects = useMemo(
    () =>
      isDuplicateDragging && dragState?.kind === "move"
        ? previewDuplicateClipEffects(
            effects,
            dragState.sourceClipId,
            dragState.clipId,
          )
        : effects,
    [dragState, effects, isDuplicateDragging],
  );

  const {
    editEffects,
    setLayerFxEnabled,
    setFxDeviceEnabled,
    setFxDeviceParameter,
    setFxDeviceAnimationEnabled,
    setFxDeviceAnimation,
    moveFxDevice,
    addFxDevice,
    removeFxDevice,
    resetFxDevice,
    duplicateFxDevice,
  } = useFxEditing({
    dispatchProject,
    commitProjectChange,
    lanes,
    timelineClipsRef,
  });

  const {
    timelineViewport,
    resolvedZoom,
    updateZoomDraft,
    flushZoomDraft,
    setZoomValue,
    signature,
    beatUnit,
    barLength,
    quarterPx,
    adaptiveDivision,
    snapUnit,
    totalQuarters,
    timelineWidth,
    gridStyle,
    rulerBars,
    rulerLabelBarStep,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
    visibleTimelineEndPx,
    filmstripRangeStartPx,
    filmstripRangeEndPx,
    syncTimelineViewport,
    scrollTimelineToPlayhead,
  } = useTimelineViewport({
    zoom,
    signatureId,
    snapMode,
    timelineMode,
    bpm,
    timelineClips,
    sourceSpans,
    pendingSelection,
    labelWidth,
    playheadQRef,
    timelineScrollRef,
    arrangementLanesRef,
    commitViewChange,
  });
  // Only a clip the user selected; rendering and edits never fall back to
  // another one.
  const selectedClip = useMemo(
    () => timelineClips.find((clip) => clip.id === selectedClipId),
    [selectedClipId, timelineClips],
  );
  // What the preview describes when no clip is at the playhead: the selected
  // clip, else the first. Read-only; never used to render or edit a clip.
  const inspectorClip = selectedClip ?? timelineClips[0];
  const showArrangementEmptyState = shouldShowArrangementEmptyState({
    clipCount: clips.length,
    sourceSpanCount: sourceSpans.length,
    dismissed: arrangementEmptyStateDismissed,
  });
  useEffect(() => {
    if (
      hasArrangementActivity({
        clipCount: clips.length,
        hasClipSelection: selectedClipId !== undefined,
        hasPendingSelection: pendingSelection !== null,
      })
    ) {
      setArrangementEmptyStateDismissed(true);
    }
  }, [clips.length, pendingSelection, selectedClipId]);
  const playheadClip = useMemo(
    () => findClipAtPlayhead(timelineClips, playheadQ, bpm, lanePriority),
    [bpm, lanePriority, playheadQ, timelineClips],
  );
  const previewClip = playheadClip ?? inspectorClip;
  const previewMedia = previewClip?.mediaId
    ? mediaItemsById.get(previewClip.mediaId)
    : undefined;
  const previewMediaState = previewClip
    ? describeClipMediaState(previewClip, previewMedia?.availability)
    : "offline";
  // The compositor draws every online layer at the playhead, so an offline
  // clip on one layer only covers the preview when no layer can be drawn.
  const hasOnlinePlayheadClip = useMemo(
    () =>
      timelineClips.some(
        (clip) =>
          isClipAtPlayhead(clip, playheadQ, bpm) &&
          (isGeneratedClip(clip) ||
            describeMediaAvailability(
              clip.mediaId
                ? mediaItemsById.get(clip.mediaId)?.availability
                : undefined,
            ) === "online"),
      ),
    [bpm, mediaItemsById, playheadQ, timelineClips],
  );
  const selectedClipLaneId = selectedClip?.laneId;
  useEffect(() => {
    if (selectedClipLaneId !== undefined) {
      setSelectedLaneId(selectedClipLaneId);
    }
  }, [selectedClipLaneId]);
  // The layer outlined in the preview. Selecting a clip or a layer in the
  // timeline selects it here too; Esc or a click on empty canvas clears it.
  const [previewLaneId, setPreviewLaneId] = useState<string>();
  useEffect(() => {
    if (selectedClipLaneId !== undefined) {
      setPreviewLaneId(selectedClipLaneId);
    }
  }, [selectedClipLaneId]);
  useEffect(() => {
    setPreviewLaneId(selectedLaneId);
  }, [selectedLaneId]);
  const selectLaneFromLabel = (laneId: string) => {
    setSelectedClipId(undefined);
    setSelectedLaneId(laneId);
    setPreviewLaneId(laneId);
  };
  const previewLayers = usePreviewLayers({
    clips: timelineClips,
    mediaItemsById,
    playheadQ,
    bpm,
    fps,
    projectDurationFrames,
    lanes,
    lanePriority,
    effects: timelineEffects,
    canvasWidth,
    canvasHeight,
  });
  const {
    selectPreviewLayer,
    getPreviewLayerPosition,
    movePreviewLayer,
    getPreviewLayerTransform,
    transformPreviewLayer,
    textEdit,
    finishTextEdit,
    startTextEdit,
    activatePreviewLayer,
    previewTextEdit,
  } = usePreviewEditing({
    bpm,
    editEffects,
    effects,
    isPlaying,
    lanes,
    playbackOriginRef,
    playheadQRef,
    previewLayers,
    refuseReadOnlyEdit,
    selectedClipId,
    setIsPlaying,
    setPlayheadQ,
    setPreviewLaneId,
    setSelectedClipId,
    setSelectedLaneId,
    timelineClipsRef,
  });
  const {
    fxLaneId,
    fxLane,
    fxKind,
    fxClipId,
    fxClipScope,
    orderLayerOptions,
    fxClipLayerOptions,
    fxDevices,
    fxPanelTitle,
  } = useFxPanelModel({
    lanes,
    effects,
    selectedLaneId,
    selectedClip,
    mediaItemsById,
    lanePriority,
    timelineClips,
    playheadQ,
    bpm,
  });
  useEffect(() => {
    for (const effect of effects) {
      if (effect.enabled !== false && isTextEffectName(effect.effectName)) {
        const style = readTextStyle(effect);
        void loadFontFace(
          resolveFontFace(style.font, style.weight, style.italic, new Set()),
        );
      }
    }
  }, [effects]);
  const playheadSeconds = quartersToSeconds(playheadQ, bpm);
  const mainAudioModel = useMainAudio({
    mainAudioId,
    mediaItemsById,
    remoteMediaProgress,
    projectMediaItems,
    refuseReadOnlyEdit,
    commitProjectChange,
    commitProjectPatch,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    setStatus,
  });
  const {
    mainAudio,
    currentMainWaveform,
    setIsMainAudioDropTarget,
    mainAudioInputRef,
    replaceMainAudioFromFile,
    removeMainAudio,
  } = mainAudioModel;
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
    offlineMedia,
    showsMediaSync,
    mediaSyncEntries,
    mediaSyncSummary,
    mediaSyncStatusLabel,
    offlineCount,
    sessionMediaStatus,
  } = useMediaStatus({
    mediaItems,
    timelineClips,
    sourceSpans,
    mainAudioId,
    remoteMediaProgress,
    peerMediaMissIds,
    failedSampleMediaIds: peerMedia.failedSampleMediaIds,
    collaborationMode,
    collaborationState,
  });
  const mediaSyncPeer = useMemo<MediaSyncPeer | undefined>(() => {
    const remote = collaborationState.collaborators.filter(
      (collaborator) => !collaborator.isLocal,
    );
    return remote.length === 1
      ? { name: remote[0].name, color: remote[0].color }
      : undefined;
  }, [collaborationState.collaborators]);
  const { clipsByLane, laneStatusById, sourceSpansByTrack } = useTimelineLanes({
    lanes,
    timelineClips,
    sourceSpans,
    effects,
  });
  const isSourceTracksCollapsed = isSourceTracksSectionCollapsed(
    sourceTracksCollapsedPref,
    sourceTracks.length,
  );
  // Every offline media the session references, in peer request order.
  // Serialized so the peer fetch effect only reruns when the list changes.
  const offlineSessionMediaIdsKey = useMemo(() => {
    const toRange = (clip: ArrangementClip | SourceSpan) => ({
      mediaId: clip.mediaId,
      startQ: clip.startQ,
      endQ: getClipEndQ(clip, bpm),
    });
    return JSON.stringify(
      offlineSessionMediaIds({
        availability: (mediaId) => mediaItemsById.get(mediaId)?.availability,
        mainAudioId,
        clips: clips.map(toRange),
        sourceSpans: sourceSpans.map(toRange),
        playheadQ,
        visibleStartQ: visibleTimelineStartPx / quarterPx,
        visibleEndQ: visibleTimelineEndPx / quarterPx,
      }),
    );
  }, [
    bpm,
    clips,
    mainAudioId,
    mediaItemsById,
    playheadQ,
    quarterPx,
    sourceSpans,
    visibleTimelineEndPx,
    visibleTimelineStartPx,
  ]);
  const { clipFilmstrips, spanFilmstrips, thumbnails } = useTimelineThumbnails({
    bpm,
    quarterPx,
    timelineClips,
    sourceSpans,
    mediaItemsById,
    filmstripRangeStartPx,
    filmstripRangeEndPx,
  });
  const setSourceTracksCollapsed = useCallback((collapsed: boolean) => {
    setSourceTracksCollapsedPref(collapsed);
    writeSourceTracksCollapsed(window.localStorage, collapsed);
  }, []);

  const {
    importMediaIntoSourceTrack,
    relinkingMediaIds,
    relinkOfflineMedia,
    relinkOfflineMediaItem,
  } = useMediaLibraryCommands({
    projectMediaItems,
    refuseReadOnlyEdit,
    commitProjectChange,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    setSourceTracksCollapsed,
    offlineMedia,
    mediaItemsById,
    adoptMediaBlob,
    setStatus,
  });
  const sourceTrackDrop = useSourceTrackDrop({
    mediaItems,
    sourceTracks,
    appShellRef,
    setIsMainAudioDropTarget,
    importMediaIntoSourceTrack,
  });
  const mainAudioDrop = useMainAudioDrop({
    sourceTrackDragTarget: sourceTrackDrop.sourceTrackDragTarget,
    clearSourceTrackDragState: sourceTrackDrop.clearSourceTrackDragState,
    setIsMainAudioDropTarget,
    replaceMainAudioFromFile,
    setStatus,
  });

  const shortcutLabels = useMemo(() => getShortcutLabels(), []);
  const previewMaxWidth = getPreviewMaxWidth(editorGridWidth);
  const effectivePreviewWidth = Math.min(previewWidth, previewMaxWidth);

  useEffect(() => {
    const editorGrid = editorGridRef.current;
    if (!editorGrid) {
      return;
    }

    setEditorGridWidth(editorGrid.clientWidth);
    const observer = new ResizeObserver(() => {
      setEditorGridWidth(editorGrid.clientWidth);
    });
    observer.observe(editorGrid);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (shareCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(shareCopyResetTimeoutRef.current);
      }
    },
    [shareCopyResetTimeoutRef],
  );

  const { rulerDragScroll, timelineDragScroll } = useRulerGestures({
    shortcutLabels,
    resolvedZoom,
    labelWidth,
    totalQuarters,
    prefersReducedMotion,
    timelineScrollRef,
    spaceHoldRef,
    updateZoomDraft,
    flushZoomDraft,
  });

  const {
    isTimelineAudibleScrubbing,
    startPlayback,
    cancelScrubPlaybackResume,
    jumpToClipStart,
    stopTimelineAudibleScrub,
    pulseTimelineAudibleScrub,
    handleTransportToggle,
    jumpPlayhead,
  } = usePlayback({
    playbackOriginRef,
    clips,
    timelineClips,
    timelineClipsRef,
    projectMediaItems,
    bpm,
    barLength,
    quarterPx,
    totalQuarters,
    labelWidth,
    timelineScrollRef,
    isPlaying,
    setIsPlaying,
    timelineDragState,
    setTimelineDragState,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    setPlayheadQState,
    setPendingSelection,
    setSelectedClipId,
    setStatus,
  });

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

  const { handleUndo, handleRedo } = useProjectHistoryCommands({
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
  });

  const {
    flushWorkspaceSession,
    claimWorkspaceSession,
    handleTakeOverWorkspace,
    handleOpenWorkspaceReadOnly,
    handleCloseSession,
    reportSessionMediaCheck,
    settleSessionMediaCheck,
  } = useWorkspacePersistence({
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
    collaborationMode,
    viewingSharedSessionRef,
    sessionMediaCheckRef,
    setStatus,
  });

  // Media an undo or redo step still uses counts as part of the session too,
  // since the history survives a refresh. Keyed by the sorted ids so the
  // cache index is only rewritten when the set changes.
  const sessionMediaIdsKey = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<MediaItem[]>();
    for (const snapshot of [
      projectHistory.present,
      ...projectHistory.past.map((entry) => entry.snapshot),
      ...projectHistory.future.map((entry) => entry.snapshot),
    ]) {
      if (seen.has(snapshot.mediaItems)) {
        continue;
      }
      seen.add(snapshot.mediaItems);
      for (const item of snapshot.mediaItems) {
        ids.add(item.id);
      }
    }
    return JSON.stringify([...ids].sort());
  }, [projectHistory.past, projectHistory.present, projectHistory.future]);

  // Runs before hydration so media the open session uses is never evicted to
  // make room for its other files.
  useEffect(() => {
    setCachedMediaSession(
      sessionName ?? "Untitled session",
      JSON.parse(sessionMediaIdsKey) as string[],
    ).catch((error) => {
      logClient("media:cache:session:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [sessionMediaIdsKey, sessionName]);

  useEffect(() => {
    migrateMediaCache()
      .then((moved) => {
        if (moved) {
          logClient("media:cache:migrated", { moved });
        }
      })
      .catch((error) => {
        logClient("media:cache:migrate:error", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  const { retrySampleMedia } = useMediaHydration({
    projectMediaItems,
    localMediaOverridesRef,
    mediaHydrationTick,
    setMediaHydrationTick,
    mediaHydrationInFlightRef,
    projectSnapshotRef,
    setLocalMediaOverride,
    adoptMediaBlob,
    peerMedia,
    settleSessionMediaCheck,
    setStatus,
  });

  const {
    showShareCopiedBadge,
    handleStartShare,
    handleStopShare,
    handleDisconnectConnection,
    handleConnectToShare,
  } = useCollaboration({
    collaboration,
    projectState: projectHistory.present,
    projectSnapshotRef,
    dispatchProjectHistory,
    setIsPlaying,
    stopTimelineAudibleScrub,
    setDragPreviewClips,
    setDragState,
    setPendingSelection,
    setTimelineDragState,
    appShellRef,
    resolvePeerMedia: peerMedia.resolvePeerMedia,
    abortPeerMediaTransfers: peerMedia.abortPeerMediaTransfers,
    flushWorkspaceSession,
    viewingSharedSessionRef,
    setStatus,
  });
  const { retryPeerMedia } = usePeerMedia({
    peerMedia,
    collaborationMode,
    collaborationControllerRef: collaboration.collaborationControllerRef,
    mediaPeerCount: collaborationState.mediaPeerCount,
    mainAudioId,
    offlineSessionMediaIdsKey,
    mediaHydrationTick,
    setMediaHydrationTick,
    mediaHydrationInFlightRef,
    projectSnapshotRef,
    setLocalMediaOverride,
    adoptMediaBlob,
    setStatus,
  });

  useSpacePlayback({
    cancelScrubPlaybackResume,
    clipCount: clips.length,
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

  // Selects `laneId` and focuses its header once it has rendered.
  function focusLaneLabel(laneId: string) {
    selectLaneFromLabel(laneId);
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          `[data-lane-label-id="${CSS.escape(laneId)}"]`,
        )
        ?.focus();
    }, 0);
  }

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
    openArrangementClipMenu,
    openLaneMenu,
    openLayerMenu,
    openMainAudioMenu,
    openSourceSpanMenu,
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
    duplicateArrangementClip,
    duplicateLayer,
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
    pasteArrangementClip,
    pendingSelection,
    playheadQRef,
    quarterPx,
    redoLabel,
    removeMainAudio,
    renamingLaneId,
    selectLaneFromLabel,
    selectedClip,
    selectedLaneId,
    setClipMenu,
    setLayerFxEnabled,
    setPendingSelection,
    setRenamingLaneId,
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

  // The empty arrangement's call to action sizes itself below the ruler.
  useEffect(() => {
    if (showArrangementEmptyState) {
      syncTimelineViewport();
    }
  }, [showArrangementEmptyState, syncTimelineViewport]);

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

  const {
    openSamplePayload,
    handleImport,
    handleOpenSession,
    handleOpenWorkspace,
    handleSaveSession,
  } = useSessionIO({
    projectHistory,
    commitProjectChange,
    commitViewChange,
    sessionName,
    mediaItems,
    projectMediaItems,
    playheadQRef,
    setPlayheadQ,
    selectedClipId,
    setSelectedClipId,
    setSelectedLaneId,
    sessionSource,
    setSessionSource,
    setImportNotice,
    setDragPreviewClips,
    setPendingSelection,
    setArrangementEmptyStateDismissed,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    localMediaOverridesRef,
    sessionMediaCheckRef,
    claimWorkspaceSession,
    reportSessionMediaCheck,
    refuseReadOnlyEdit,
    setStatus,
  });
  const sample = useSampleProject({
    boot,
    isPristine: () => isPristineProjectHistory(projectHistory),
    refuseReadOnlyEdit,
    openSamplePayload,
    setStatus,
  });

  const {
    openExportDialog,
    reopenExportDialog,
    dismissExportActivity,
    exportDialog,
    exportActivity,
  } = useExport({
    isExporting,
    setIsExporting,
    setExportState,
    updateExportState,
    project: projectHistory.present,
    mediaItems,
    mainAudio,
    mainAudioPeaks: currentMainWaveform?.peaks,
    signature,
    beatUnit,
    isPlaying,
    setIsPlaying,
    setStatus,
  });

  function toggleInspectorCollapsed() {
    const nextCollapsed = !isInspectorCollapsed;
    setIsInspectorCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(
        INSPECTOR_COLLAPSED_STORAGE_KEY,
        String(nextCollapsed),
      );
    } catch {
      // Storage can be unavailable (private mode, quota); the toggle still works.
    }
  }

  function commitPreviewWidth(nextWidth: number) {
    const width = clamp(
      Math.round(nextWidth),
      PREVIEW_MIN_WIDTH,
      previewMaxWidth,
    );
    setPreviewWidth(width);
    try {
      window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function handlePreviewResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectivePreviewWidth,
    };
  }

  function handlePreviewResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = previewResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    // The panel sits to the right of the handle, so dragging left widens it.
    commitPreviewWidth(resize.startWidth + resize.startX - event.clientX);
  }

  function handlePreviewResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (previewResizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    previewResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePreviewResizeKeyDown(
    event: ReactKeyboardEvent<HTMLHRElement>,
  ) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = effectivePreviewWidth + PREVIEW_RESIZE_KEY_STEP;
        break;
      case "ArrowRight":
        nextWidth = effectivePreviewWidth - PREVIEW_RESIZE_KEY_STEP;
        break;
      case "Home":
        nextWidth = PREVIEW_MIN_WIDTH;
        break;
      case "End":
        nextWidth = previewMaxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitPreviewWidth(nextWidth);
  }

  return (
    <div className="app-shell" ref={appShellRef}>
      {collaborationView.remoteCursors.length ? (
        <div className="collaboration-cursor-layer" aria-hidden="true">
          {collaborationView.remoteCursors.map((cursor) => (
            <div
              key={cursor.clientId}
              className="collaboration-cursor"
              style={{
                left: `${cursor.x * 100}%`,
                top: `${cursor.y * 100}%`,
                color: cursor.color,
              }}
            >
              <svg viewBox="0 0 20 20" role="presentation">
                <path
                  d="M3 2.5v12.7c0 .6.72.9 1.14.48l3.2-3.12l2.32 4.34a.9.9 0 0 0 1.22.37l1.56-.8a.9.9 0 0 0 .37-1.22L10.5 11l4.45-.56c.6-.08.84-.81.39-1.22L3.97 1.88A.67.67 0 0 0 3 2.5Z"
                  fill="currentColor"
                />
              </svg>
              <span
                className="collaboration-cursor__label"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <TopBar
        bpm={bpm}
        collaboration={collaboration}
        commitProjectChange={commitProjectChange}
        exportButtonLabel={exportButtonLabel}
        getEditMenuEntries={getEditMenuEntries}
        handleCloseSession={handleCloseSession}
        handleDisconnectConnection={handleDisconnectConnection}
        handleImport={handleImport}
        handleOpenSession={handleOpenSession}
        handleOpenWorkspace={handleOpenWorkspace}
        handleSaveSession={handleSaveSession}
        handleStopShare={handleStopShare}
        isExporting={isExporting}
        offlineMedia={offlineMedia}
        openExportDialog={openExportDialog}
        projectHistory={projectHistory}
        renamingLaneIdRef={renamingLaneIdRef}
        sample={sample}
        setIsCaptureInstallerDialogOpen={setIsCaptureInstallerDialogOpen}
        setIsMediaStorageDialogOpen={setIsMediaStorageDialogOpen}
        setIsMediaSyncDialogOpen={setIsMediaSyncDialogOpen}
        setIsOfflineMediaDialogOpen={setIsOfflineMediaDialogOpen}
        setIsSessionSettingsOpen={setIsSessionSettingsOpen}
        setStatus={setStatus}
        showShareCopiedBadge={showShareCopiedBadge}
        showsMediaSync={showsMediaSync}
      />

      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <TimelineToolbar
              playheadSignal={playheadSignal}
              bpm={bpm}
              fps={fps}
              signature={signature}
              timelineMode={timelineMode}
              snapMode={snapMode}
              adaptiveDivision={adaptiveDivision}
              snapEnabled={snapEnabled}
              signatureId={signatureId}
              lanes={lanes}
              canCreateLayer={canCreateLayer}
              commitProjectPatch={commitProjectPatch}
              onCreateLayer={handleCreateLayer}
            />

            <div
              ref={editorGridRef}
              className="editor-grid"
              style={{
                ["--preview-width" as string]: `${effectivePreviewWidth}px`,
              }}
            >
              <Timeline
                timelineScrollRef={timelineScrollRef}
                timelineDragScroll={timelineDragScroll}
                labelResize={labelResize}
                playheadQ={playheadQ}
                playheadSignal={playheadSignal}
                quarterPx={quarterPx}
                timelineWidth={timelineWidth}
                visibleTimelineStartPx={visibleTimelineStartPx}
                visibleTimelineWidthPx={visibleTimelineWidthPx}
                visibleTimelineEndPx={visibleTimelineEndPx}
                syncTimelineViewport={syncTimelineViewport}
                scrollTimelineToPlayhead={scrollTimelineToPlayhead}
              >
                <Ruler
                  rulerDragScroll={rulerDragScroll}
                  sessionName={sessionName}
                  mediaSyncStatusLabel={mediaSyncStatusLabel}
                  offlineCount={offlineCount}
                  showsMediaSync={showsMediaSync}
                  relinkingMediaIds={relinkingMediaIds}
                  sessionMediaStatus={sessionMediaStatus}
                  setIsMediaSyncDialogOpen={setIsMediaSyncDialogOpen}
                  setIsOfflineMediaDialogOpen={setIsOfflineMediaDialogOpen}
                  timelineScrollRef={timelineScrollRef}
                  shortcutLabels={shortcutLabels}
                  timelineDragState={timelineDragState}
                  setTimelineDragState={setTimelineDragState}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  pulseTimelineAudibleScrub={pulseTimelineAudibleScrub}
                  stopTimelineAudibleScrub={stopTimelineAudibleScrub}
                  setPlayheadQ={setPlayheadQ}
                  playbackOriginRef={playbackOriginRef}
                  playheadSignal={playheadSignal}
                  labelWidth={labelWidth}
                  quarterPx={quarterPx}
                  totalQuarters={totalQuarters}
                  resolvedZoom={resolvedZoom}
                  gridStyle={gridStyle}
                  rulerBars={rulerBars}
                  rulerLabelBarStep={rulerLabelBarStep}
                  timelineMode={timelineMode}
                  bpm={bpm}
                  fps={fps}
                />
                <ArrangementLanes
                  arrangementLanesRef={arrangementLanesRef}
                  lanes={lanes}
                  fxLaneId={fxLaneId}
                  laneStatusById={laneStatusById}
                  clipsByLane={clipsByLane}
                  emptyState={
                    showArrangementEmptyState ? (
                      <ArrangementEmptyState
                        onDismiss={() =>
                          setArrangementEmptyStateDismissed(true)
                        }
                        onGenerate={handleRandomizeTimeline}
                        top={timelineViewport.lanesTop}
                        visibleHeight={
                          timelineViewport.clientHeight -
                          timelineViewport.lanesTop
                        }
                        visibleWidth={visibleTimelineWidthPx}
                      />
                    ) : null
                  }
                  header={{
                    layerReorder,
                    renamingLaneId,
                    setRenamingLaneId,
                    openLayerMenu,
                    selectLaneFromLabel,
                    focusLaneLabel,
                    commitLayerRename,
                    setLayerFxEnabled,
                  }}
                  row={{
                    openLaneMenu,
                    shortcutLabels,
                    timelineScrollRef,
                    labelWidth,
                    quarterPx,
                    totalQuarters,
                    snapUnit,
                    snapEnabled,
                    gridStyle,
                    pendingSelection,
                    setPendingSelection,
                    setSelectedClipId,
                    setSelectedLaneId,
                    setIsPlaying,
                    setDragPreviewClips,
                    setDragState,
                    clipCard: {
                      selectedClipId: selectedClip?.id,
                      dragState,
                      bpm,
                      quarterPx,
                      signature,
                      mediaItemsById,
                      thumbnails,
                      clipFilmstrips,
                      remoteMediaProgress,
                      timelineEffects,
                      effects,
                      prefersReducedMotion,
                      revealedMediaIds,
                      shortcutLabels,
                      openArrangementClipMenu,
                      startTextEdit,
                      setPendingSelection,
                      setDragPreviewClips,
                      setSelectedClipId,
                      setDragState,
                    },
                  }}
                />
                <MainAudioRow
                  audio={mainAudioModel}
                  drop={mainAudioDrop}
                  openMainAudioMenu={openMainAudioMenu}
                  prefersReducedMotion={prefersReducedMotion}
                  bpm={bpm}
                  quarterPx={quarterPx}
                  visibleTimelineStartPx={visibleTimelineStartPx}
                  visibleTimelineWidthPx={visibleTimelineWidthPx}
                  gridStyle={gridStyle}
                />
                <SourceTracks
                  sourceTracks={sourceTracks}
                  sourceSpansByTrack={sourceSpansByTrack}
                  isSourceTracksCollapsed={isSourceTracksCollapsed}
                  setSourceTracksCollapsed={setSourceTracksCollapsed}
                  drop={sourceTrackDrop}
                  importMediaIntoSourceTrack={importMediaIntoSourceTrack}
                  clips={clips}
                  setSelectedClipId={setSelectedClipId}
                  onImport={() => void handleImport()}
                  onOpenSample={sample.handleOpenSample}
                  onOpenSession={() => void handleOpenSession()}
                  gridStyle={gridStyle}
                  span={{
                    bpm,
                    quarterPx,
                    mediaItemsById,
                    thumbnails,
                    spanFilmstrips,
                    remoteMediaProgress,
                    prefersReducedMotion,
                    revealedMediaIds,
                    clipMenu,
                    shortcutLabels,
                    addSourceSpanToArrangement,
                    openSourceSpanMenu,
                  }}
                />
              </Timeline>

              <PreviewPanel
                activatePreviewLayer={activatePreviewLayer}
                bpm={bpm}
                canvasHeight={canvasHeight}
                canvasWidth={canvasWidth}
                commitPreviewWidth={commitPreviewWidth}
                compositionPlayerRef={compositionPlayerRef}
                effectivePreviewWidth={effectivePreviewWidth}
                fps={fps}
                getPreviewLayerPosition={getPreviewLayerPosition}
                getPreviewLayerTransform={getPreviewLayerTransform}
                handlePreviewResizeKeyDown={handlePreviewResizeKeyDown}
                handlePreviewResizePointerDown={handlePreviewResizePointerDown}
                handlePreviewResizePointerEnd={handlePreviewResizePointerEnd}
                handlePreviewResizePointerMove={handlePreviewResizePointerMove}
                hasOnlinePlayheadClip={hasOnlinePlayheadClip}
                isPlaying={isPlaying}
                isTimelineAudibleScrubbing={isTimelineAudibleScrubbing}
                lanes={lanes}
                mainAudio={mainAudio}
                mediaItems={mediaItems}
                movePreviewLayer={movePreviewLayer}
                playheadQ={playheadQ}
                playheadSeconds={playheadSeconds}
                playheadSignal={playheadSignal}
                previewClip={previewClip}
                previewLaneId={previewLaneId}
                previewLayers={previewLayers}
                previewMaxWidth={previewMaxWidth}
                previewMedia={previewMedia}
                previewMediaState={previewMediaState}
                previewTextEdit={previewTextEdit}
                projectDurationFrames={projectDurationFrames}
                selectPreviewLayer={selectPreviewLayer}
                selectedClip={selectedClip}
                textEdit={textEdit}
                timelineClips={timelineClips}
                timelineDragState={timelineDragState}
                timelineEffects={timelineEffects}
                transformPreviewLayer={transformPreviewLayer}
              />
            </div>

            <TransportBar
              resolvedZoom={resolvedZoom}
              setZoomValue={setZoomValue}
              updateZoomDraft={updateZoomDraft}
              flushZoomDraft={flushZoomDraft}
              isPlaying={isPlaying}
              jumpPlayhead={jumpPlayhead}
              onTransportToggle={handleTransportToggle}
              onRandomize={handleRandomizeTimeline}
            />
          </section>

          <FxPanel
            addFxDevice={addFxDevice}
            duplicateFxDevice={duplicateFxDevice}
            fxClipId={fxClipId}
            fxClipLayerOptions={fxClipLayerOptions}
            fxClipScope={fxClipScope}
            fxDevices={fxDevices}
            fxKind={fxKind}
            fxLane={fxLane}
            fxLaneId={fxLaneId}
            fxPanelTitle={fxPanelTitle}
            isInspectorCollapsed={isInspectorCollapsed}
            moveFxDevice={moveFxDevice}
            orderLayerOptions={orderLayerOptions}
            removeFxDevice={removeFxDevice}
            resetFxDevice={resetFxDevice}
            setFxDeviceAnimation={setFxDeviceAnimation}
            setFxDeviceAnimationEnabled={setFxDeviceAnimationEnabled}
            setFxDeviceEnabled={setFxDeviceEnabled}
            setFxDeviceParameter={setFxDeviceParameter}
            setLayerFxEnabled={setLayerFxEnabled}
            toggleInspectorCollapsed={toggleInspectorCollapsed}
          />
        </div>
      </main>

      <AppDialogs
        collaboration={collaboration}
        commitProjectChange={commitProjectChange}
        exportDialog={exportDialog}
        handleConnectToShare={handleConnectToShare}
        handleMediaStorageCleared={handleMediaStorageCleared}
        handleOpenWorkspaceReadOnly={handleOpenWorkspaceReadOnly}
        handleStartShare={handleStartShare}
        handleTakeOverWorkspace={handleTakeOverWorkspace}
        importNotice={importNotice}
        isCaptureInstallerDialogOpen={isCaptureInstallerDialogOpen}
        isMediaStorageDialogOpen={isMediaStorageDialogOpen}
        isMediaSyncDialogOpen={isMediaSyncDialogOpen}
        isOfflineMediaDialogOpen={isOfflineMediaDialogOpen}
        isSessionSettingsOpen={isSessionSettingsOpen}
        isTakeOverPromptOpen={isTakeOverPromptOpen}
        isWorkspaceReadOnly={isWorkspaceReadOnly}
        mediaItemsById={mediaItemsById}
        mediaSyncEntries={mediaSyncEntries}
        mediaSyncPeer={mediaSyncPeer}
        mediaSyncSummary={mediaSyncSummary}
        offlineMedia={offlineMedia}
        projectHistory={projectHistory}
        relinkOfflineMedia={relinkOfflineMedia}
        relinkOfflineMediaItem={relinkOfflineMediaItem}
        relinkingMediaIds={relinkingMediaIds}
        retryPeerMedia={retryPeerMedia}
        retrySampleMedia={retrySampleMedia}
        setImportNotice={setImportNotice}
        setIsCaptureInstallerDialogOpen={setIsCaptureInstallerDialogOpen}
        setIsMediaStorageDialogOpen={setIsMediaStorageDialogOpen}
        setIsMediaSyncDialogOpen={setIsMediaSyncDialogOpen}
        setIsOfflineMediaDialogOpen={setIsOfflineMediaDialogOpen}
        setIsSessionSettingsOpen={setIsSessionSettingsOpen}
        setIsTakeOverPromptOpen={setIsTakeOverPromptOpen}
        workspaceAccess={workspaceAccess}
      />
      <AppStatusBar
        bpm={bpm}
        canvasHeight={canvasHeight}
        canvasWidth={canvasWidth}
        clipCount={timelineClips.length}
        collaborationMode={collaborationMode}
        collaborationState={collaborationState}
        dismissExportActivity={dismissExportActivity}
        exportActivity={exportActivity}
        fps={fps}
        offlineCount={offlineCount}
        playheadSignal={playheadSignal}
        previewMedia={previewMedia}
        reopenExportDialog={reopenExportDialog}
        sessionName={sessionName}
        setIsSessionSettingsOpen={setIsSessionSettingsOpen}
        shareUrl={shareUrl}
        signature={signature}
        status={status}
        timelineMode={timelineMode}
        trackCount={lanes.length}
      />
      <ContextMenu
        anchor={clipMenu?.anchor ?? null}
        entries={clipMenu ? getClipMenuEntries(clipMenu) : []}
        label={
          clipMenu?.kind === "span"
            ? "Source clip actions"
            : clipMenu?.kind === "layer"
              ? "Layer header actions"
              : clipMenu?.kind === "audio"
                ? "Main audio actions"
                : clipMenu?.kind === "lane"
                  ? "Layer actions"
                  : clipMenu?.kind === "selection"
                    ? "Selection actions"
                    : "Clip actions"
        }
        onClose={() => setClipMenu(null)}
      />
    </div>
  );
}

export default App;
