import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { render } from "vitest-browser-react";
import testPatternUrl from "../../e2e/fixtures/test-pattern.mp4?url";
import type { ClipClipboard } from "../app/clip-ops.ts";
import { INITIAL_PROJECT_STATE, signatureById } from "../app/constants.ts";
import { selectSourceSpan } from "../app/source-selection.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceSpan,
} from "../app/types.ts";
import type { WorkspaceAccess } from "../app/workspace-types.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock";
import { TimelineContextMenu } from "../components/TimelineContextMenu";
import { TopBar } from "../components/TopBar";
import { ArrangementLanes } from "../components/timeline/ArrangementLanes";
import { AudioRow } from "../components/timeline/AudioRow";
import { Ruler } from "../components/timeline/Ruler";
import { SourceTracks } from "../components/timeline/SourceTracks";
import { Timeline } from "../components/timeline/Timeline";
import { TimelineToolbar } from "../components/timeline/TimelineToolbar";
import { TransportBar } from "../components/timeline/TransportBar";
import { addFillClip } from "../fill-clip.ts";
import { ensureLayerLayouts } from "../fx-stack.ts";
import { useAppLayout } from "../hooks/useAppLayout.ts";
import { useAudioMix } from "../hooks/useAudioMix.ts";
import { useCollaborationState } from "../hooks/useCollaboration.ts";
import { useFxContexts } from "../hooks/useFxContexts.ts";
import { useFxEditing } from "../hooks/useFxEditing.ts";
import { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import { useMediaPreview } from "../hooks/useMediaPreview.ts";
import { usePlayback } from "../hooks/usePlayback.ts";
import { usePreviewVolume } from "../hooks/usePreviewVolume.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "../hooks/useProjectStore.ts";
import type { useSourceTrackDrop } from "../hooks/useSourceTrackDrop.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import { useTimelineEditing } from "../hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "../hooks/useTimelineSelection.ts";
import type { MediaItem } from "../media";
import { addMediaToSourceTrack } from "../source-track-media.ts";
import { createSpaceHold } from "../space-shortcut";

// The desktop editor without the preview, the Media drawer, media import or
// session persistence, for component tests of editing: the top bar's
// menubar, the toolbar, the timeline (ruler, layers, source tracks and Audio
// row), the transport bar, the FX panel and the context menus, wired through
// the hooks App wires them with (useProjectStore, useTimelineSelection,
// useAppLayout, useTimeline, usePlayback, useFxEditing, useFxPanelModel and
// useTimelineEditing), so edits, undo, menus, drags, keyboard shortcuts and
// playback of the playhead behave as in the app.

const noop = () => {};
const noopAsync = async () => false;

// What a source track drop shows while nothing is being dragged.
const NO_DROP = {
  isSourceTrackFileDragActive: false,
  isNewSourceTrackDropTarget: false,
  sourceTrackDragTarget: null,
  sourceTrackDragPreview: null,
  sourceTrackDragPreviewDetail: null,
  sourceTrackDragPreviewOverflow: 0,
  sourceTrackDragThumbnails: [],
} as unknown as ReturnType<typeof useSourceTrackDrop>;
const NO_IDS: ReadonlySet<string> = new Set();
const NO_LIVE_TAKES = new Map();
const NO_REMOTE_PROGRESS = new Map();

// What a test reads back from the editor.
export type EditorState = {
  project: ProjectState;
  canUndo: boolean;
  isPlaying: boolean;
  // The live playhead, which playback advances between renders.
  playheadQ: () => number;
  isTakeOverPromptOpen: boolean;
};

type EditorHarnessProps = {
  // The session the editor opens, swapped in without an undo step.
  project?: ProjectState;
  // "read-only" opens it as a tab that doesn't own the session.
  access?: WorkspaceAccess;
  // Called on every render with what the editor holds.
  onState?: (state: EditorState) => void;
};

export function EditorHarness({
  project: initialProject,
  access = "owner",
  onState,
}: EditorHarnessProps) {
  const store = useProjectStore({ access, restoredSession: null });
  const { dispatchProjectHistory } = store;
  const [opened, setOpened] = useState(!initialProject);
  useLayoutEffect(() => {
    if (initialProject && !opened) {
      dispatchProjectHistory({ type: "replace", snapshot: initialProject });
      setOpened(true);
    }
  }, [dispatchProjectHistory, initialProject, opened]);
  const {
    projectHistory,
    playheadQ,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    commitProjectChange,
  } = store;
  const project = projectHistory.present;
  const { lanes, sourceTracks, clips, effects, bpm, fps } = project;

  const collaboration = useCollaborationState();
  const selection = useTimelineSelection({
    restoredSession: null,
    clips,
    sourceSpans: project.sourceSpans,
    effects,
    sourceTracks,
  });
  const { selectedClip, timelineClips, timelineEffects } = selection;
  const { pendingSelection, setPendingSelection, dragState } = selection;
  const { setSelectedClipId, setDragPreviewClips, setDragState } = selection;
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const arrangementLanesRef = useRef<HTMLDivElement | null>(null);
  const clipClipboardRef = useRef<ClipClipboard | null>(null);
  const spaceHoldRef = useRef(createSpaceHold());
  const playbackOriginRef = useRef(store.initialPlayheadQ);
  const compositionPlayerRef = useRef(null);
  const layout = useAppLayout({ sourceTrackCount: sourceTracks.length });
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setStatus] = useState("");
  const previewVolume = usePreviewVolume(compositionPlayerRef);

  const mediaItemsById = useMemo(
    () => new Map(project.mediaItems.map((item) => [item.id, item])),
    [project.mediaItems],
  );
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
  const mediaPreview = useMediaPreview({
    isPlaying,
    setIsPlaying,
    mediaItemsById,
    drawerMediaId: undefined,
  });
  const fxEditing = useFxEditing({
    dispatchProject: store.dispatchProject,
    commitProjectChange,
    lanes,
    sourceTracks,
    timelineClipsRef: selection.timelineClipsRef,
    projectSnapshotRef: store.projectSnapshotRef,
  });
  const timeline = useTimeline({
    restoredSession: null,
    project,
    store,
    selection,
    layout,
    mediaItemsById,
    timelineScrollRef,
    arrangementLanesRef,
    spaceHoldRef,
  });
  const { quarterPx, gridStyle } = timeline;
  const { visibleTimelineStartPx, visibleTimelineWidthPx } = timeline;
  const fxPanel = useFxPanelModel({
    lanes,
    effects,
    selectedLaneId: selection.selectedLaneId,
    selectedClip,
    sourceSelection: selection.sourceSelection,
    sourceTracks,
    sourceSpans: project.sourceSpans,
    mediaItemsById,
    lanePriority,
    timelineClips,
    playheadQ,
    bpm,
  });
  const [audioMixRevision, setAudioMixRevision] = useState(0);
  const resolvedAudioMix = useMemo(() => {
    void audioMixRevision;
    return resolveAudioClips({
      clips: timelineClips,
      lanes,
      sourceTracks,
      sourceSpans: project.sourceSpans,
      mediaById: mediaItemsById,
      bpm,
      signature: signatureById(project.signatureId),
      effects: timelineEffects,
    });
  }, [
    audioMixRevision,
    bpm,
    lanes,
    mediaItemsById,
    project.signatureId,
    project.sourceSpans,
    sourceTracks,
    timelineClips,
    timelineEffects,
  ]);
  const audioMix = useAudioMix({
    mix: resolvedAudioMix,
    mediaItemsById,
    refresh: useCallback(() => setAudioMixRevision((value) => value + 1), []),
  });
  const playback = usePlayback({
    playbackOriginRef,
    clips: timelineClips,
    timelineClips,
    timelineClipsRef: selection.timelineClipsRef,
    projectMediaItems: project.mediaItems,
    bpm,
    barLength: timeline.barLength,
    snap: { unit: timeline.snapUnit, enabled: project.snapEnabled },
    quarterPx,
    totalQuarters: timeline.totalQuarters,
    loopRegion: timeline.loopRegion,
    labelWidth,
    timelineScrollRef,
    isPlaying,
    setIsPlaying,
    timelineDragState: selection.timelineDragState,
    setTimelineDragState: selection.setTimelineDragState,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    setPlayheadQState: store.setPlayheadQState,
    setPendingSelection,
    setSelectedClipId,
    setStatus,
  });
  const historyCommands = useProjectHistoryCommands({
    ...store,
    finishTextEdit: noop,
    stopTimelineAudibleScrub: playback.stopTimelineAudibleScrub,
    setIsPlaying,
    setDragPreviewClips,
    setDragState,
    setPendingSelection,
    setTimelineDragState: selection.setTimelineDragState,
    setStatus,
  });
  const editing = useTimelineEditing({
    project,
    store,
    selection,
    viewport: timeline,
    layout,
    playback,
    historyCommands,
    fxEditing,
    refreshAudio: audioMix.refresh,
    fxLaneId: fxPanel.fxLaneId,
    mediaItemsById,
    laneStatusById: timeline.laneStatusById,
    playbackOriginRef,
    spaceHoldRef,
    timelineScrollRef,
    arrangementLanesRef,
    clipClipboardRef,
    isPlaying,
    setIsPlaying,
    mediaPreview,
    setStatus,
  });
  const { modulationClock, animationTimeline } = useFxContexts({
    playheadSignal,
    bpm,
    fps,
    signature: timeline.signature,
    isPlaying,
    timelineClips,
    lanePriority,
    fxLaneId: fxPanel.fxLaneId,
    fxClipId: fxPanel.fxClipId,
    projectDurationFrames: project.projectDurationFrames,
  });
  const { selectSource } = selection;
  const selectSourceSpanClip = useCallback(
    (span: SourceSpan) => selectSource(selectSourceSpan(span)),
    [selectSource],
  );

  onState?.({
    project,
    canUndo: store.canUndo,
    isPlaying,
    playheadQ: () => playheadQRef.current,
    isTakeOverPromptOpen: store.isTakeOverPromptOpen,
  });

  return (
    <div className="app-shell">
      <TopBar
        canStartNewSession={false}
        handleNewSession={noop}
        handleOpenSession={noopAsync}
        sample={{ handleOpenSample: noop }}
        handleImport={noopAsync}
        offlineMedia={[]}
        showsMediaSync={false}
        collaboration={collaboration}
        handleDisconnectConnection={noop}
        handleSaveToLibrary={noopAsync}
        isExporting={false}
        openExportDialog={noop}
        setIsMediaStorageDialogOpen={noop}
        setIsMediaSyncDialogOpen={noop}
        setIsOfflineMediaDialogOpen={noop}
        setIsProjectExportDialogOpen={noop}
        setIsSessionSettingsOpen={noop}
        setIsCaptureInstallerDialogOpen={noop}
        handleStopShare={noop}
        showShareCopiedBadge={noop}
        exportButtonLabel="Export"
        getEditMenuEntries={editing.getEditMenuEntries}
        renamingLaneIdRef={selection.renamingLaneIdRef}
        setStatus={setStatus}
      />
      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <TimelineToolbar
              {...project}
              playheadSignal={playheadSignal}
              signature={timeline.signature}
              commitProjectChange={commitProjectChange}
              commitProjectPatch={store.commitProjectPatch}
              isMediaDrawerOpen={false}
              mediaDrawerTab="media"
              onSelectMediaDrawerTab={noop}
              isPlaying={isPlaying}
              isRecording={false}
            />
            <div
              ref={layout.editorGridRef}
              className="editor-grid"
              style={{
                ["--preview-width" as string]: `${layout.effectivePreviewWidth}px`,
              }}
            >
              {/* The closed Media drawer's column. */}
              <div />
              <Timeline
                {...timeline}
                timelineScrollRef={timelineScrollRef}
                labelResize={layout.labelResize}
                playheadSignal={playheadSignal}
                footer={
                  <AudioRow
                    mix={audioMix}
                    openAudioMenu={editing.openAudioMenu}
                    prefersReducedMotion={prefersReducedMotion}
                    bpm={bpm}
                    quarterPx={quarterPx}
                    visibleTimelineStartPx={visibleTimelineStartPx}
                    visibleTimelineWidthPx={visibleTimelineWidthPx}
                    gridStyle={gridStyle}
                    playheadSignal={playheadSignal}
                    isCollapsed={layout.isAudioRowCollapsed}
                    setCollapsed={layout.setAudioRowCollapsed}
                    expandedHeight={layout.audioRowHeight}
                    onResize={layout.resizeAudioRow}
                  />
                }
              >
                <Ruler
                  {...timeline}
                  {...playback}
                  sessionName={project.sessionName}
                  mediaSyncStatusLabel={null}
                  offlineCount={0}
                  showsMediaSync={false}
                  relinkingMediaIds={NO_IDS}
                  sessionMediaStatus=""
                  setIsMediaSyncDialogOpen={noop}
                  setIsOfflineMediaDialogOpen={noop}
                  timelineScrollRef={timelineScrollRef}
                  shortcutLabels={shortcutLabels}
                  timelineDragState={selection.timelineDragState}
                  setTimelineDragState={selection.setTimelineDragState}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  setPlayheadQ={setPlayheadQ}
                  playbackOriginRef={playbackOriginRef}
                  playheadSignal={playheadSignal}
                  labelWidth={labelWidth}
                  timelineMode={project.timelineMode}
                  bpm={bpm}
                  fps={fps}
                  snapEnabled={project.snapEnabled}
                  timelineContentEndQ={editing.timelineContentEndQ}
                />
                <ArrangementLanes
                  arrangementLanesRef={arrangementLanesRef}
                  lanes={lanes}
                  readOnly={store.isWorkspaceReadOnly}
                  onCreateLayer={editing.handleCreateLayer}
                  fxLaneId={fxPanel.fxLaneId}
                  laneStatusById={timeline.laneStatusById}
                  clipsByLane={timeline.clipsByLane}
                  rowHeights={layout.rowHeights}
                  emptyState={null}
                  header={{
                    layerReorder: editing.layerReorder,
                    renamingLaneId: selection.renamingLaneId,
                    setRenamingLaneId: selection.setRenamingLaneId,
                    readOnly: store.isWorkspaceReadOnly,
                    openLayerMenu: editing.openLayerMenu,
                    selectLaneFromLabel: selection.selectLaneFromLabel,
                    focusLaneLabel: selection.focusLaneLabel,
                    commitLayerRename: editing.commitLayerRename,
                    setLayerFxEnabled: fxEditing.setLayerFxEnabled,
                    setLayerHidden: fxEditing.setLayerHidden,
                    toggleRowCollapsed: layout.toggleRowCollapsed,
                    resizeRow: layout.resizeRow,
                  }}
                  row={{
                    openLaneMenu: editing.openLaneMenu,
                    shortcutLabels,
                    timelineScrollRef,
                    labelWidth,
                    quarterPx,
                    totalQuarters: timeline.totalQuarters,
                    snapUnit: timeline.snapUnit,
                    snapEnabled: project.snapEnabled,
                    gridCellQ: timeline.gridCellQ,
                    gridStyle,
                    pendingSelection,
                    setPendingSelection,
                    setSelectedClipId,
                    setSelectedLaneId: selection.setSelectedLaneId,
                    setIsPlaying,
                    setDragPreviewClips,
                    setDragState,
                    clipCard: {
                      selectedClipId: selectedClip?.id,
                      dragState,
                      bpm,
                      quarterPx,
                      visibleTimelineStartPx,
                      visibleTimelineWidthPx,
                      signature: timeline.signature,
                      mediaItemsById,
                      thumbnails: timeline.thumbnails,
                      clipPieces: timeline.clipPieces,
                      clipFilmstrips: timeline.clipFilmstrips,
                      remoteMediaProgress: NO_REMOTE_PROGRESS,
                      timelineEffects,
                      effects,
                      prefersReducedMotion,
                      revealedMediaIds: NO_IDS,
                      shortcutLabels,
                      openArrangementClipMenu: editing.openArrangementClipMenu,
                      startTextEdit: noop,
                      setPendingSelection,
                      setDragPreviewClips,
                      setSelectedClipId,
                      setDragState,
                    },
                  }}
                />
                <SourceTracks
                  sourceTracks={sourceTracks}
                  sourceSpansByTrack={timeline.sourceSpansByTrack}
                  rowHeights={layout.rowHeights}
                  isSourceTracksCollapsed={layout.isSourceTracksCollapsed}
                  setSourceTracksCollapsed={layout.setSourceTracksCollapsed}
                  sourceTracksLocked={editing.sourceTracksLocked}
                  setSourceTracksLocked={editing.setSourceTracksLocked}
                  drop={NO_DROP}
                  readOnly={store.isWorkspaceReadOnly}
                  onCreateSourceTrack={editing.createEmptySourceTrack}
                  sourceSelection={selection.sourceSelection}
                  selectSource={selection.selectSource}
                  onImport={noop}
                  onOpenSample={noop}
                  onOpenSession={noop}
                  gridStyle={gridStyle}
                  listRef={editing.sourceTracksListRef}
                  armedTrackIds={NO_IDS}
                  liveTakes={NO_LIVE_TAKES}
                  label={{
                    reorder: editing.sourceTrackReorder,
                    openMenu: editing.openSourceTrackMenu,
                    locked: editing.sourceTracksLocked,
                    renamingId: editing.renamingSourceTrackId,
                    startRename: editing.setRenamingSourceTrackId,
                    readOnly: store.isWorkspaceReadOnly,
                    commitRename: editing.commitSourceTrackRename,
                    cancelRename: editing.cancelSourceTrackRename,
                    setFxEnabled: fxEditing.setSourceTrackFxEnabled,
                    setHidden: fxEditing.setSourceTrackHidden,
                    toggleRowCollapsed: layout.toggleRowCollapsed,
                    resizeRow: layout.resizeRow,
                  }}
                  openLaneMenu={editing.openSourceLaneMenu}
                  span={{
                    bpm,
                    quarterPx,
                    visibleTimelineStartPx,
                    visibleTimelineWidthPx,
                    mediaItemsById,
                    thumbnails: timeline.thumbnails,
                    spanFilmstrips: timeline.spanFilmstrips,
                    remoteMediaProgress: NO_REMOTE_PROGRESS,
                    prefersReducedMotion,
                    revealedMediaIds: NO_IDS,
                    clipMenu: selection.clipMenu,
                    sourceSelection: selection.sourceSelection,
                    selectSourceSpan: selectSourceSpanClip,
                    shortcutLabels,
                    addSourceSpanToArrangement:
                      editing.addSourceSpanToArrangement,
                    openSourceSpanMenu: editing.openSourceSpanMenu,
                    sourceSpanDrag: selection.sourceSpanDrag,
                    setSourceSpanDrag: selection.setSourceSpanDrag,
                    locked: editing.sourceTracksLocked,
                  }}
                />
              </Timeline>
              {/* The preview's resize handle and panel. */}
              <div style={{ gridColumn: "3 / 5" }} />
            </div>
            <TransportBar
              {...timeline}
              {...previewVolume}
              getMeterTap={() => null}
              isPlaying={isPlaying}
              {...playback}
              playheadSignal={playheadSignal}
              onTransportToggle={playback.handleTransportToggle}
              onRandomize={editing.handleRandomizeTimeline}
              canRecord={false}
              isRecording={false}
              toggleRecording={noop}
            />
          </section>
          <FxModulationClockContext.Provider value={modulationClock}>
            <FxAnimationTimelineContext.Provider value={animationTimeline}>
              <FxPanel
                {...fxEditing}
                {...fxPanel}
                {...layout}
                sourceClip={null}
              />
            </FxAnimationTimelineContext.Provider>
          </FxModulationClockContext.Provider>
        </div>
      </main>
      <TimelineContextMenu
        clipMenu={selection.clipMenu}
        getClipMenuEntries={editing.getClipMenuEntries}
        onClose={() => selection.setClipMenu(null)}
      />
    </div>
  );
}

