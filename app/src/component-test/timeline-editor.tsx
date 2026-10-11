import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { expect, onTestFinished } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { ClipClipboard } from "../app/clip-ops.ts";
import { selectSourceSpan } from "../app/source-selection.ts";
import type { ProjectState, SourceSpan } from "../app/types.ts";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock";
import { TimelineContextMenu } from "../components/TimelineContextMenu";
import { TopBar } from "../components/TopBar";
import { ArrangementLanes } from "../components/timeline/ArrangementLanes";
import { Ruler } from "../components/timeline/Ruler";
import { SourceTracks } from "../components/timeline/SourceTracks";
import { Timeline } from "../components/timeline/Timeline";
import { TimelineToolbar } from "../components/timeline/TimelineToolbar";
import { TransportBar } from "../components/timeline/TransportBar";
import { useAppLayout } from "../hooks/useAppLayout.ts";
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
import type { LiveTake } from "../hooks/useRecording.ts";
import { useSourceTrackDrop } from "../hooks/useSourceTrackDrop.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import { useTimelineEditing } from "../hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "../hooks/useTimelineSelection.ts";
import type { MediaItem } from "../media";
import { createSpaceHold } from "../space-shortcut";
import { center, click, down, move, resetMouse, up } from "./timeline-mouse.ts";

// The desktop editor's timeline, wired as App wires it: the top bar, the
// toolbar, the timeline with its ruler, layers and source tracks, the
// transport bar and the FX panel, driven by the same project store,
// selection, layout, viewport, playback and editing hooks (keyboard
// shortcuts, menus and clip drags included).
// It leaves out what needs the wasm compositor, media or a saved session:
// the preview, the Media drawer, the Audio row's mix, media import and
// recording, collaboration and session persistence. The preview's grid
// cells keep their places, so the timeline lays out about where it does in
// the app.

const noop = () => {};
const noopAsync = async () => false;
const NO_IDS = new Set<string>();
const NO_PROGRESS = new Map();
const NO_TAKES = new Map<string, LiveTake>();

export type TimelineEditorState = {
  project: ProjectState;
  canUndo: boolean;
  isPlaying: boolean;
  playheadQ: () => number;
  setPlayheadQ: (q: number) => void;
};

type TimelineEditorProps = {
  // Changes from the blank session the editor opens with, swapped in
  // without an undo step.
  project?: Partial<ProjectState>;
  // Called on every render with what the editor holds.
  onState?: (state: TimelineEditorState) => void;
};

