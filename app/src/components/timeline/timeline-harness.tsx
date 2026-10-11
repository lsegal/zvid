import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipClipboard } from "../../app/clip-ops.ts";
import {
  INITIAL_PROJECT_STATE,
  signatureById,
} from "../../app/constants.ts";
import { patchProjectState } from "../../app/session-project.ts";
import { DEFAULT_PREVIEW_VOLUME } from "../../app/preview-volume.ts";
import { selectSourceSpan } from "../../app/source-selection.ts";
import type { ProjectState, SourceSpan } from "../../app/types.ts";
import { resolveAudioClips } from "../../audio-mix/resolve.ts";
import { useAppLayout } from "../../hooks/useAppLayout.ts";
import { useAudioMix } from "../../hooks/useAudioMix.ts";
import { useFxEditing } from "../../hooks/useFxEditing.ts";
import { useFxPanelModel } from "../../hooks/useFxPanelModel.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "../../hooks/useProjectStore.ts";
import { useSourceClipProperties } from "../../hooks/useSourceClipProperties.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import { useTimeline } from "../../hooks/useTimeline.ts";
import { useTimelineEditing } from "../../hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "../../hooks/useTimelineSelection.ts";
import type { MediaItem } from "../../media";
import { addMediaToSourceTrack } from "../../source-track-media.ts";
import { createSpaceHold } from "../../space-shortcut";
import testPatternUrl from "../../../e2e/fixtures/test-pattern.mp4?url";
import { FxPanel } from "../FxPanel";
import { TimelineContextMenu } from "../TimelineContextMenu";
import { ArrangementLanes } from "./ArrangementLanes";
import { AudioRow } from "./AudioRow";
import { Ruler } from "./Ruler";
import { SourceTracks } from "./SourceTracks";
import { Timeline } from "./Timeline";
import { TimelineToolbar } from "./TimelineToolbar";
import { TransportBar } from "./TransportBar";

// The desktop editor without the preview, the media drawer or media import,
// for component tests of the timeline: the toolbar, the timeline (ruler,
// layers, source tracks and Audio row), the transport bar, the FX panel and
// the context menus, wired through the hooks App wires them with
// (useProjectStore, useTimelineSelection, useAppLayout, useTimeline,
// useFxEditing, useFxPanelModel and useTimelineEditing), so edits, undo,
// menus, drags and keyboard shortcuts behave as in the app. Playback is a
// stub that only moves the playhead.

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

const NO_ARMED_TRACKS: ReadonlySet<string> = new Set();
const NO_LIVE_TAKES = new Map();
const NO_REMOTE_PROGRESS = new Map();
const NO_REVEALED_MEDIA: ReadonlySet<string> = new Set();
const noop = () => {};

// The e2e specs' four-second, 160×90, 15 fps test pattern, without audio.
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

// A new session with each of `items` dropped into a new source track of its
// own, as dropping their files does.
export function projectWithMedia(items: MediaItem[]): ProjectState {
  return items.reduce(
    (current, item) =>
      patchProjectState(current, {
        mediaItems: [...current.mediaItems, item],
        ...addMediaToSourceTrack(current, [item], { kind: "new-track" }),
      }),
    INITIAL_PROJECT_STATE,
  );
}

export type TimelineHarnessProps = {
  // The session to open, in place of a new one.
  project?: ProjectState;
};

export function TimelineHarness({ project: initialProject }: TimelineHarnessProps) {
  const store = useProjectStore({ access: "owner", restoredSession: null });
  const { dispatchProjectHistory } = store;
  // Opens the given session as the app opens a saved one: no undo step.
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
    playheadSignal,
    setPlayheadQ,
    commitProjectChange,
  } = store;
  const project = projectHistory.present;
  const { lanes, sourceTracks, clips, effects, bpm } = project;

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
  const playbackOriginRef = useRef(0);
  const layout = useAppLayout({ sourceTrackCount: sourceTracks.length });
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setStatus] = useState("");

  const mediaItemsById = useMemo(
    () => new Map(project.mediaItems.map((item) => [item.id, item])),
    [project.mediaItems],
  );
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
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
  const sourceClip = useSourceClipProperties({
    sourceSelection: selection.sourceSelection,
    sourceSpans: project.sourceSpans,
    timelineSourceSpans: selection.timelineSourceSpans,
    setDragPreviewSourceSpans: selection.setDragPreviewSourceSpans,
    mediaItemsById,
    timelineMode: project.timelineMode,
    signatureId: project.signatureId,
    bpm,
    fps: project.fps,
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

  // Playback without media: playing only flips the flag, and seeks move the
  // playhead.
  const jumpPlayheadTo = useCallback(
    (nextQ: number) => {
      playbackOriginRef.current = nextQ;
      setPlayheadQ(nextQ);
    },
    [setPlayheadQ],
  );
  const playback = {
    cancelScrubPlaybackResume: noop,
    startPlayback: () => setIsPlaying(true),
    jumpPlayheadTo,
    jumpToClipStart: noop,
    playableClipCount: 0,
    playFromLoopStart: noop,
    skipToEdge: noop,
    pulseTimelineAudibleScrub: noop,
    stopTimelineAudibleScrub: noop,
  };
  const historyCommands = useProjectHistoryCommands({
    ...store,
    finishTextEdit: noop,
    stopTimelineAudibleScrub: noop,
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
    mediaPreview: { previewTab: "timeline", toggleMediaPlayback: noop },
    setStatus,
  });
  const { selectSource } = selection;
  const selectSourceSpanClip = useCallback(
    (span: SourceSpan) => selectSource(selectSourceSpan(span)),
    [selectSource],
  );

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
            <div className="editor-grid">
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
                  mediaSyncStatusLabel={null}
                  offlineCount={0}
                  showsMediaSync={false}
                  relinkingMediaIds={NO_REVEALED_MEDIA}
                  sessionMediaStatus=""
                  sessionName={project.sessionName}
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
                  fps={project.fps}
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
                      revealedMediaIds: NO_REVEALED_MEDIA,
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
                  armedTrackIds={NO_ARMED_TRACKS}
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
                    revealedMediaIds: NO_REVEALED_MEDIA,
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
              <div />
              <div />
            </div>
            <TransportBar
              {...timeline}
              {...playback}
              previewVolume={DEFAULT_PREVIEW_VOLUME}
              setPreviewVolume={noop}
              togglePreviewMute={noop}
              getMeterTap={() => null}
              isPlaying={isPlaying}
              jumpHalfBar={noop}
              playbackEndQ={editing.timelineContentEndQ}
              playheadSignal={playheadSignal}
              onTransportToggle={() => setIsPlaying((playing) => !playing)}
              onRandomize={editing.handleRandomizeTimeline}
              canRecord={false}
              isRecording={false}
              toggleRecording={noop}
            />
          </section>
          <FxPanel
            {...fxEditing}
            {...fxPanel}
            {...layout}
            sourceClip={sourceClip}
          />
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