// Renders the editor in a fresh layout: the layout preferences the app
// keeps in localStorage start from their defaults.
export function renderEditor(props: EditorHarnessProps = {}) {
  localStorage.clear();
  return render(<EditorHarness {...props} />);
}

// Sessions to open the editor with.

// A new session with `count` layers, "1" to `count`, as a new session with
// layers added after Layer 1.
export function sessionWithLayers(count = 1): ProjectState {
  const lanes: Lane[] = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `Layer ${index + 1}`,
    colorIndex: -1,
  }));
  return {
    ...INITIAL_PROJECT_STATE,
    lanes,
    effects: ensureLayerLayouts(
      INITIAL_PROJECT_STATE.effects,
      lanes.map((lane) => lane.id),
    ),
  };
}

// The e2e specs' four-second, 160×90 test pattern with no sound, as
// importing it makes it.
export const TEST_PATTERN: MediaItem = {
  id: "media-test-pattern",
  name: "test-pattern.mp4",
  kind: "video",
  durationSeconds: 4,
  width: 160,
  height: 90,
  fps: 30,
  hasAudio: false,
  hasVideo: true,
  color: "#3d4052",
  accent: "#7ca1ff",
  previewUrl: testPatternUrl,
  availability: "ready",
};

// `project` with the test pattern dropped into a new source track, as
// dropping the file there does.
export function withTestPatternTrack(project: ProjectState): ProjectState {
  return {
    ...project,
    mediaItems: [...project.mediaItems, TEST_PATTERN],
    ...addMediaToSourceTrack(project, [TEST_PATTERN], { kind: "new-track" }),
  };
}

// `project` with a fill clip, `id`, of `durationQ` quarters from `startQ`
// on layer `laneId`, as Insert Fill Clip makes one.
export function withFillClip(
  project: ProjectState,
  { id, laneId, startQ = 0, durationQ = 8 }: FillClipFixture,
): ProjectState {
  const { clips, effects } = addFillClip(project, {
    id,
    laneId,
    startQ,
    durationQ,
    bpm: project.bpm,
    tint: "#2a2d38",
    accent: "#8d93a8",
    color: "#8d93a8",
    effectId: `${id}-color`,
  });
  return { ...project, clips: clips as ArrangementClip[], effects };
}

type FillClipFixture = {
  id: string;
  laneId: string;
  startQ?: number;
  durationQ?: number;
};
