import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { ClipClipboard } from "../app/clip-ops.ts";
import type { ProjectState } from "../app/types.ts";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock";
import { TimelineContextMenu } from "../components/TimelineContextMenu";
import { ArrangementLanes } from "../components/timeline/ArrangementLanes";
import { Ruler } from "../components/timeline/Ruler";
import { Timeline } from "../components/timeline/Timeline";
import { TimelineToolbar } from "../components/timeline/TimelineToolbar";
import { TransportBar } from "../components/timeline/TransportBar";
import { useAppLayout } from "../hooks/useAppLayout.ts";
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
import { useTimeline } from "../hooks/useTimeline.ts";
import { useTimelineEditing } from "../hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "../hooks/useTimelineSelection.ts";
import type { MediaItem } from "../media";
import { createSpaceHold } from "../space-shortcut";

// The desktop editor's timeline, wired as App wires it: the toolbar, the
// timeline with its ruler and layers, the transport bar and the FX panel,
// driven by the same project store, selection, layout, viewport, playback
// and editing hooks (keyboard shortcuts, menus and clip drags included).
// It leaves out what needs the wasm compositor, media or a saved session:
// the preview, the Media drawer, the source tracks, the Audio row's mix and
// session persistence. Their grid cells keep their places so the timeline
// lays out at the width it has in the app.

const noop = () => {};
const NO_MEDIA = new Map<string, MediaItem>();

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
  const arrangementLanesRef = useRef<HTMLDivElement | null>(null);
  const clipClipboardRef = useRef<ClipClipboard | null>(null);
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
  const mediaPreview = useMediaPreview({
    isPlaying,
    setIsPlaying,
    mediaItemsById: NO_MEDIA,
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
    mediaItemsById: NO_MEDIA,
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
    mediaItemsById: NO_MEDIA,
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
    mediaItemsById: NO_MEDIA,
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

  onState?.({
    project,
    canUndo: store.canUndo,
    isPlaying,
    playheadQ: () => playheadQRef.current,
    setPlayheadQ,
  });

  return (
    <div className="app-shell">
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
                  relinkingMediaIds={new Set()}
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
                      mediaItemsById: NO_MEDIA,
                      thumbnails: timeline.thumbnails,
                      clipPieces: timeline.clipPieces,
                      clipFilmstrips: timeline.clipFilmstrips,
                      remoteMediaProgress: new Map(),
                      timelineEffects,
                      effects,
                      prefersReducedMotion,
                      revealedMediaIds: new Set(),
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
export function renderTimelineEditor(props: TimelineEditorProps = {}) {
  localStorage.clear();
  return render(<TimelineEditor {...props} />);
}
