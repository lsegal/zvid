import {
  ArrowPathRoundedSquareIcon,
  ArrowUpTrayIcon,
  BackwardIcon,
  Bars3Icon,
  ChevronDownIcon,
  ForwardIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/solid";
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
import { type ClipClipboard, cloneClipAtStartQ } from "./app/clip-ops.ts";
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_KEYBOARD_STEP,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_NARROW,
  LABEL_WIDTH_STORAGE_KEY,
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESIZE_KEY_STEP,
  PREVIEW_WIDTH_STORAGE_KEY,
  SIGNATURES,
  SNAP_OPTIONS,
  TIMELINE_DRAG_EPSILON,
  TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS,
} from "./app/constants.ts";
import {
  CLIP_FILMSTRIP_HEIGHT_PX,
  type Filmstrip,
  getFilmstripTileOwner,
  SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
} from "./app/filmstrip.ts";
import { formatDuration } from "./app/format.ts";
import {
  clampLabelWidth,
  getPreviewMaxWidth,
  readInspectorCollapsed,
  readLabelWidth,
  readPreviewWidth,
} from "./app/layout-prefs.ts";
import { patchProjectState } from "./app/session-project.ts";
import { getShortcutLabels } from "./app/shortcut-labels.ts";
import {
  findClipAtPlayhead,
  findClosestTimelineLaneId,
  getClipDurationQ,
  getClipEndQ,
  getTimelineContentEndQ,
  isClipAtPlayhead,
  quartersToSeconds,
  resolveClipOverlapPreview,
  snapQuarterValue,
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
import {
  clamp,
  getDraggedMediaFiles,
  getNextLaneNumber,
  getSwatch,
  logClient,
  pluralize,
} from "./app/util.ts";
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
import {
  CompositionPlayer,
  type CompositionPlayerHandle,
} from "./CompositionPlayer";
import {
  getClipFilmstripTiles,
  getFilmstripDecodeSize,
  getFilmstripTileWidthPx,
  getSourceSpanFilmstripClip,
} from "./clip-filmstrip.ts";
import { isClipJumpPress } from "./clip-jump.ts";
import {
  describeClipMediaState,
  describeMediaAvailability,
  describePreviewMediaState,
  formatClipMediaState,
  isGeneratedClip,
  isPlaceholderClip,
} from "./clip-media-state";
import { ArrangementEmptyState } from "./components/ArrangementEmptyState";
import {
  APP_BUILD_LABEL,
  BrandMark,
  openBuildCommit,
} from "./components/BrandMark";
import { CaptureInstallerDialog } from "./components/CaptureInstallerDialog";
import { CollaborationDetailCard } from "./components/CollaborationDetailCard";
import { ContextMenu } from "./components/ContextMenu";
import { DropdownMenuEntries } from "./components/DropdownMenuEntries";
import { FxChain } from "./components/FxChain";
import {
  ImportNotice,
  type ImportNoticeContent,
} from "./components/ImportNotice";
import { LayerNameInput } from "./components/LayerNameInput";
import {
  PlayheadLine,
  TransportPlayheadReadout,
} from "./components/LivePlayhead";
import { MediaStorageDialog } from "./components/MediaStorageDialog";
import {
  MediaSyncDialog,
  type MediaSyncPeer,
} from "./components/MediaSyncDialog";
import {
  MediaSyncSkeleton,
  usePrefersReducedMotion,
} from "./components/MediaSyncSkeleton";
import { OfflineMediaDialog } from "./components/OfflineMediaDialog";
import { PreviewTransformOverlay } from "./components/PreviewTransformOverlay";
import { ShareLinkIconButton } from "./components/ShareLinkButton";
import { StatusBar, type StatusMessage } from "./components/StatusBar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { WandIcon } from "./components/WandIcon";
import {
  computeActiveClips,
  resolveAnimatedOrder,
  resolveFrameEffects,
} from "./composition-active-clips.ts";
import { isContextMenuPress } from "./context-menu.ts";
import { isRulerPanPress } from "./drag-scroll.ts";
import { isFillClip } from "./fill-clip.ts";
import {
  formatCssColor,
  formatFillPaintCss,
  resolveFillPaint,
} from "./fill-paint.ts";
import { describeFxClip, isFxClip } from "./fx-clip.ts";
import {
  clipEffectTrackId,
  copyClipEffects,
  GLOBAL_EFFECT_TRACK_ID,
  getRenderedEffects,
  isLayerFxEnabled,
  isLayoutEffectName,
  previewDuplicateClipEffects,
} from "./fx-stack";
import { getHarness, supportsHarnessCapability } from "./harness";
import { useClipActions } from "./hooks/useClipActions.ts";
import { useClipInsertion } from "./hooks/useClipInsertion.ts";
import {
  useCollaboration,
  useCollaborationState,
} from "./hooks/useCollaboration.ts";
import { useExport, useExportState } from "./hooks/useExport.ts";
import { useFxEditing } from "./hooks/useFxEditing.ts";
import { useFxPanelModel } from "./hooks/useFxPanelModel.ts";
import { useLayerActions } from "./hooks/useLayerActions.ts";
import {
  getMainAudioSkeletonStyle,
  useMainAudio,
  useMainAudioDrop,
} from "./hooks/useMainAudio.ts";
import {
  useMediaLibrary,
  useMediaLibraryCommands,
} from "./hooks/useMediaLibrary.ts";
import { useMediaStatus } from "./hooks/useMediaStatus.ts";
import { usePeerMedia, usePeerMediaState } from "./hooks/usePeerMedia.ts";
import { usePlayback } from "./hooks/usePlayback.ts";
import { usePreviewEditing } from "./hooks/usePreviewEditing.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "./hooks/useProjectStore.ts";
import { useRulerGestures } from "./hooks/useRulerGestures.ts";
import { useSessionIO } from "./hooks/useSessionIO.ts";
import { useSourceTrackDrop } from "./hooks/useSourceTrackDrop.ts";
import { useTimelineViewport } from "./hooks/useTimelineViewport.ts";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence.ts";
import {
  LANE_SELECTION_DRAG_THRESHOLD_PX,
  moveLaneSelectionGesture,
  releaseLaneSelectionGesture,
  startLaneSelectionGesture,
} from "./lane-selection-gesture.ts";
import { MainWaveform } from "./MainWaveform";
import type { MediaItem } from "./media";
import {
  cacheMediaBlob,
  getCachedMediaBlob,
  migrateMediaCache,
  setCachedMediaSession,
} from "./media-cache";
import { useMenus } from "./menus/useMenus.ts";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  getMediaSyncClassName,
} from "./peer-media-sync.ts";
import { resolvePreviewLayers } from "./preview-edit.ts";
import { selectionHint } from "./selection-hint.ts";
import { MAX_LAYERS } from "./selection-overlaps";
import { offlineSessionMediaIds } from "./session-media.ts";
import { shareLinkVisible } from "./share-link";
import { useKeyboardShortcuts } from "./shortcuts/useKeyboardShortcuts.ts";
import { useSpacePlayback } from "./shortcuts/useSpacePlayback.ts";
import { isSourceClipDropClick } from "./source-clip-drop.ts";
import {
  formatSourceTracksSummary,
  isSourceTracksSectionCollapsed,
  readSourceTracksCollapsed,
  writeSourceTracksCollapsed,
} from "./source-tracks-section.ts";
import { createSpaceHold } from "./space-shortcut";
import { statusMessageTone } from "./status-bar";
import { useStatusBarItems } from "./status-bar/useStatusBarItems.tsx";
import { isTextClip } from "./text-clip.ts";
import { loadFontFace, resolveFontFace } from "./text-fonts.ts";
import {
  getTextPreview,
  isTextEffectName,
  readTextStyle,
  resolveTextStyle,
} from "./text-style.ts";
import {
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailRequest,
  type ThumbnailSize,
} from "./thumbnail-cache.ts";
import { formatMusicalPosition, formatTimecode } from "./timeline-format.ts";
import { formatDivision } from "./timeline-grid";
import { useThumbnailCache } from "./use-thumbnail-cache";
import type { WorkspaceSessionSource } from "./workspace-session.ts";
import {
  formatZoomFactor,
  sliderPositionToZoom,
  stepZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SLIDER_STEP,
  zoomFillFraction,
  zoomToSliderPosition,
} from "./zoom";

