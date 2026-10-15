/// <reference types="@vitest/browser-playwright" />

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { expect, onTestFinished } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import testPatternUrl from "../../e2e/fixtures/test-pattern.mp4?url";
import type { ClipClipboard } from "../app/clip-ops.ts";
import { INITIAL_PROJECT_STATE, signatureById } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import { selectSourceSpan } from "../app/source-selection.ts";
import type { Lane, ProjectState, SourceSpan } from "../app/types.ts";
import type { WorkspaceAccess } from "../app/workspace-types.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import type { CompositionPlayerHandle } from "../CompositionPlayer";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock";
import { PreviewPanel } from "../components/PreviewPanel";
import { TimelineContextMenu } from "../components/TimelineContextMenu";
import { TopBar } from "../components/TopBar";
import { ArrangementLanes } from "../components/timeline/ArrangementLanes";
import { AudioRow } from "../components/timeline/AudioRow";
import { Ruler } from "../components/timeline/Ruler";
import { SourceTracks } from "../components/timeline/SourceTracks";
import { Timeline } from "../components/timeline/Timeline";
import { TimelineToolbar } from "../components/timeline/TimelineToolbar";
import { TransportBar } from "../components/timeline/TransportBar";
import { ensureLayerLayouts } from "../fx-stack.ts";
import { installHarness } from "../harness";
import { useAppLayout } from "../hooks/useAppLayout.ts";
import { useAudioMix } from "../hooks/useAudioMix.ts";
import { useCollaborationState } from "../hooks/useCollaboration.ts";
import { useFxContexts } from "../hooks/useFxContexts.ts";
import { useFxEditing } from "../hooks/useFxEditing.ts";
import { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import { useMediaPreview } from "../hooks/useMediaPreview.ts";
import { useMediaRange } from "../hooks/useMediaRange.ts";
import { usePlayback } from "../hooks/usePlayback.ts";
import { usePreview } from "../hooks/usePreview.ts";
import { usePreviewVolume } from "../hooks/usePreviewVolume.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "../hooks/useProjectStore.ts";
import { useSourceClipProperties } from "../hooks/useSourceClipProperties.ts";
import { useSourceTrackDrop } from "../hooks/useSourceTrackDrop.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import { useTimelineEditing } from "../hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "../hooks/useTimelineSelection.ts";
import type { MediaItem } from "../media";
import { addMediaToSourceTrack } from "../source-track-media.ts";
import { createSpaceHold } from "../space-shortcut";

// The desktop editor for component tests whose behavior needs App's hooks
// wired together: the top bar's menubar, the toolbar, the timeline (ruler,
// layers, source tracks and Audio row), the transport bar, the FX panel, the
// context menus and, when asked for, the preview, wired through the hooks
// App wires them with (useProjectStore, useTimelineSelection, useAppLayout,
// useTimeline, usePlayback, useFxEditing, useFxPanelModel,
// useSourceClipProperties, usePreview and useTimelineEditing), so edits,
// undo, menus, drags, keyboard shortcuts and playback of the playhead behave
// as in the app. A test of one component should render that component on
// its own instead (see ARCHITECTURE.md).
//
// It leaves out the Media drawer, media import, recording, collaboration and
// session persistence: media comes in through the session it opens (see
// withMedia), and drops onto the source tracks import nothing.

const noop = () => {};
const noopAsync = async () => false;

const NO_IDS: ReadonlySet<string> = new Set();
const NO_LIVE_TAKES = new Map();
const NO_REMOTE_PROGRESS = new Map();

// Tests that render the whole editor and drive it through many presses and
// menus take longer than the 15 s default allows on a busy machine.
export const EDITOR_TEST_TIMEOUT = 60_000;

// What a test reads back from the editor.
export type EditorState = {
  project: ProjectState;
  canUndo: boolean;
  isPlaying: boolean;
  // The live playhead, which playback advances between renders.
  playheadQ: () => number;
  isTakeOverPromptOpen: boolean;
  // The status bar's message, such as what an edit did.
  status: string;
};

type EditorProps = {
  // The session the editor opens, swapped in without an undo step: a whole
  // one, or changes from the blank session.
  project?: Partial<ProjectState>;
  // "read-only" opens it as a tab that doesn't own the session.
  access?: WorkspaceAccess;
  // Shows the preview panel, which composites the clips at the playhead.
  preview?: boolean;
  // Called on every render with what the editor holds.
  onState?: (state: EditorState) => void;
};

export function Editor({
  project: projectPatch,
  access = "owner",
  preview: showsPreview = false,
  onState,
}: EditorProps) {
  const store = useProjectStore({ access, restoredSession: null });
  const { dispatchProjectHistory } = store;
  const [initialProject] = useState(
    () => projectPatch && { ...INITIAL_PROJECT_STATE, ...projectPatch },
  );
  const [opened, setOpened] = useState(!initialProject);
  useLayoutEffect(() => {
    if (initialProject && !opened) {
      dispatchProjectHistory({ type: "replace", snapshot: initialProject });
      setOpened(true);
    }
  }, [initialProject, opened]);
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
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const playbackOriginRef = useRef(store.initialPlayheadQ);
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null);
  const layout = useAppLayout({ sourceTrackCount: sourceTracks.length });
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("");
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
  const mediaRange = useMediaRange({ commitProjectChange });
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
  const preview = usePreview({
    project,
    selection,
    mediaItemsById,
    lanePriority,
    editEffects: fxEditing.editEffects,
    isPlaying,
    setIsPlaying,
    playbackOriginRef,
    playheadQ,
    playheadQRef,
    setPlayheadQ,
    refuseReadOnlyEdit: store.refuseReadOnlyEdit,
  });
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
  const sourceClip = useSourceClipProperties({
    sourceSelection: selection.sourceSelection,
    sourceSpans: project.sourceSpans,
    timelineSourceSpans: selection.timelineSourceSpans,
    setDragPreviewSourceSpans: selection.setDragPreviewSourceSpans,
    mediaItemsById,
    timelineMode: project.timelineMode,
    signatureId: project.signatureId,
    bpm,
    fps,
    totalQuarters: timeline.totalQuarters,
    isWorkspaceReadOnlyRef: store.isWorkspaceReadOnlyRef,
    refuseReadOnlyEdit: store.refuseReadOnlyEdit,
    commitProjectChange,
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
  // Playback runs over what the compositor draws, as in App.
  const playback = usePlayback({
    playbackOriginRef,
    timelineClips: preview.renderClips,
    timelineClipsRef: selection.timelineClipsRef,
    projectMediaItems: project.mediaItems,
    sourceSpans: project.sourceSpans,
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
  // Drops onto the source tracks import nothing.
  const sourceTrackDrop = useSourceTrackDrop({
    mediaItems: project.mediaItems,
    bpm: project.bpm,
    appShellRef,
    timelineScrollRef,
    labelWidth,
    quarterPx,
    snapUnit: timeline.snapUnit,
    snapEnabled: project.snapEnabled,
    importMediaIntoSourceTrack: async () => {},
    placeMediaInSourceTrack: noop,
    importMediaIntoBin: async () => {},
    mediaDrawer: { showMediaView: noop, setIsDropTarget: noop },
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
    status,
  });

  return (
    <div className="app-shell" ref={appShellRef}>
      <TopBar
        canStartNewSession={false}
        handleNewSession={noop}
        handleOpenSession={noopAsync}
        sample={{ openSample: noop }}
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
                  {...layout}
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
                  timelineDragState={selection.timelineDragState}
                  setTimelineDragState={selection.setTimelineDragState}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  setPlayheadQ={setPlayheadQ}
                  playbackOriginRef={playbackOriginRef}
                  playheadSignal={playheadSignal}
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
                  {...layout}
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
                  drop={sourceTrackDrop}
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
              {showsPreview ? (
                <PreviewPanel
                  {...preview}
                  {...layout}
                  bpm={bpm}
                  canvasHeight={project.canvasHeight}
                  canvasWidth={project.canvasWidth}
                  compositionPlayerRef={compositionPlayerRef}
                  fps={fps}
                  isPlaying={isPlaying}
                  isTimelineAudibleScrubbing={
                    playback.isTimelineAudibleScrubbing
                  }
                  mediaItems={project.mediaItems}
                  mediaPreview={mediaPreview}
                  mediaRange={mediaRange}
                  mediaTimeFormat={{
                    timelineMode: project.timelineMode,
                    bpm,
                    fps,
                    signature: timeline.signature,
                  }}
                  previewVolume={previewVolume.previewVolume}
                  playheadSignal={playheadSignal}
                  previewLaneId={selection.previewLaneId}
                  projectDurationFrames={project.projectDurationFrames}
                  selectedClip={selectedClip}
                  timelineDragState={selection.timelineDragState}
                />
              ) : (
                // The preview's resize handle and panel.
                <>
                  <div />
                  <div />
                </>
              )}
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
                sourceClip={sourceClip}
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

function emulateReducedMotion(reduce: boolean) {
  return cdp().send("Emulation.setEmulatedMedia", {
    features: reduce
      ? [{ name: "prefers-reduced-motion", value: "reduce" }]
      : [],
  });
}

// Renders the editor in a fresh layout: the layout preferences the app
// keeps in localStorage start from their defaults. Like main.tsx, it first
// installs the web harness, which media thumbnails are read through. With
// `reducedMotion`, the page prefers reduced motion, so pans have no momentum
// and scrolls don't animate, until the test ends.
export async function renderEditor({
  reducedMotion = false,
  ...props
}: EditorProps & { reducedMotion?: boolean } = {}) {
  localStorage.clear();
  if (!window.harness) {
    await installHarness();
  }
  if (reducedMotion) {
    await emulateReducedMotion(true);
    onTestFinished(async () => {
      await emulateReducedMotion(false);
    });
  }
  const screen = await render(<Editor {...props} />);
  await expect
    .poll(() => document.querySelector("[data-timeline-lane-id]"))
    .not.toBeNull();
  return screen;
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

// The e2e specs' four-second, 160×90, 15 fps test pattern, without sound,
// as importing it makes it.
export function testPatternVideo(id = "media-test-pattern"): MediaItem {
  return {
    id,
    name: "test-pattern.mp4",
    kind: "video",
    durationSeconds: 4,
    width: 160,
    height: 90,
    fps: 15,
    hasAudio: false,
    hasVideo: true,
    color: "#3d4052",
    accent: "#7ca1ff",
    previewUrl: testPatternUrl,
    availability: "ready",
  };
}

// `project` with each of `items` dropped into a new source track of its
// own, as dropping their files does.
export function withMedia(
  items: MediaItem[],
  project: ProjectState = INITIAL_PROJECT_STATE,
): ProjectState {
  return items.reduce(
    (current, item) =>
      patchProjectState(current, {
        mediaItems: [...current.mediaItems, item],
        ...addMediaToSourceTrack(current, [item], { kind: "new-track" }),
      }),
    project,
  );
}

// `project` with the test pattern dropped into a new source track.
export function withTestPatternTrack(
  project: ProjectState = INITIAL_PROJECT_STATE,
): ProjectState {
  return withMedia([testPatternVideo()], project);
}