export function TimelineEditor({
  project: projectPatch,
  onState,
}: TimelineEditorProps) {
  const collaboration = useCollaborationState();
  const store = useProjectStore({ access: "owner", restoredSession: null });
  const {
    projectHistory,
    playheadQ,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    refuseReadOnlyEdit,
    commitProjectChange,
  } = store;
  const [initialPatch] = useState(projectPatch);
  // biome-ignore lint/correctness/useExhaustiveDependencies: swaps in the fixture once, on mount
  useLayoutEffect(() => {
    if (initialPatch) {
      store.dispatchProjectHistory({
        type: "replace",
        snapshot: { ...INITIAL_PROJECT_STATE, ...initialPatch },
      });
    }
  }, []);
  const project = projectHistory.present;
  const { timelineMode, bpm, fps, lanes, sourceTracks, clips, effects } =
    project;

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
  const layout = useAppLayout({ sourceTrackCount: sourceTracks.length });
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setStatus] = useState("");
  const playbackOriginRef = useRef(store.initialPlayheadQ);
  const compositionPlayerRef = useRef(null);
  const previewVolume = usePreviewVolume(compositionPlayerRef);
  const spaceHoldRef = useRef(createSpaceHold());
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const arrangementLanesRef = useRef<HTMLDivElement | null>(null);
  const clipClipboardRef = useRef<ClipClipboard | null>(null);
  const mediaItemsById = useMemo(
    () => new Map<string, MediaItem>(project.mediaItems.map((item) => [item.id, item])),
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
  const { quarterPx, totalQuarters, gridStyle } = timeline;
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
    totalQuarters,
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
    appShellRef,
    timelineScrollRef,
    labelWidth,
    quarterPx,
    snapUnit: timeline.snapUnit,
    snapEnabled: project.snapEnabled,
    importMediaIntoSourceTrack: async () => {},
    placeMediaInSourceTrack: noop,
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
    refreshAudio: noop,
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
  const { selectSource } = selection;
  const selectSourceSpanClip = useCallback(
    (span: SourceSpan) => selectSource(selectSourceSpan(span)),
    [selectSource],
  );
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

  onState?.({
    project,
    canUndo: store.canUndo,
    isPlaying,
    playheadQ: () => playheadQRef.current,
    setPlayheadQ,
  });

  return (
    <div className="app-shell" ref={appShellRef}>
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
                footer={null}
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
                  timelineMode={timelineMode}
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
                    totalQuarters,
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
                      remoteMediaProgress: NO_PROGRESS,
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
                  liveTakes={NO_TAKES}
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
                    remoteMediaProgress: NO_PROGRESS,
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
              <div />
              <div />
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

function emulateReducedMotion(reduce: boolean) {
  const session = cdp() as unknown as {
    send: (method: string, params: Record<string, unknown>) => Promise<void>;
  };
  return session.send("Emulation.setEmulatedMedia", {
    features: reduce ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
  });
}

// Renders the editor in a fresh layout: the layout preferences the app
// keeps in localStorage start from their defaults. With `reducedMotion`,
// the page prefers reduced motion, so pans have no momentum and scrolls
// don't animate, until the test ends.
export async function renderTimelineEditor({
  reducedMotion = false,
  ...props
}: TimelineEditorProps & { reducedMotion?: boolean } = {}) {
  localStorage.clear();
  onTestFinished(async () => {
    await resetMouse();
    await emulateReducedMotion(false);
  });
  await emulateReducedMotion(reducedMotion);
  const screen = await render(<TimelineEditor {...props} />);
  await expect
    .poll(() => document.querySelector('[data-timeline-lane-id="1"]'))
    .not.toBeNull();
  return screen;
}

// A generous per-test timeout: each test renders the whole editor, which is
// slow on a busy machine.
export const TIMELINE_EDITOR_TIMEOUT = 60_000;

// Draws a selection on Layer 1 from `fromX` to `toX` (offsets into the
// lane) and inserts a text clip over it from the selection's menu, as the
// e2e specs do. The clip stays selected, with its Text effect in the FX
// panel.
export async function insertTextClip(fromX = 20, toX = 400) {
  const lane = document.querySelector(
    '[data-timeline-lane-id="1"]',
  ) as HTMLElement;
  const bounds = lane.getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + (fromX + toX) / 2, y);
  await move(bounds.x + toX, y);
  await up();
  await click(bounds.x + (fromX + toX) / 2, bounds.y + 20, {
    button: "right",
  });
  const item = page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" });
  await expect.element(item).toBeVisible();
  await click(center(item.element()).x, center(item.element()).y);
  await expect
    .poll(() => lane.querySelectorAll(".clip-card--text").length)
    .toBe(1);
  return bounds;
}

// Drags out a playback selection in the loop strip from `fromX` to `toX`
// (client x) and locks it into the loop with L.
export async function createLoop(fromX: number, toX: number) {
  const strip = (
    document.querySelector(".ruler-loop-strip") as HTMLElement
  ).getBoundingClientRect();
  const y = strip.y + strip.height / 2;
  await move(fromX, y);
  await down();
  await move(toX, y, { steps: 10 });
  await up();
  await userEvent.keyboard("L");
  await expect
    .poll(() => document.querySelector(".ruler-loop-region"))
    .not.toBeNull();
  const region = document.querySelector(".ruler-loop-region") as HTMLElement;
  return {
    region,
    box: region.getBoundingClientRect(),
    startQ: Number(region.dataset.startQ),
    endQ: Number(region.dataset.endQ),
  };
}

// Where the playhead is, in quarters: the ruler marker's `translateX` is the
// playhead's position less a pixel, and the second bar marker sits a bar
// (four quarters, in 4/4) in.
export function readPlayheadQ() {
  const marker = document.querySelector(
    ".timeline-playhead-marker",
  ) as HTMLElement;
  const bars = document.querySelectorAll<HTMLElement>(".ruler-marker");
  const left = Number(
    /translateX\((-?[\d.]+)px\)/.exec(marker.style.transform)?.[1],
  );
  const quarterPx = Number.parseFloat(bars[1].style.left) / 4;
  return (left + 1) / quarterPx;
}

// The playhead in quarters every frame for `durationMs`.
export function samplePlayheadQ(durationMs: number) {
  return new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    const startedAt = performance.now();
    const sample = () => {
      samples.push(readPlayheadQ());
      if (performance.now() - startedAt < durationMs) {
        requestAnimationFrame(sample);
      } else {
        resolve(samples);
      }
    };
    requestAnimationFrame(sample);
  });
}