function App({ boot }: { boot: WorkspaceBoot }) {
  const collaboration = useCollaborationState();
  const {
    collaborationMode,
    isShareDialogOpen,
    setIsShareDialogOpen,
    isStartingShare,
    isConnectDialogOpen,
    setIsConnectDialogOpen,
    connectInviteValue,
    setConnectInviteValue,
    isStartingConnect,
    hasCopiedShareInvite,
    shareUrl,
    collaborationState,
    isDiagnosticsDialogOpen,
    setIsDiagnosticsDialogOpen,
    shareCopyResetTimeoutRef,
    activeShareRoom,
    isSharing,
    isConnectedClient,
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
  const [labelWidth, setLabelWidth] = useState(readLabelWidth);
  const labelResizeRef = useRef<{
    pointerId: number;
    pointerStartX: number;
    originWidth: number;
  } | null>(null);
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
    exportStatusText,
  } = useExportState({ setStatus });
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
  const { peerMediaProgress, revealedMediaIds, peerMediaMissIds } = peerMedia;
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
  const previewLayers = useMemo(() => {
    const activeClips = computeActiveClips(
      timelineClips,
      mediaItemsById,
      playheadQ,
      bpm,
      lanePriority,
      getRenderedEffects(timelineEffects, lanes),
      fps,
    );
    return resolvePreviewLayers(
      activeClips.filter((entry) => entry.media.kind === "video"),
      { width: canvasWidth, height: canvasHeight },
      // Animated with the topmost clip, as the compositor draws it.
      resolveAnimatedOrder(
        resolveFrameEffects(timelineEffects, activeClips, playheadQ, bpm, fps),
        GLOBAL_EFFECT_TRACK_ID,
        fps,
      ),
    );
  }, [
    bpm,
    canvasHeight,
    canvasWidth,
    fps,
    lanePriority,
    lanes,
    mediaItemsById,
    playheadQ,
    timelineClips,
    timelineEffects,
  ]);
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
    isExporting,
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
  const {
    mainAudio,
    currentMainWaveform,
    mainAudioSync,
    mainWaveformMessage,
    isMainAudioDropTarget,
    setIsMainAudioDropTarget,
    mainAudioInputRef,
    replaceMainAudioFromFile,
    removeMainAudio,
  } = useMainAudio({
    mainAudioId,
    mediaItemsById,
    peerMediaProgress,
    projectMediaItems,
    refuseReadOnlyEdit,
    commitProjectChange,
    commitProjectPatch,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    setStatus,
  });
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
    inSharedMediaSession,
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
    peerMediaProgress,
    peerMediaMissIds,
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
  const clipsByLane = useMemo(() => {
    const next = new Map<string, ArrangementClip[]>();
    for (const clip of timelineClips) {
      const laneClips = next.get(clip.laneId);
      if (laneClips) {
        laneClips.push(clip);
        continue;
      }

      next.set(clip.laneId, [clip]);
    }
    return next;
  }, [timelineClips]);
  const laneStatusById = useMemo(() => {
    const next = new Map<
      string,
      {
        effectCount: number;
        fxToggle?: boolean;
        fxClassName: string;
        fxTitle?: string;
        summary: string;
      }
    >();
    for (const lane of lanes) {
      const clipCount = clipsByLane.get(lane.id)?.length ?? 0;
      // The Layout every layer has is not counted, and layer FX bypass
      // leaves it on anyway.
      const effectCount = effects.filter(
        (effect) =>
          effect.trackId === lane.id && !isLayoutEffectName(effect.effectName),
      ).length;
      const fxEnabled = isLayerFxEnabled(lane);
      const summary = [
        clipCount ? pluralize(clipCount, "clip") : "",
        !fxEnabled
          ? "FX off"
          : effectCount
            ? pluralize(effectCount, "effect")
            : "",
      ]
        .filter(Boolean)
        .join(" · ");
      next.set(lane.id, {
        effectCount,
        // Without effects the badge stays inactive and cannot be toggled.
        fxToggle: effectCount ? fxEnabled : undefined,
        fxClassName: !effectCount
          ? "track-label__fx--inactive"
          : fxEnabled
            ? ""
            : "track-label__fx--off",
        fxTitle: effectCount
          ? `Turn ${lane.name} FX ${fxEnabled ? "off" : "on"}`
          : undefined,
        summary: summary || "Empty",
      });
    }
    return next;
  }, [clipsByLane, effects, lanes]);
  const sourceSpansByTrack = useMemo(() => {
    const next = new Map<string, SourceSpan[]>();
    for (const clip of sourceSpans) {
      const trackClips = next.get(clip.sourceTrackId);
      if (trackClips) {
        trackClips.push(clip);
        continue;
      }

      next.set(clip.sourceTrackId, [clip]);
    }
    return next;
  }, [sourceSpans]);
  const isSourceTracksCollapsed = isSourceTracksSectionCollapsed(
    sourceTracksCollapsedPref,
    sourceTracks.length,
  );
  const isSourceHeaderDropTarget =
    !sourceTracks.length || isSourceTracksCollapsed;
  const minimumWindowQ = Math.max(snapUnit, beatUnit / 4);
  const mainAudioSkeletonStyle = getMainAudioSkeletonStyle({
    mainAudio,
    bpm,
    quarterPx,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
  });
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
  const pixelRatio = window.devicePixelRatio || 1;
  // The filmstrip tiles of each online video clip near the visible range.
  const clipFilmstrips = useMemo(() => {
    const filmstrips = new Map<string, Filmstrip>();
    const secondsPerPx = quartersToSeconds(1, bpm) / quarterPx;
    for (const clip of timelineClips) {
      const media = clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined;
      if (
        isPlaceholderClip(clip) ||
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        continue;
      }

      const tileWidthPx = getFilmstripTileWidthPx(
        CLIP_FILMSTRIP_HEIGHT_PX,
        media.width,
        media.height,
      );
      filmstrips.set(clip.id, {
        media,
        size: getFilmstripDecodeSize(
          tileWidthPx,
          CLIP_FILMSTRIP_HEIGHT_PX,
          pixelRatio,
        ),
        tiles: getClipFilmstripTiles({
          clip,
          mediaDurationSeconds: media.durationSeconds,
          clipLeftPx: clip.startQ * quarterPx,
          clipWidthPx: getClipDurationQ(clip, bpm) * quarterPx,
          tileWidthPx,
          secondsPerPx,
          range: { startPx: filmstripRangeStartPx, endPx: filmstripRangeEndPx },
          bpm,
        }),
      });
    }
    return filmstrips;
  }, [
    bpm,
    filmstripRangeEndPx,
    filmstripRangeStartPx,
    mediaItemsById,
    pixelRatio,
    quarterPx,
    timelineClips,
  ]);
  // The filmstrip tiles of each online video source span near the visible
  // range.
  const spanFilmstrips = useMemo(() => {
    const filmstrips = new Map<string, Filmstrip>();
    const secondsPerPx = quartersToSeconds(1, bpm) / quarterPx;
    for (const span of sourceSpans) {
      const media = span.mediaId ? mediaItemsById.get(span.mediaId) : undefined;
      if (
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        continue;
      }

      const tileWidthPx = getFilmstripTileWidthPx(
        SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
        media.width,
        media.height,
      );
      filmstrips.set(span.id, {
        media,
        size: getFilmstripDecodeSize(
          tileWidthPx,
          SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
          pixelRatio,
        ),
        tiles: getClipFilmstripTiles({
          clip: getSourceSpanFilmstripClip(span),
          mediaDurationSeconds: media.durationSeconds,
          clipLeftPx: span.startQ * quarterPx,
          clipWidthPx: getClipDurationQ(span, bpm) * quarterPx,
          tileWidthPx,
          secondsPerPx,
          range: { startPx: filmstripRangeStartPx, endPx: filmstripRangeEndPx },
          bpm,
        }),
      });
    }
    return filmstrips;
  }, [
    bpm,
    filmstripRangeEndPx,
    filmstripRangeStartPx,
    mediaItemsById,
    pixelRatio,
    quarterPx,
    sourceSpans,
  ]);
  // Source spans and layer clips share one thumbnail cache, so a frame both
  // show is decoded once. Spans show the frame at their start and clips the
  // first frame the compositor shows for them, until their own filmstrip
  // tiles are ready. That frame is decoded at the filmstrip's tile size, so it
  // is the same cache entry as the first tile.
  const thumbnailRequests = useMemo(() => {
    const requests: ThumbnailRequest<MediaItem>[] = [];
    const addRequest = (
      owner: string,
      media: MediaItem | undefined,
      size: ThumbnailSize | undefined,
      timeSeconds: (media: MediaItem) => number,
    ) => {
      if (
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        return;
      }

      const time = timeSeconds(media);
      requests.push({
        key: getThumbnailCacheKey(media.id, time, size),
        owner,
        media,
        sourceUrl: media.previewUrl,
        timeSeconds: time,
        size,
      });
    };

    for (const span of sourceSpans) {
      addRequest(
        `span:${span.id}`,
        span.mediaId ? mediaItemsById.get(span.mediaId) : undefined,
        spanFilmstrips.get(span.id)?.size,
        () => span.trimStartSeconds,
      );
    }
    for (const clip of timelineClips) {
      if (isPlaceholderClip(clip)) {
        continue;
      }

      addRequest(
        `clip:${clip.id}`,
        clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined,
        clipFilmstrips.get(clip.id)?.size,
        (media) =>
          getClipThumbnailTimeSeconds(clip, media.durationSeconds, bpm),
      );
    }
    for (const [kind, filmstrips] of [
      ["clip", clipFilmstrips],
      ["span", spanFilmstrips],
    ] as const) {
      for (const [id, { media, size, tiles }] of filmstrips) {
        for (const tile of tiles) {
          addRequest(
            getFilmstripTileOwner(kind, id, tile.index),
            media,
            size,
            () => tile.timeSeconds,
          );
        }
      }
    }
    return requests;
  }, [
    bpm,
    clipFilmstrips,
    mediaItemsById,
    sourceSpans,
    spanFilmstrips,
    timelineClips,
  ]);
  const thumbnails = useThumbnailCache(thumbnailRequests, (request, error) => {
    logClient("thumbnail:error", {
      owner: request.owner,
      mediaId: request.media.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  const playheadTimelinePx = Math.round(playheadQ * quarterPx);
  const isPlayheadOffscreenLeft =
    visibleTimelineWidthPx > 0 && playheadTimelinePx < visibleTimelineStartPx;
  const isPlayheadOffscreenRight =
    visibleTimelineWidthPx > 0 && playheadTimelinePx > visibleTimelineEndPx;
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
  const {
    sourceTrackDragTarget,
    sourceTrackDragPreview,
    isSourceTrackFileDragActive,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
    isNewSourceTrackDropTarget,
    clearSourceTrackDragState,
    scheduleSourceTrackDragClear,
    handleSourceTrackDragEvent,
  } = useSourceTrackDrop({
    mediaItems,
    sourceTracks,
    appShellRef,
    setIsMainAudioDropTarget,
    importMediaIntoSourceTrack,
  });
  const {
    handleMainAudioDragEvent,
    handleMainAudioDragLeave,
    handleMainAudioDrop,
  } = useMainAudioDrop({
    sourceTrackDragTarget,
    clearSourceTrackDragState,
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
    isExporting,
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

  useEffect(() => {
    // A hydration can outlive the run that started it: the effect reruns
    // whenever the media list changes (and at once under StrictMode), and
    // the rerun skips items still in flight. So a result is only dropped when
    // its media has left the project.
    const isRemoved = (mediaId: string) =>
      !projectSnapshotRef.current.mediaItems.some(
        (candidate) => candidate.id === mediaId,
      );

    for (const item of projectMediaItems) {
      const override = localMediaOverridesRef.current[item.id];
      const effectivePreviewUrl = override?.previewUrl ?? item.previewUrl;
      const effectiveAvailability = override?.availability ?? item.availability;
      if (effectivePreviewUrl || effectiveAvailability === "ready") {
        continue;
      }

      if (mediaHydrationInFlightRef.current.has(item.id)) {
        continue;
      }

      mediaHydrationInFlightRef.current.add(item.id);
      setLocalMediaOverride(item.id, {
        availability: item.sourcePath ? "hydrating" : "offline",
      });

      void (async () => {
        let restored = false;
        try {
          const cachedBlob = await getCachedMediaBlob(item.id);
          if (cachedBlob) {
            if (isRemoved(item.id)) {
              return;
            }

            await adoptMediaBlob(item.id, cachedBlob);
            restored = true;
            return;
          }

          if (!item.sourcePath && !item.previewUrl) {
            if (!isRemoved(item.id)) {
              setLocalMediaOverride(item.id, { availability: "offline" });
            }
            return;
          }

          const blob = await getHarness().readMediaBlob(item);
          if (isRemoved(item.id)) {
            // Keep the bytes so the next hydration pass is a cache hit.
            await cacheMediaBlob(item.id, blob);
            return;
          }

          await adoptMediaBlob(item.id, blob);
          restored = true;
        } catch (error) {
          logClient("media:hydrate:error", {
            mediaId: item.id,
            message: error instanceof Error ? error.message : String(error),
          });
          if (!isRemoved(item.id)) {
            setLocalMediaOverride(item.id, { availability: "offline" });
          }
        } finally {
          mediaHydrationInFlightRef.current.delete(item.id);
          setMediaHydrationTick((tick) => tick + 1);
          settleSessionMediaCheck(item.id, restored ? "restored" : "offline");
        }
      })();
    }
  }, [
    adoptMediaBlob,
    projectMediaItems,
    setLocalMediaOverride,
    settleSessionMediaCheck,
  ]);

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
    isExporting,
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
    isExporting,
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
    isExporting,
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

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      const shouldSnap = snapEnabled && !event.shiftKey;

      if (dragState.kind === "selection") {
        const timelineScroll = timelineScrollRef.current;
        if (!timelineScroll) {
          return;
        }

        const timelineBounds = timelineScroll.getBoundingClientRect();
        const pointerX = event.clientX - timelineBounds.left;
        const nextQ = snapQuarterValue(
          clamp(
            (timelineScroll.scrollLeft - labelWidth + pointerX) / quarterPx,
            0,
            totalQuarters,
          ),
          snapUnit,
          shouldSnap,
        );
        const { gesture, selection } = moveLaneSelectionGesture(
          dragState.gesture,
          event.clientX,
          nextQ,
          minimumWindowQ,
        );
        if (!selection) {
          return;
        }
        if (gesture !== dragState.gesture) {
          setDragState({ ...dragState, gesture });
        }
        setPendingSelection({
          id: `selection-${dragState.laneId}`,
          laneId: dragState.laneId,
          ...selection,
        });
        return;
      }

      // A read-only tab never previews a move or trim. Once the pointer
      // passes the click threshold, the drag ends and asks to take over.
      if (isWorkspaceReadOnlyRef.current) {
        if (
          Math.abs(event.clientX - dragState.pointerStartX) >
          LANE_SELECTION_DRAG_THRESHOLD_PX
        ) {
          if (dragState.kind === "move" && dragState.duplicateOnDrag) {
            setSelectedClipId(dragState.sourceClipId);
          }
          setDragState(null);
          refuseReadOnlyEdit();
        }
        return;
      }

      const deltaQuarters =
        (event.clientX - dragState.pointerStartX) / quarterPx;

      if (dragState.kind === "move") {
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          Math.max(0, totalQuarters - dragState.originDurationQ - beatUnit),
        );
        const timelineScroll = timelineScrollRef.current;
        const nextLaneId = timelineScroll
          ? findClosestTimelineLaneId(
              timelineScroll,
              event.clientY,
              dragState.originLaneId,
            )
          : dragState.originLaneId;

        if (dragState.duplicateOnDrag) {
          if (
            nextLaneId === dragState.originLaneId &&
            Math.abs(nextStartQ - dragState.originStartQ) <=
              TIMELINE_DRAG_EPSILON
          ) {
            setDragPreviewClips(null);
            return;
          }

          const sourceClip = clips.find(
            (clip) => clip.id === dragState.sourceClipId,
          );
          if (!sourceClip) {
            return;
          }

          setDragPreviewClips(
            resolveClipOverlapPreview(
              [
                ...clips,
                cloneClipAtStartQ(
                  sourceClip,
                  bpm,
                  dragState.originStartQ,
                  dragState.clipId,
                ),
              ],
              dragState.clipId,
              nextStartQ,
              dragState.originDurationQ,
              bpm,
              nextLaneId,
            ),
          );
          return;
        }

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            dragState.originDurationQ,
            bpm,
            nextLaneId,
          ),
        );
        return;
      }

      if (dragState.kind === "resize-start") {
        const fixedEndQ = dragState.originStartQ + dragState.originDurationQ;
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          fixedEndQ - minimumWindowQ,
        );
        const nextDurationQ = Math.max(minimumWindowQ, fixedEndQ - nextStartQ);

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            nextDurationQ,
            bpm,
          ),
        );
        return;
      }

      const rawEndQ =
        dragState.originStartQ + dragState.originDurationQ + deltaQuarters;
      const nextEndQ = snapQuarterValue(rawEndQ, snapUnit, shouldSnap);
      const nextDurationQ = Math.max(
        minimumWindowQ,
        nextEndQ - dragState.originStartQ,
      );

      setDragPreviewClips(
        resolveClipOverlapPreview(
          clips,
          dragState.clipId,
          dragState.originStartQ,
          nextDurationQ,
          bpm,
        ),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      // A press released before it became a drag is a click: it seeks
      // instead of leaving a selection behind.
      if (dragState.kind === "selection") {
        const release = releaseLaneSelectionGesture(dragState.gesture);
        if (release.kind === "click") {
          setPendingSelection(null);
          setPlayheadQ(release.playheadQ);
          playbackOriginRef.current = release.playheadQ;
        }
      }

      if (dragState.kind !== "selection" && dragPreviewClips) {
        const historyLabel =
          dragState.kind === "move"
            ? dragState.duplicateOnDrag
              ? "Duplicate clip"
              : "Move clip"
            : dragState.kind === "resize-start"
              ? "Trim clip start"
              : "Trim clip end";
        commitProjectChange(historyLabel, (current) =>
          patchProjectState(current, {
            clips: dragPreviewClips,
            // A clip duplicated by dragging gets a copy of the stack.
            ...(dragState.kind === "move" && dragState.duplicateOnDrag
              ? {
                  effects: copyClipEffects(current.effects, [
                    [dragState.sourceClipId, dragState.clipId],
                  ]),
                }
              : {}),
          }),
        );
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
        // Released where it was pressed, a Ctrl/Cmd-press is a click.
        if (
          dragState.jumpOnClick &&
          Math.abs(event.clientX - dragState.pointerStartX) <=
            LANE_SELECTION_DRAG_THRESHOLD_PX
        ) {
          jumpToClipStart(dragState.sourceClipId);
        }
      }

      setDragPreviewClips(null);
      setDragState(null);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
      }

      setDragPreviewClips(null);
      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [
    beatUnit,
    bpm,
    clips,
    commitProjectChange,
    dragPreviewClips,
    dragState,
    jumpToClipStart,
    minimumWindowQ,
    refuseReadOnlyEdit,
    setPlayheadQ,
    snapEnabled,
    labelWidth,
    quarterPx,
    snapUnit,
    totalQuarters,
  ]);

  const {
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

  const { handleExport } = useExport({
    isExporting,
    setIsExporting,
    setExportState,
    updateExportState,
    clips,
    timelineClips,
    mediaItems,
    lanes,
    effects,
    mainAudio,
    bpm,
    fps,
    canvasWidth,
    canvasHeight,
    sessionName,
    playheadQRef,
    compositionPlayerRef,
    setIsPlaying,
    setStatus,
  });

  function selectSource(sourceTrackId: string) {
    const match = clips.find((clip) => clip.sourceTrackId === sourceTrackId);
    if (match) {
      // Selecting never moves the playhead.
      setSelectedClipId(match.id);
    }
  }

  function commitLabelWidth(width: number) {
    const nextWidth = clampLabelWidth(width);
    setLabelWidth(nextWidth);
    try {
      window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

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

  function handleLabelResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    labelResizeRef.current = {
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      originWidth: labelWidth,
    };
  }

  function handleLabelResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    setLabelWidth(
      clampLabelWidth(
        resize.originWidth + event.clientX - resize.pointerStartX,
      ),
    );
  }

  function handleLabelResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    labelResizeRef.current = null;
    commitLabelWidth(
      event.type === "pointercancel"
        ? labelWidth
        : resize.originWidth + event.clientX - resize.pointerStartX,
    );
  }

  function handleLabelResizeKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = labelWidth - LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "ArrowRight":
        nextWidth = labelWidth + LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "Home":
        nextWidth = LABEL_WIDTH_MIN;
        break;
      case "End":
        nextWidth = LABEL_WIDTH_MAX;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitLabelWidth(nextWidth);
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

  const statusMessage = useMemo<StatusMessage>(
    () =>
      exportStatusText
        ? {
            text: exportStatusText,
            tone: statusMessageTone(exportStatusText),
            sticky: true,
          }
        : { text: status, tone: statusMessageTone(status) },
    [exportStatusText, status],
  );

  const statusBarItems = useStatusBarItems({
    bpm,
    canvasHeight,
    canvasWidth,
    clipCount: timelineClips.length,
    collaborationMode,
    collaborationState,
    fps,
    offlineCount,
    playheadSignal,
    previewMedia,
    sessionName,
    shareUrl,
    signature,
    timelineMode,
    trackCount: lanes.length,
  });

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
      <header className="topbar">
        <div className="topbar__group">
          <BrandMark onStatus={setStatus} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ghost-button file-menu-button" type="button">
                <span>File</span>
                <span className="file-menu-button__chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16" role="presentation">
                    <path
                      d="M4.47 6.22a.75.75 0 0 1 1.06.03L8 8.84l2.47-2.59a.75.75 0 1 1 1.08 1.04l-3.01 3.16a.75.75 0 0 1-1.08 0L4.44 7.29a.75.75 0 0 1 .03-1.07Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void handleOpenSession()}>
                Open Session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleOpenWorkspace()}>
                Open Workspace
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
              {inSharedMediaSession ? (
                <DropdownMenuItem
                  onSelect={() => setIsMediaSyncDialogOpen(true)}
                >
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
                {isConnectedClient
                  ? "Disconnect from Share"
                  : "Connect to Share"}
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
                <span className="file-menu-button__chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16" role="presentation">
                    <path
                      d="M4.47 6.22a.75.75 0 0 1 1.06.03L8 8.84l2.47-2.59a.75.75 0 1 1 1.08 1.04l-3.01 3.16a.75.75 0 0 1-1.08 0L4.44 7.29a.75.75 0 0 1 .03-1.07Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
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
          <div className="tempo-pill">
            <button
              aria-label="Decrease tempo"
              className="tempo-pill__adjust"
              onClick={() =>
                commitProjectChange("Adjust BPM", (current) =>
                  patchProjectState(current, {
                    bpm: clamp(current.bpm - 5, 60, 220),
                  }),
                )
              }
              type="button"
            >
              −
            </button>
            <span>{bpm.toFixed(0)} BPM</span>
            <button
              aria-label="Increase tempo"
              className="tempo-pill__adjust"
              onClick={() =>
                commitProjectChange("Adjust BPM", (current) =>
                  patchProjectState(current, {
                    bpm: clamp(current.bpm + 5, 60, 220),
                  }),
                )
              }
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <div className="topbar__group topbar__group--right">
          <button
            className="ghost-button"
            disabled={isExporting}
            onClick={handleExport}
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

      <CaptureInstallerDialog
        open={isCaptureInstallerDialogOpen}
        onOpenChange={setIsCaptureInstallerDialogOpen}
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

      <MediaSyncDialog
        entries={mediaSyncEntries}
        onOpenChange={setIsMediaSyncDialogOpen}
        open={isMediaSyncDialogOpen}
        peer={mediaSyncPeer}
        relinkMediaItem={relinkOfflineMediaItem}
        relinkingIds={relinkingMediaIds}
        retryMedia={retryPeerMedia}
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

      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <div className="timeline-toolbar">
              <div className="timeline-toolbar__display">
                <span className="status-light" />
                <TransportPlayheadReadout
                  signal={playheadSignal}
                  bpm={bpm}
                  fps={fps}
                  signature={signature}
                />
              </div>

              <div className="timeline-toolbar__controls">
                <div
                  className="segmented-control"
                  role="tablist"
                  aria-label="Timeline scale"
                >
                  <button
                    className={timelineMode === "musical" ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch("Change timeline scale", {
                        timelineMode: "musical",
                      })
                    }
                    type="button"
                  >
                    Tempo
                  </button>
                  <button
                    className={timelineMode === "timecode" ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch("Change timeline scale", {
                        timelineMode: "timecode",
                      })
                    }
                    type="button"
                  >
                    SMPTE
                  </button>
                </div>

                <div
                  className="segmented-control"
                  role="tablist"
                  aria-label="Snap grid"
                >
                  {SNAP_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={snapMode === option.id ? "is-active" : ""}
                      onClick={() =>
                        commitProjectPatch("Change snap grid", {
                          snapMode: option.id,
                        })
                      }
                      type="button"
                    >
                      {option.id === "auto" && snapMode === "auto"
                        ? `${option.label} · ${formatDivision(adaptiveDivision)}`
                        : option.label}
                    </button>
                  ))}
                </div>

                <div className="segmented-control">
                  <button
                    aria-pressed={snapEnabled}
                    className={snapEnabled ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch(
                        snapEnabled
                          ? "Disable beat snapping"
                          : "Enable beat snapping",
                        { snapEnabled: !snapEnabled },
                      )
                    }
                    title="Shift while dragging a clip or trim handle to temporarily disable snapping."
                    type="button"
                  >
                    {snapEnabled ? "Snap On" : "Snap Off"}
                  </button>
                </div>

                <label className="signature-picker">
                  <span>Time Sig</span>
                  <select
                    value={signatureId}
                    onChange={(event) =>
                      commitProjectPatch("Change time signature", {
                        signatureId: event.target.value,
                      })
                    }
                  >
                    {SIGNATURES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="layer-toolbar">
                  <span className="layer-toolbar__count">
                    Layers {lanes.length}/{MAX_LAYERS}
                  </span>
                  <button
                    className="layer-toolbar__button"
                    disabled={!canCreateLayer}
                    onClick={handleCreateLayer}
                    type="button"
                  >
                    {canCreateLayer
                      ? `Create Layer ${getNextLaneNumber(lanes)}`
                      : "Max Layers"}
                  </button>
                </div>
              </div>
            </div>

            <div
              ref={editorGridRef}
              className="editor-grid"
              style={{
                ["--preview-width" as string]: `${effectivePreviewWidth}px`,
              }}
            >
              <div
                ref={timelineScrollRef}
                className={`timeline-scroll ${
                  timelineDragScroll.isGrabbing ? "is-grab-panning" : ""
                }`}
                {...timelineDragScroll.handlers}
                onScroll={() => syncTimelineViewport()}
                style={{ ["--label-width" as string]: `${labelWidth}px` }}
              >
                <div className="timeline-jump-overlay">
                  {isPlayheadOffscreenLeft ? (
                    <button
                      className="playhead-jump playhead-jump--left"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        scrollTimelineToPlayhead();
                      }}
                      type="button"
                    >
                      {"<<"}
                    </button>
                  ) : null}
                  {isPlayheadOffscreenRight ? (
                    <button
                      className="playhead-jump playhead-jump--right"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        scrollTimelineToPlayhead();
                      }}
                      type="button"
                    >
                      {">>"}
                    </button>
                  ) : null}
                </div>
                <div
                  className={`timeline-canvas ${labelWidth < LABEL_WIDTH_NARROW ? "timeline-canvas--narrow-labels" : ""}`}
                  style={{
                    width: labelWidth + timelineWidth,
                    ["--label-width" as string]: `${labelWidth}px`,
                  }}
                >
                  <div className="label-resize-rail">
                    <hr
                      className="label-resize-handle"
                      aria-orientation="vertical"
                      aria-label="Resize track labels"
                      aria-valuenow={labelWidth}
                      aria-valuemin={LABEL_WIDTH_MIN}
                      aria-valuemax={LABEL_WIDTH_MAX}
                      tabIndex={0}
                      title="Drag to resize. Double-click to reset."
                      onPointerDown={handleLabelResizePointerDown}
                      onPointerMove={handleLabelResizePointerMove}
                      onPointerUp={handleLabelResizePointerEnd}
                      onPointerCancel={handleLabelResizePointerEnd}
                      onDoubleClick={() =>
                        commitLabelWidth(LABEL_WIDTH_DEFAULT)
                      }
                      onKeyDown={handleLabelResizeKeyDown}
                    />
                  </div>
                  <PlayheadLine
                    className="timeline-playhead"
                    signal={playheadSignal}
                    quarterPx={quarterPx}
                    offsetPx={labelWidth}
                  />

                  {/* biome-ignore lint/a11y/noStaticElementInteractions: hand-grab panning is a pointer shortcut; the timeline scrolls from the keyboard and wheel as usual */}
                  <section
                    className={`ruler-row ${
                      rulerDragScroll.isGrabbing ? "is-grab-panning" : ""
                    }`}
                    {...rulerDragScroll.handlers}
                    onContextMenu={(event) => {
                      // The ruler has no menu of its own, so the browser's
                      // never shows, with or without a pan.
                      event.preventDefault();
                      rulerDragScroll.onContextMenu(event);
                    }}
                  >
                    <div className="track-label track-label--header">
                      <div>
                        <span>{sessionName ?? "Session"}</span>
                        {mediaSyncStatusLabel ? (
                          <button
                            aria-live="polite"
                            className="track-label__offline track-label__offline--syncing"
                            onClick={() => setIsMediaSyncDialogOpen(true)}
                            title="Show media sync status"
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className="offline-media__spinner"
                            />
                            {mediaSyncStatusLabel}
                          </button>
                        ) : offlineCount ? (
                          <button
                            className="track-label__offline"
                            onClick={() =>
                              inSharedMediaSession
                                ? setIsMediaSyncDialogOpen(true)
                                : setIsOfflineMediaDialogOpen(true)
                            }
                            title="Review and locate offline media"
                            type="button"
                          >
                            {relinkingMediaIds.size ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="offline-media__spinner"
                                />
                                Linking{" "}
                                {pluralize(relinkingMediaIds.size, "file")}…
                              </>
                            ) : (
                              pluralize(offlineCount, "offline media file")
                            )}
                          </button>
                        ) : (
                          <small>{sessionMediaStatus}</small>
                        )}
                      </div>
                    </div>
                    <div
                      className={`ruler-row__content ruler-row__content--interactive ${
                        timelineDragState ? "is-dragging" : ""
                      }`}
                      onPointerDown={(event) => {
                        const timelineScroll = timelineScrollRef.current;
                        // Only the primary button scrubs; the others pan the
                        // timeline through the ruler row.
                        if (
                          !timelineScroll ||
                          event.button !== 0 ||
                          isRulerPanPress(event, shortcutLabels.mac)
                        ) {
                          return;
                        }

                        event.preventDefault();
                        if (isPlaying) {
                          // Batched with setIsPlaying so the audio keeps
                          // running from the clicked position.
                          pulseTimelineAudibleScrub(
                            TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS,
                          );
                        } else {
                          stopTimelineAudibleScrub();
                        }
                        setIsPlaying(false);

                        const timelineBounds =
                          timelineScroll.getBoundingClientRect();
                        const pointerX = event.clientX - timelineBounds.left;
                        const nextPlayheadQ = clamp(
                          (timelineScroll.scrollLeft - labelWidth + pointerX) /
                            quarterPx,
                          0,
                          totalQuarters,
                        );

                        setPlayheadQ(nextPlayheadQ);
                        playbackOriginRef.current = nextPlayheadQ;
                        setTimelineDragState({
                          pointerId: event.pointerId,
                          pointerStartX: event.clientX,
                          originPlayheadQ: nextPlayheadQ,
                          originZoom: resolvedZoom,
                          wasPlaying: isPlaying,
                        });
                      }}
                      style={gridStyle}
                    >
                      <PlayheadLine
                        className="timeline-playhead-marker"
                        signal={playheadSignal}
                        quarterPx={quarterPx}
                        offsetPx={-1}
                      />
                      {rulerBars.map((bar) => (
                        <div
                          key={bar.index}
                          className="ruler-marker"
                          style={{ left: bar.quarter * quarterPx }}
                        >
                          {bar.index % rulerLabelBarStep === 0 ? (
                            <span>
                              {timelineMode === "musical"
                                ? `${bar.index + 1}`
                                : formatTimecode(
                                    quartersToSeconds(bar.quarter, bpm),
                                    fps,
                                  )}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>

                  <div
                    ref={arrangementLanesRef}
                    className={`arrangement-lanes ${layerReorder.listClassName}`}
                  >
                    {showArrangementEmptyState ? (
                      <ArrangementEmptyState
                        disabled={isExporting}
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
                    ) : null}
                    <div
                      aria-hidden="true"
                      className="layer-drop-indicator"
                      ref={layerReorder.indicatorRef}
                    />
                    <div
                      aria-live="polite"
                      className="layer-reorder-status"
                      role="status"
                    >
                      {layerReorder.announcement}
                    </div>
                    {lanes.map((lane, laneIndex) => (
                      <section
                        key={lane.id}
                        className={`track-row ${lane.id === fxLaneId ? "track-row--selected" : ""} ${
                          lane.id === layerReorder.liftedLaneId
                            ? "track-row--lifted"
                            : ""
                        }`}
                        data-layer-row-id={lane.id}
                      >
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere on the label is a mouse shortcut; the layer name button is the keyboard equivalent */}
                        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the layer name button handles the keyboard */}
                        <div
                          className="track-label track-label--lane"
                          data-layer-header-id={lane.id}
                          onContextMenu={(event) =>
                            openLayerMenu(event, lane.id)
                          }
                          onClick={(event) => {
                            if (
                              event.target instanceof Element &&
                              event.target.closest(
                                ".track-label__fx, .track-label__rename",
                              )
                            ) {
                              return;
                            }
                            selectLaneFromLabel(lane.id);
                          }}
                        >
                          <button
                            {...layerReorder.gripProps(lane, laneIndex)}
                            aria-label={`Reorder ${lane.name}`}
                            className="track-label__grip"
                            disabled={isExporting}
                            tabIndex={lane.id === fxLaneId ? 0 : -1}
                            title="Drag to reorder, or press Space to pick up"
                            type="button"
                          >
                            <Bars3Icon aria-hidden="true" />
                          </button>
                          <div className="track-label__index">
                            {laneIndex + 1}
                          </div>
                          {renamingLaneId === lane.id ? (
                            <LayerNameInput
                              initialName={lane.name}
                              onCancel={() => {
                                setRenamingLaneId(undefined);
                                focusLaneLabel(lane.id);
                              }}
                              onSubmit={(name) => {
                                commitLayerRename(lane.id, name);
                                focusLaneLabel(lane.id);
                              }}
                            />
                          ) : (
                            <button
                              aria-current={
                                lane.id === fxLaneId ? "true" : undefined
                              }
                              className="track-label__select"
                              data-lane-label-id={lane.id}
                              tabIndex={lane.id === fxLaneId ? 0 : -1}
                              type="button"
                            >
                              <span>{lane.name}</span>
                              <small>
                                {laneStatusById.get(lane.id)?.summary}
                              </small>
                            </button>
                          )}
                          <button
                            aria-label={`${lane.name} effects`}
                            aria-pressed={laneStatusById.get(lane.id)?.fxToggle}
                            className={`track-label__fx ${laneStatusById.get(lane.id)?.fxClassName ?? ""}`}
                            disabled={!laneStatusById.get(lane.id)?.effectCount}
                            onClick={(event) => {
                              event.stopPropagation();
                              setLayerFxEnabled(
                                lane.id,
                                !isLayerFxEnabled(lane),
                              );
                            }}
                            title={laneStatusById.get(lane.id)?.fxTitle}
                            type="button"
                          >
                            fx
                          </button>
                        </div>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the context-menu key and Shift+F10 open the same menu on the selected layer */}
                        <div
                          className="track-row__content track-row__content--arrangement"
                          data-timeline-lane-id={lane.id}
                          onContextMenu={(event) =>
                            openLaneMenu(event, lane.id)
                          }
                          onPointerDown={(event) => {
                            // Right-click, or Ctrl-click on macOS, opens the lane menu instead.
                            if (
                              event.target !== event.currentTarget ||
                              isContextMenuPress(event, shortcutLabels.mac)
                            ) {
                              return;
                            }

                            event.preventDefault();
                            setSelectedClipId(undefined);
                            setSelectedLaneId(lane.id);
                            setIsPlaying(false);
                            setDragPreviewClips(null);

                            const timelineScroll = timelineScrollRef.current;
                            if (!timelineScroll) {
                              return;
                            }

                            const timelineBounds =
                              timelineScroll.getBoundingClientRect();
                            const pointerX =
                              event.clientX - timelineBounds.left;
                            const anchorQ = snapQuarterValue(
                              clamp(
                                (timelineScroll.scrollLeft -
                                  labelWidth +
                                  pointerX) /
                                  quarterPx,
                                0,
                                totalQuarters,
                              ),
                              snapUnit,
                              snapEnabled && !event.shiftKey,
                            );
                            // The selection starts once the pointer drags
                            // past the threshold; until then it's a click.
                            setPendingSelection(null);
                            setDragState({
                              kind: "selection",
                              pointerId: event.pointerId,
                              laneId: lane.id,
                              gesture: startLaneSelectionGesture(
                                anchorQ,
                                event.clientX,
                              ),
                            });
                          }}
                          style={gridStyle}
                        >
                          {pendingSelection?.laneId === lane.id
                            ? (() => {
                                const width =
                                  pendingSelection.durationQ * quarterPx;
                                const hint = selectionHint(width);
                                return (
                                  <div
                                    className="timeline-selection"
                                    style={{
                                      left: pendingSelection.startQ * quarterPx,
                                      width,
                                      paddingInline: hint.paddingPx,
                                    }}
                                  >
                                    {hint.label ? (
                                      <span>{hint.label}</span>
                                    ) : null}
                                  </div>
                                );
                              })()
                            : null}
                          {(clipsByLane.get(lane.id) ?? []).map((clip) => {
                            const selected = clip.id === selectedClip?.id;
                            // Keeps the trim handles shown while the pointer
                            // strays off the clip mid-drag.
                            const trimming =
                              (dragState?.kind === "resize-start" ||
                                dragState?.kind === "resize-end") &&
                              dragState.clipId === clip.id;
                            const durationQ = getClipDurationQ(clip, bpm);
                            const media = clip.mediaId
                              ? mediaItemsById.get(clip.mediaId)
                              : undefined;
                            const mediaState = describeClipMediaState(
                              clip,
                              media?.availability,
                            );
                            const thumbnailUrl =
                              media?.hasVideo && mediaState === "online"
                                ? (thumbnails.get(
                                    getThumbnailCacheKey(
                                      media.id,
                                      getClipThumbnailTimeSeconds(
                                        clip,
                                        media.durationSeconds,
                                        bpm,
                                      ),
                                      clipFilmstrips.get(clip.id)?.size,
                                    ),
                                    `clip:${clip.id}`,
                                  ) ?? media.thumbnailUrl)
                                : undefined;
                            const filmstrip =
                              media?.hasVideo && mediaState === "online"
                                ? clipFilmstrips.get(clip.id)
                                : undefined;
                            const mediaSync = media
                              ? describeMediaSync(
                                  peerMediaProgress.get(media.id),
                                  media.availability,
                                )
                              : null;
                            // As the compositor draws it: the clip's own
                            // Color or Text first, else its layer's.
                            const fillBackground = isFillClip(clip)
                              ? formatFillPaintCss(
                                  resolveFillPaint(
                                    timelineEffects,
                                    clip.laneId,
                                    clipEffectTrackId(clip.id),
                                  ),
                                )
                              : undefined;
                            const textStyle = isTextClip(clip)
                              ? resolveTextStyle(
                                  timelineEffects,
                                  clip.laneId,
                                  clipEffectTrackId(clip.id),
                                )
                              : undefined;
                            const fxLabel = isFxClip(clip)
                              ? describeFxClip(effects, clip.id)
                              : undefined;
                            return (
                              // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the context-menu key and Shift+F10 open the same menu on the selected clip
                              <div
                                key={clip.id}
                                className={`clip-card ${selected ? "clip-card--selected" : ""} ${trimming ? "clip-card--trimming" : ""} ${filmstrip || fillBackground ? "clip-card--filmstrip" : ""} ${fillBackground ? "clip-card--fill" : ""} ${textStyle ? "clip-card--text" : ""} ${fxLabel ? "clip-card--fx" : ""} ${mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : ""} ${media && revealedMediaIds.has(media.id) ? "is-sync-revealed" : ""}`}
                                data-clip-id={clip.id}
                                onContextMenu={(event) =>
                                  openArrangementClipMenu(event, clip)
                                }
                                onPointerDown={(event) => {
                                  // Right-click, or Ctrl-click on macOS, selects through the
                                  // menu instead of starting a drag or a lane selection.
                                  if (
                                    isContextMenuPress(
                                      event,
                                      shortcutLabels.mac,
                                    )
                                  ) {
                                    event.stopPropagation();
                                  }
                                }}
                                style={{
                                  left: clip.startQ * quarterPx,
                                  width: durationQ * quarterPx,
                                  ["--clip-accent" as string]: clip.accent,
                                  backgroundColor: clip.tint,
                                  borderColor: clip.accent,
                                  opacity:
                                    mediaState === "online" || mediaSync
                                      ? 1
                                      : 0.62,
                                }}
                              >
                                {mediaSync ? (
                                  <MediaSyncSkeleton
                                    variant="clip"
                                    view={mediaSync}
                                  />
                                ) : null}
                                {fillBackground ? (
                                  <span
                                    aria-hidden="true"
                                    className="clip-card__fill"
                                    style={{ background: fillBackground }}
                                  />
                                ) : null}
                                {filmstrip ? (
                                  <span
                                    aria-hidden="true"
                                    className="clip-card__filmstrip"
                                  >
                                    {filmstrip.tiles.map((tile) => {
                                      // A tile shows the clip's first frame
                                      // until its own frame is decoded.
                                      const tileUrl =
                                        thumbnails.get(
                                          getThumbnailCacheKey(
                                            filmstrip.media.id,
                                            tile.timeSeconds,
                                            filmstrip.size,
                                          ),
                                          getFilmstripTileOwner(
                                            "clip",
                                            clip.id,
                                            tile.index,
                                          ),
                                        ) ?? thumbnailUrl;
                                      return (
                                        <span
                                          key={tile.index}
                                          className="clip-card__tile"
                                          style={{
                                            left: tile.leftPx,
                                            width: tile.widthPx,
                                            backgroundImage: tileUrl
                                              ? `url(${tileUrl})`
                                              : undefined,
                                          }}
                                        />
                                      );
                                    })}
                                  </span>
                                ) : null}
                                <button
                                  className="clip-card__handle clip-card__handle--start"
                                  onPointerDown={(event) => {
                                    if (
                                      isContextMenuPress(
                                        event,
                                        shortcutLabels.mac,
                                      )
                                    ) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    setPendingSelection(null);
                                    setDragPreviewClips(null);
                                    setSelectedClipId(clip.id);
                                    setDragState({
                                      kind: "resize-start",
                                      pointerId: event.pointerId,
                                      clipId: clip.id,
                                      pointerStartX: event.clientX,
                                      originStartQ: clip.startQ,
                                      originDurationQ: durationQ,
                                    });
                                  }}
                                  type="button"
                                />
                                <button
                                  className="clip-card__body"
                                  onClick={() => {
                                    setPendingSelection(null);
                                    // Selecting never moves the playhead.
                                    setSelectedClipId(clip.id);
                                  }}
                                  // Double-clicking a text clip types on it in
                                  // the preview.
                                  title={`${shortcutLabels.clipJump} to jump to start`}
                                  onDoubleClick={
                                    textStyle
                                      ? () => startTextEdit(clip.id)
                                      : undefined
                                  }
                                  onPointerDown={(event) => {
                                    if (
                                      isContextMenuPress(
                                        event,
                                        shortcutLabels.mac,
                                      )
                                    ) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    setPendingSelection(null);
                                    setDragPreviewClips(null);
                                    const duplicateOnDrag =
                                      event.ctrlKey || event.metaKey;
                                    const dragClipId = duplicateOnDrag
                                      ? `window-${crypto.randomUUID()}`
                                      : clip.id;
                                    setSelectedClipId(dragClipId);
                                    setDragState({
                                      kind: "move",
                                      pointerId: event.pointerId,
                                      clipId: dragClipId,
                                      sourceClipId: clip.id,
                                      pointerStartX: event.clientX,
                                      originStartQ: clip.startQ,
                                      originDurationQ: durationQ,
                                      originLaneId: clip.laneId,
                                      duplicateOnDrag,
                                      jumpOnClick: isClipJumpPress(
                                        event,
                                        shortcutLabels.mac,
                                      ),
                                    });
                                  }}
                                  type="button"
                                >
                                  {thumbnailUrl && !filmstrip ? (
                                    <span
                                      aria-hidden="true"
                                      className="clip-card__thumb"
                                      style={{
                                        backgroundImage: `url(${thumbnailUrl})`,
                                      }}
                                    />
                                  ) : null}
                                  {textStyle ? (
                                    <span
                                      aria-hidden="true"
                                      className="clip-card__glyph"
                                      style={{
                                        color:
                                          textStyle.paint.kind === "solid"
                                            ? formatCssColor(
                                                textStyle.paint.color,
                                              )
                                            : undefined,
                                      }}
                                    >
                                      T
                                    </span>
                                  ) : null}
                                  {fxLabel ? (
                                    <span
                                      aria-hidden="true"
                                      className="clip-card__glyph clip-card__glyph--fx"
                                    >
                                      FX
                                    </span>
                                  ) : null}
                                  <span className="clip-card__text">
                                    <strong>
                                      {textStyle
                                        ? getTextPreview(textStyle) ||
                                          clip.label
                                        : (fxLabel ?? clip.label)}
                                    </strong>
                                    <span className="clip-card__meta">
                                      {mediaSync ? (
                                        formatMediaSyncLabel(mediaSync)
                                      ) : (
                                        <>
                                          {formatMusicalPosition(
                                            clip.startQ,
                                            signature,
                                          )}{" "}
                                          /{" "}
                                          {formatDuration(clip.durationSeconds)}
                                          {mediaState === "online"
                                            ? ""
                                            : ` / ${formatClipMediaState(mediaState)}`}
                                        </>
                                      )}
                                    </span>
                                  </span>
                                </button>
                                <button
                                  className="clip-card__handle clip-card__handle--end"
                                  onPointerDown={(event) => {
                                    if (
                                      isContextMenuPress(
                                        event,
                                        shortcutLabels.mac,
                                      )
                                    ) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    setPendingSelection(null);
                                    setDragPreviewClips(null);
                                    setSelectedClipId(clip.id);
                                    setDragState({
                                      kind: "resize-end",
                                      pointerId: event.pointerId,
                                      clipId: clip.id,
                                      pointerStartX: event.clientX,
                                      originStartQ: clip.startQ,
                                      originDurationQ: durationQ,
                                    });
                                  }}
                                  type="button"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>

                  <section
                    aria-label="Main audio drop area"
                    className={`track-row track-row--bus ${isMainAudioDropTarget ? "is-drop-target" : ""}`}
                    data-main-audio-drop-target=""
                    onContextMenu={openMainAudioMenu}
                    onDragEnter={handleMainAudioDragEvent}
                    onDragLeave={handleMainAudioDragLeave}
                    onDragOver={handleMainAudioDragEvent}
                    onDrop={handleMainAudioDrop}
                  >
                    <div className="track-label">
                      <div className="track-label__index">A</div>
                      <div>
                        <span>Audio</span>
                        <small>
                          {mainAudio ? mainAudio.name : "No main audio"}
                        </small>
                      </div>
                      <button
                        aria-label={
                          mainAudio ? "Replace main audio" : "Add main audio"
                        }
                        className="track-label__fx track-label__audio"
                        disabled={isExporting}
                        onClick={() => mainAudioInputRef.current?.click()}
                        title={
                          mainAudio ? "Replace main audio" : "Add main audio"
                        }
                        type="button"
                      >
                        {mainAudio ? (
                          <ArrowPathRoundedSquareIcon aria-hidden="true" />
                        ) : (
                          <ArrowUpTrayIcon aria-hidden="true" />
                        )}
                      </button>
                      <input
                        accept="audio/*"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) {
                            void replaceMainAudioFromFile(file);
                          }
                        }}
                        ref={mainAudioInputRef}
                        type="file"
                      />
                    </div>
                    <div
                      className={`track-row__content track-row__content--waveform ${mainAudioSync ? getMediaSyncClassName(mainAudioSync, prefersReducedMotion) : ""}`}
                      style={gridStyle}
                    >
                      {mainAudioSync ? (
                        <MediaSyncSkeleton
                          style={mainAudioSkeletonStyle}
                          variant="waveform"
                          view={mainAudioSync}
                        />
                      ) : null}
                      {mainWaveformMessage ? (
                        <div
                          className="waveform__empty"
                          style={{ left: visibleTimelineStartPx + 16 }}
                        >
                          {mainWaveformMessage}
                        </div>
                      ) : null}
                      {currentMainWaveform?.peaks ? (
                        <MainWaveform
                          bpm={bpm}
                          peaks={currentMainWaveform.peaks}
                          quarterPx={quarterPx}
                          visibleStartPx={visibleTimelineStartPx}
                          visibleWidthPx={visibleTimelineWidthPx}
                        />
                      ) : null}
                    </div>
                  </section>

                  <section
                    aria-label="Source track drop area"
                    className={`source-header ${sourceTracks.length ? "" : "source-header--empty"} ${isSourceTracksCollapsed ? "source-header--collapsed" : ""} ${isSourceTracksCollapsed && isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
                    data-source-track-drop-target={
                      isSourceHeaderDropTarget ? "new-track" : undefined
                    }
                    onDragEnter={(event) => {
                      if (isSourceHeaderDropTarget) {
                        handleSourceTrackDragEvent(event, {
                          kind: "new-track",
                        });
                      }
                    }}
                    onDragLeave={() => {
                      if (isSourceHeaderDropTarget) {
                        scheduleSourceTrackDragClear();
                      }
                    }}
                    onDragOver={(event) => {
                      if (isSourceHeaderDropTarget) {
                        handleSourceTrackDragEvent(event, {
                          kind: "new-track",
                        });
                      }
                    }}
                    onDrop={(event) => {
                      if (!isSourceHeaderDropTarget) {
                        return;
                      }

                      const files = getDraggedMediaFiles(event.dataTransfer);
                      if (!files.length) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      clearSourceTrackDragState();
                      void importMediaIntoSourceTrack(files, {
                        kind: "new-track",
                      });
                    }}
                  >
                    <div className="track-label track-label--header">
                      {sourceTracks.length ? (
                        <button
                          aria-expanded={!isSourceTracksCollapsed}
                          className="source-header__toggle"
                          onClick={() =>
                            setSourceTracksCollapsed(!isSourceTracksCollapsed)
                          }
                          title={
                            isSourceTracksCollapsed
                              ? "Show source tracks"
                              : "Hide source tracks"
                          }
                          type="button"
                        >
                          <ChevronDownIcon aria-hidden="true" />
                          <span className="source-header__title">
                            <span>Source Tracks</span>
                            <small>
                              {pluralize(sourceTracks.length, "track")} in
                              session
                            </small>
                          </span>
                        </button>
                      ) : (
                        <div>
                          <span>Source Tracks</span>
                          <small>
                            {pluralize(sourceTracks.length, "track")} in session
                          </small>
                        </div>
                      )}
                    </div>
                    <div className="source-header__content">
                      {isSourceTracksCollapsed ? (
                        <span className="source-header__summary">
                          {formatSourceTracksSummary(sourceTracks.length)}{" "}
                          hidden
                        </span>
                      ) : null}
                      {sourceTracks.length ? null : (
                        <div className="source-empty-state">
                          <span>No source media yet</span>
                          <button
                            className="ghost-button ghost-button--accent"
                            onClick={() => void handleImport()}
                            type="button"
                          >
                            Import Media
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => void handleOpenSession()}
                            title="Open a .lvp session or an Ableton .als set"
                            type="button"
                          >
                            Open Session
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  {isSourceTracksCollapsed
                    ? null
                    : sourceTracks.map((track, index) => {
                        const sourceClips =
                          sourceSpansByTrack.get(track.id) ?? [];
                        const swatch = getSwatch(track.colorIndex);
                        const isDropTarget =
                          sourceTrackDragTarget?.kind === "track" &&
                          sourceTrackDragTarget.trackId === track.id;

                        return (
                          <section
                            key={track.id}
                            className="track-row track-row--source"
                          >
                            <button
                              className="track-label track-label--source"
                              onClick={() => selectSource(track.id)}
                              type="button"
                            >
                              <span
                                className="track-label__stripe"
                                style={{ backgroundColor: swatch.accent }}
                              />
                              <div>
                                <span>{track.name}</span>
                                <small>
                                  {track.recordingPaths.length
                                    ? `${pluralize(track.recordingPaths.length, "file")} / key ${index + 1}`
                                    : `Imported media / key ${index + 1}`}
                                </small>
                              </div>
                            </button>
                            <section
                              aria-label={`Drop media into ${track.name}`}
                              className={`track-row__content track-row__content--source ${isDropTarget ? "is-drop-target" : ""}`}
                              data-source-track-drop-target="track"
                              data-source-track-id={track.id}
                              onDragEnter={(event) =>
                                handleSourceTrackDragEvent(event, {
                                  kind: "track",
                                  trackId: track.id,
                                })
                              }
                              onDragLeave={() => {
                                scheduleSourceTrackDragClear();
                              }}
                              onDragOver={(event) =>
                                handleSourceTrackDragEvent(event, {
                                  kind: "track",
                                  trackId: track.id,
                                })
                              }
                              onDrop={(event) => {
                                const files = getDraggedMediaFiles(
                                  event.dataTransfer,
                                );
                                if (!files.length) {
                                  return;
                                }

                                event.preventDefault();
                                event.stopPropagation();
                                clearSourceTrackDragState();
                                void importMediaIntoSourceTrack(files, {
                                  kind: "track",
                                  trackId: track.id,
                                });
                              }}
                              style={gridStyle}
                            >
                              {sourceClips.map((clip) => {
                                const media = clip.mediaId
                                  ? mediaItemsById.get(clip.mediaId)
                                  : undefined;
                                const mediaState = describeClipMediaState(
                                  clip,
                                  media?.availability,
                                );
                                const thumbnailUrl =
                                  (media &&
                                    thumbnails.get(
                                      getThumbnailCacheKey(
                                        media.id,
                                        clip.trimStartSeconds,
                                        spanFilmstrips.get(clip.id)?.size,
                                      ),
                                      `span:${clip.id}`,
                                    )) ??
                                  media?.thumbnailUrl;
                                const filmstrip =
                                  media?.hasVideo && mediaState === "online"
                                    ? spanFilmstrips.get(clip.id)
                                    : undefined;
                                const mediaSync = media
                                  ? describeMediaSync(
                                      peerMediaProgress.get(media.id),
                                      media.availability,
                                    )
                                  : null;
                                return (
                                  // biome-ignore lint/a11y/noStaticElementInteractions: Ctrl/Cmd-click and right-click are mouse shortcuts; pressing a source layer's number key commits a selection from the keyboard
                                  // biome-ignore lint/a11y/useKeyWithClickEvents: a plain click does nothing, so there is no keyboard equivalent to add
                                  <div
                                    key={clip.id}
                                    className={`source-span ${filmstrip ? "source-span--filmstrip" : ""} ${mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : ""} ${media && revealedMediaIds.has(media.id) ? "is-sync-revealed" : ""} ${clipMenu?.kind === "span" && clipMenu.spanId === clip.id ? "source-span--selected" : ""}`}
                                    onClick={(event) => {
                                      // Ctrl-click on macOS opens the menu instead.
                                      if (
                                        !isSourceClipDropClick(event) ||
                                        isContextMenuPress(
                                          event,
                                          shortcutLabels.mac,
                                        )
                                      ) {
                                        return;
                                      }

                                      event.preventDefault();
                                      event.stopPropagation();
                                      addSourceSpanToArrangement(clip);
                                    }}
                                    onContextMenu={(event) =>
                                      openSourceSpanMenu(event, clip)
                                    }
                                    title={`${shortcutLabels.sourceClipDrop} to add this clip to the arrangement`}
                                    style={{
                                      left: clip.startQ * quarterPx,
                                      width:
                                        getClipDurationQ(clip, bpm) * quarterPx,
                                      ["--clip-accent" as string]: clip.accent,
                                      backgroundColor: clip.tint,
                                      borderColor: clip.accent,
                                      opacity:
                                        mediaState === "online" || mediaSync
                                          ? 1
                                          : 0.56,
                                    }}
                                  >
                                    {mediaSync ? (
                                      <MediaSyncSkeleton
                                        variant="span"
                                        view={mediaSync}
                                      />
                                    ) : filmstrip ? (
                                      <span
                                        aria-hidden="true"
                                        className="source-span__filmstrip"
                                      >
                                        {filmstrip.tiles.map((tile) => {
                                          // A tile shows the span's start
                                          // frame until its own frame is
                                          // decoded.
                                          const tileUrl =
                                            thumbnails.get(
                                              getThumbnailCacheKey(
                                                filmstrip.media.id,
                                                tile.timeSeconds,
                                                filmstrip.size,
                                              ),
                                              getFilmstripTileOwner(
                                                "span",
                                                clip.id,
                                                tile.index,
                                              ),
                                            ) ?? thumbnailUrl;
                                          return (
                                            <span
                                              key={tile.index}
                                              className="source-span__tile"
                                              style={{
                                                left: tile.leftPx,
                                                width: tile.widthPx,
                                                backgroundImage: tileUrl
                                                  ? `url(${tileUrl})`
                                                  : undefined,
                                              }}
                                            />
                                          );
                                        })}
                                      </span>
                                    ) : (
                                      <div
                                        className="source-span__thumb"
                                        style={
                                          thumbnailUrl
                                            ? {
                                                backgroundImage: `url(${thumbnailUrl})`,
                                                backgroundSize: "cover",
                                                backgroundPosition: "center",
                                              }
                                            : undefined
                                        }
                                      />
                                    )}
                                    <div className="source-span__body">
                                      <span>{clip.label}</span>
                                      <small>
                                        {mediaSync
                                          ? formatMediaSyncLabel(mediaSync)
                                          : formatClipMediaState(mediaState)}
                                      </small>
                                      <div
                                        className="source-span__line"
                                        style={{ backgroundColor: clip.accent }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                              {isDropTarget && sourceTrackDragPreview ? (
                                <div className="source-drop-preview">
                                  <div
                                    className={`source-drop-preview__thumb ${
                                      sourceTrackDragPreview.thumbnailUrl
                                        ? "has-image"
                                        : ""
                                    }`}
                                    style={
                                      sourceTrackDragPreview.thumbnailUrl
                                        ? {
                                            backgroundImage: `url(${sourceTrackDragPreview.thumbnailUrl})`,
                                          }
                                        : undefined
                                    }
                                  />
                                  <div className="source-drop-preview__body">
                                    <strong>
                                      {sourceTrackDragPreview.label}
                                    </strong>
                                    <span>{sourceTrackDragPreviewDetail}</span>
                                  </div>
                                  {sourceTrackDragPreviewOverflow ? (
                                    <div className="source-drop-preview__count">
                                      {sourceTrackDragPreviewOverflow}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </section>
                          </section>
                        );
                      })}
                  {isSourceTrackFileDragActive && !isSourceTracksCollapsed ? (
                    <section className="track-row track-row--source track-row--source-drop">
                      <div className="track-label track-label--source track-label--source-drop">
                        <span className="track-label__stripe" />
                        <div>
                          <span>New Source Track</span>
                          <small>Drop here to create a new source track</small>
                        </div>
                      </div>
                      <section
                        aria-label="Drop media into a new source track"
                        className={`track-row__content track-row__content--source track-row__content--source-drop ${isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
                        data-source-track-drop-target="new-track"
                        onDragEnter={(event) =>
                          handleSourceTrackDragEvent(event, {
                            kind: "new-track",
                          })
                        }
                        onDragLeave={() => {
                          scheduleSourceTrackDragClear();
                        }}
                        onDragOver={(event) =>
                          handleSourceTrackDragEvent(event, {
                            kind: "new-track",
                          })
                        }
                        onDrop={(event) => {
                          const files = getDraggedMediaFiles(
                            event.dataTransfer,
                          );
                          if (!files.length) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          clearSourceTrackDragState();
                          void importMediaIntoSourceTrack(files, {
                            kind: "new-track",
                          });
                        }}
                        style={gridStyle}
                      >
                        {sourceTrackDragPreview ? (
                          <div className="source-drop-preview source-drop-preview--new-track">
                            <div
                              className={`source-drop-preview__thumb ${
                                sourceTrackDragPreview.thumbnailUrl
                                  ? "has-image"
                                  : ""
                              }`}
                              style={
                                sourceTrackDragPreview.thumbnailUrl
                                  ? {
                                      backgroundImage: `url(${sourceTrackDragPreview.thumbnailUrl})`,
                                    }
                                  : undefined
                              }
                            />
                            <div className="source-drop-preview__body">
                              <strong>{sourceTrackDragPreview.label}</strong>
                              <span>{sourceTrackDragPreviewDetail}</span>
                            </div>
                            {sourceTrackDragPreviewOverflow ? (
                              <div className="source-drop-preview__count">
                                {sourceTrackDragPreviewOverflow}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                    </section>
                  ) : null}
                </div>
              </div>

              <hr
                className="preview-resize-handle"
                aria-orientation="vertical"
                aria-label="Resize preview panel"
                aria-valuenow={effectivePreviewWidth}
                aria-valuemin={PREVIEW_MIN_WIDTH}
                aria-valuemax={previewMaxWidth}
                tabIndex={0}
                title="Drag to resize. Double-click to reset."
                onPointerDown={handlePreviewResizePointerDown}
                onPointerMove={handlePreviewResizePointerMove}
                onPointerUp={handlePreviewResizePointerEnd}
                onPointerCancel={handlePreviewResizePointerEnd}
                onDoubleClick={() => commitPreviewWidth(PREVIEW_DEFAULT_WIDTH)}
                onKeyDown={handlePreviewResizeKeyDown}
              />

              <aside className="preview-panel">
                <div className="preview-panel__header">
                  <strong>Program</strong>
                  <span className="preview-panel__clip">
                    {previewClip ? previewClip.label : "No clip at playhead"}
                  </span>
                  <span className="preview-panel__mode">
                    {previewMedia?.kind === "audio" ? "Audio" : "Video"}
                  </span>
                </div>

                <div className="preview-monitor">
                  <CompositionPlayer
                    ref={compositionPlayerRef}
                    bpm={bpm}
                    fps={fps}
                    canvasHeight={canvasHeight}
                    canvasWidth={canvasWidth}
                    clips={timelineClips}
                    effects={timelineEffects}
                    isPlaying={isPlaying}
                    isScrubbing={Boolean(timelineDragState)}
                    isAudibleScrubbing={isTimelineAudibleScrubbing}
                    isContinuousScrubbing={Boolean(
                      timelineDragState?.wasPlaying,
                    )}
                    lanes={lanes}
                    mainAudio={mainAudio}
                    mediaItems={mediaItems}
                    playheadQ={playheadQ}
                    playheadSeconds={playheadSeconds}
                    playheadSignal={playheadSignal}
                    hiddenTextClipId={textEdit?.clipId}
                  />
                  <PreviewTransformOverlay
                    canvas={{ width: canvasWidth, height: canvasHeight }}
                    layers={previewLayers}
                    selectedLaneId={previewLaneId}
                    selectedClipId={selectedClip?.id}
                    textEdit={previewTextEdit}
                    getLayerPosition={getPreviewLayerPosition}
                    getLayerTransform={getPreviewLayerTransform}
                    onSelect={selectPreviewLayer}
                    onMove={movePreviewLayer}
                    onTransform={transformPreviewLayer}
                    onActivate={activatePreviewLayer}
                  />
                  {!previewClip ||
                  (previewMediaState !== "online" && !hasOnlinePlayheadClip) ? (
                    <div className="preview-placeholder">
                      <div className="preview-placeholder__overlay">
                        <strong>
                          {!previewClip || previewMediaState === "online"
                            ? "No clip at playhead"
                            : describePreviewMediaState(previewMediaState)
                                .title}
                        </strong>
                        <span>
                          {!previewClip || previewMediaState === "online"
                            ? isPlaying
                              ? "The playhead is currently in a gap between clips."
                              : "Move the playhead onto a clip or start playback to render the session comp."
                            : describePreviewMediaState(previewMediaState)
                                .detail}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>

            <div className="transport-bar">
              <div className="zoom-control">
                <span className="zoom-control__label">Zoom</span>
                <button
                  aria-label="Zoom out"
                  className="zoom-control__button"
                  disabled={resolvedZoom <= ZOOM_MIN}
                  onClick={() =>
                    setZoomValue("Zoom out", stepZoom(resolvedZoom, -1))
                  }
                  title="Zoom out"
                  type="button"
                >
                  <MagnifyingGlassMinusIcon aria-hidden="true" />
                </button>
                <input
                  aria-label="Timeline zoom"
                  aria-valuetext={formatZoomFactor(resolvedZoom)}
                  className="zoom-control__slider"
                  data-zoom={resolvedZoom}
                  max={1}
                  min={0}
                  onBlur={() => flushZoomDraft()}
                  onChange={(event) =>
                    updateZoomDraft(
                      sliderPositionToZoom(Number(event.target.value)),
                    )
                  }
                  onKeyUp={() => flushZoomDraft()}
                  onPointerUp={() => flushZoomDraft()}
                  step={ZOOM_SLIDER_STEP}
                  style={{
                    ["--zoom-fill" as string]: `${zoomFillFraction(resolvedZoom) * 100}%`,
                  }}
                  type="range"
                  value={zoomToSliderPosition(resolvedZoom)}
                />
                <button
                  aria-label="Zoom in"
                  className="zoom-control__button"
                  disabled={resolvedZoom >= ZOOM_MAX}
                  onClick={() =>
                    setZoomValue("Zoom in", stepZoom(resolvedZoom, 1))
                  }
                  title="Zoom in"
                  type="button"
                >
                  <MagnifyingGlassPlusIcon aria-hidden="true" />
                </button>
                <button
                  aria-label={`Zoom ${formatZoomFactor(resolvedZoom)}, reset to ${formatZoomFactor(ZOOM_DEFAULT)}`}
                  className="zoom-control__readout"
                  onClick={() => setZoomValue("Reset zoom", ZOOM_DEFAULT)}
                  title="Reset zoom to 100%"
                  type="button"
                >
                  {formatZoomFactor(resolvedZoom)}
                </button>
              </div>

              <div className="transport-cluster">
                <button
                  aria-label="Jump back one bar"
                  className="transport-button transport-button--skip-start"
                  onClick={() => jumpPlayhead(-1)}
                  title="Jump back one bar"
                  type="button"
                >
                  <BackwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Jump back half a bar"
                  className="transport-button"
                  onClick={() => jumpPlayhead(-0.5)}
                  title="Jump back half a bar"
                  type="button"
                >
                  <BackwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label={isPlaying ? "Pause playback" : "Play timeline"}
                  className="transport-button transport-button--primary"
                  onClick={handleTransportToggle}
                  title={isPlaying ? "Pause playback" : "Play timeline"}
                  type="button"
                >
                  {isPlaying ? (
                    <PauseIcon aria-hidden="true" />
                  ) : (
                    <PlayIcon aria-hidden="true" />
                  )}
                </button>
                <button
                  aria-label="Jump forward half a bar"
                  className="transport-button"
                  onClick={() => jumpPlayhead(0.5)}
                  title="Jump forward half a bar"
                  type="button"
                >
                  <ForwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Jump forward one bar"
                  className="transport-button transport-button--skip-end"
                  onClick={() => jumpPlayhead(1)}
                  title="Jump forward one bar"
                  type="button"
                >
                  <ForwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Randomize arrangement"
                  className="transport-button transport-button--wand"
                  disabled={isExporting}
                  onClick={handleRandomizeTimeline}
                  title="Replace the arrangement with randomized selections"
                  type="button"
                >
                  <WandIcon />
                </button>
              </div>
            </div>
          </section>

          <section
            className={`fx-panel ${isInspectorCollapsed ? "fx-panel--collapsed" : ""}`}
          >
            <button
              aria-controls="fx-panel-body"
              aria-expanded={!isInspectorCollapsed}
              className="fx-panel__toggle"
              onClick={toggleInspectorCollapsed}
              type="button"
            >
              <span>{fxPanelTitle}</span>
              <ChevronDownIcon aria-hidden="true" />
            </button>

            <div
              className="fx-panel__body"
              hidden={isInspectorCollapsed}
              id="fx-panel-body"
            >
              <FxChain
                devices={fxDevices}
                kind={fxKind}
                layerFxEnabled={isLayerFxEnabled(fxLane)}
                layers={orderLayerOptions}
                clipLayers={fxClipLayerOptions}
                layerName={fxLane?.name}
                layerTrackId={fxLaneId}
                clipTrackId={fxClipId ? clipEffectTrackId(fxClipId) : undefined}
                clipScope={fxClipScope}
                onAdd={addFxDevice}
                onDuplicate={duplicateFxDevice}
                onMove={moveFxDevice}
                onRemove={removeFxDevice}
                onReset={resetFxDevice}
                onSetLayerFxEnabled={(enabled) => {
                  if (fxLaneId) {
                    setLayerFxEnabled(fxLaneId, enabled);
                  }
                }}
                onSetEnabled={setFxDeviceEnabled}
                onSetAnimationEnabled={setFxDeviceAnimationEnabled}
                onSetAnimation={setFxDeviceAnimation}
                onSetParameter={setFxDeviceParameter}
              />
            </div>
          </section>
        </div>
      </main>

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
      <StatusBar items={statusBarItems} message={statusMessage} />
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
