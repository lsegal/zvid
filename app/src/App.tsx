import { useMemo, useRef, useState } from "react";
import "./App.css";
import type { ClipClipboard } from "./app/clip-ops.ts";
import { selectSourceSpan } from "./app/source-selection.ts";
import { formatRestoredStatus } from "./app/workspace-boot.ts";
import type { WorkspaceBoot } from "./app/workspace-types.ts";
import type { CompositionPlayerHandle } from "./CompositionPlayer";
import { AppDialogs } from "./components/AppDialogs";
import { AppStatusBar } from "./components/AppStatusBar";
import { ArrangementEmptyState } from "./components/ArrangementEmptyState";
import { CollaborationCursors } from "./components/CollaborationCursors";
import { FxPanel } from "./components/FxPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { TimelineContextMenu } from "./components/TimelineContextMenu";
import { TopBar } from "./components/TopBar";
import { ArrangementLanes } from "./components/timeline/ArrangementLanes";
import { MainAudioRow } from "./components/timeline/MainAudioRow";
import { Ruler } from "./components/timeline/Ruler";
import { SourceTracks } from "./components/timeline/SourceTracks";
import { Timeline } from "./components/timeline/Timeline";
import { TimelineToolbar } from "./components/timeline/TimelineToolbar";
import { TransportBar } from "./components/timeline/TransportBar";
import { useAppDialogs } from "./hooks/useAppDialogs.ts";
import { useAppLayout } from "./hooks/useAppLayout.ts";
import { useAppMedia } from "./hooks/useAppMedia.ts";
import { useCollaborationState } from "./hooks/useCollaboration.ts";
import { useExport, useExportState } from "./hooks/useExport.ts";
import { useFxEditing } from "./hooks/useFxEditing.ts";
import { useFxPanelModel } from "./hooks/useFxPanelModel.ts";
import { useMainAudio } from "./hooks/useMainAudio.ts";
import { useMediaCacheSession } from "./hooks/useMediaCacheSession.ts";
import { useMediaImport } from "./hooks/useMediaImport.ts";
import { usePlayback } from "./hooks/usePlayback.ts";
import { usePreview } from "./hooks/usePreview.ts";
import { usePreviewVolume } from "./hooks/usePreviewVolume.ts";
import {
  useProjectHistoryCommands,
  useProjectStore,
} from "./hooks/useProjectStore.ts";
import { useSessionFiles } from "./hooks/useSessionFiles.ts";
import { useSessionSharing } from "./hooks/useSessionSharing.ts";
import { useTimeline } from "./hooks/useTimeline.ts";
import { useTimelineEditing } from "./hooks/useTimelineEditing.ts";
import { useTimelineSelection } from "./hooks/useTimelineSelection.ts";
import { useWorkspaceSession } from "./hooks/useWorkspaceSession.ts";
import { createSpaceHold } from "./space-shortcut";

function App({ boot }: { boot: WorkspaceBoot }) {
  const collaboration = useCollaborationState();
  const { collaborationMode, collaborationState } = collaboration;
  const restoredSession = boot.session;
  const store = useProjectStore({ access: boot.access, restoredSession });
  const {
    projectHistory,
    playheadQ,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    refuseReadOnlyEdit,
    commitProjectChange,
  } = store;
  const project = projectHistory.present;
  const { timelineMode, bpm, fps, canvasWidth, canvasHeight } = project;
  const { sessionName, lanes, sourceTracks, clips, effects } = project;

  const selection = useTimelineSelection({ restoredSession, clips, effects });
  const { selectedClip, timelineClips, timelineEffects } = selection;
  const { pendingSelection, setPendingSelection, dragState } = selection;
  const { setSelectedClipId, setDragPreviewClips, setDragState } = selection;
  const layout = useAppLayout({ sourceTrackCount: sourceTracks.length });
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;
  const dialogs = useAppDialogs();
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState(() =>
    restoredSession
      ? formatRestoredStatus(restoredSession)
      : "Open a session or import media to get started.",
  );
  const exportState = useExportState();
  const { isExporting } = exportState;

  const playbackOriginRef = useRef(store.initialPlayheadQ);
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null);
  const previewVolume = usePreviewVolume(compositionPlayerRef);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const spaceHoldRef = useRef(createSpaceHold());
  const arrangementLanesRef = useRef<HTMLDivElement | null>(null);
  const clipClipboardRef = useRef<ClipClipboard | null>(null);

  const media = useAppMedia({
    projectMediaItems: project.mediaItems,
    projectSnapshotRef: store.projectSnapshotRef,
    commitViewChange: store.commitViewChange,
    setStatus,
  });
  const { mediaItems, mediaItemsById } = media;
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
  const fxEditing = useFxEditing({
    dispatchProject: store.dispatchProject,
    commitProjectChange,
    lanes,
    timelineClipsRef: selection.timelineClipsRef,
  });
  const timeline = useTimeline({
    restoredSession,
    project,
    store,
    selection,
    layout,
    mediaItemsById,
    timelineScrollRef,
    arrangementLanesRef,
    spaceHoldRef,
  });
  const { quarterPx, totalQuarters, gridStyle, timelineViewport } = timeline;
  const { visibleTimelineStartPx, visibleTimelineWidthPx } = timeline;
  const { setArrangementEmptyStateDismissed } = timeline;
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
    refuseReadOnlyEdit,
  });
  const fxPanel = useFxPanelModel({
    lanes,
    effects,
    selectedLaneId: selection.selectedLaneId,
    selectedClip,
    isSourceSelected: selection.sourceSelection !== undefined,
    mediaItemsById,
    lanePriority,
    timelineClips,
    playheadQ,
    bpm,
  });
  const mainAudioModel = useMainAudio({
    mainAudioId: project.mainAudioId,
    mediaItemsById,
    remoteMediaProgress: media.remoteMediaProgress,
    projectMediaItems: project.mediaItems,
    refuseReadOnlyEdit,
    commitProjectChange,
    commitProjectPatch: store.commitProjectPatch,
    seedLocalMediaItems: media.seedLocalMediaItems,
    cacheLocalMediaItems: media.cacheLocalMediaItems,
    setStatus,
  });
  const mediaImport = useMediaImport({
    project,
    store,
    media,
    collaboration,
    mainAudioModel,
    timelineClips,
    setSourceTracksCollapsed: layout.setSourceTracksCollapsed,
    appShellRef,
    setStatus,
  });

  const playback = usePlayback({
    playbackOriginRef,
    clips: preview.renderClips,
    timelineClips: preview.renderClips,
    timelineClipsRef: selection.timelineClipsRef,
    projectMediaItems: project.mediaItems,
    bpm,
    barLength: timeline.barLength,
    quarterPx,
    totalQuarters,
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
    finishTextEdit: preview.finishTextEdit,
    stopTimelineAudibleScrub: playback.stopTimelineAudibleScrub,
    setIsPlaying,
    setDragPreviewClips,
    setDragState,
    setPendingSelection,
    setTimelineDragState: selection.setTimelineDragState,
    setStatus,
  });
  const workspace = useWorkspaceSession({
    boot,
    store,
    selection,
    playback,
    playbackOriginRef,
    isPlaying,
    setIsPlaying,
    timelineScrollRef,
    timelineViewport,
    setArrangementEmptyStateDismissed: setArrangementEmptyStateDismissed,
    collaborationMode,
    setStatus,
  });
  const { retrySampleMedia } = useMediaCacheSession({
    media,
    projectHistory,
    projectSnapshotRef: store.projectSnapshotRef,
    settleSessionMediaCheck: workspace.settleSessionMediaCheck,
    setStatus,
  });
  const sharing = useSessionSharing({
    collaboration,
    store,
    selection,
    media,
    viewport: timeline,
    setIsPlaying,
    stopTimelineAudibleScrub: playback.stopTimelineAudibleScrub,
    appShellRef,
    flushWorkspaceSession: workspace.flushWorkspaceSession,
    viewingSharedSessionRef: workspace.viewingSharedSessionRef,
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
    mainAudioModel,
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
    setStatus,
  });
  const sessionFiles = useSessionFiles({
    boot,
    store,
    selection,
    media,
    workspace,
    setArrangementEmptyStateDismissed: setArrangementEmptyStateDismissed,
    setStatus,
  });
  const { handleRandomizeTimeline } = editing;
  const {
    openExportDialog,
    reopenExportDialog,
    dismissExportActivity,
    exportDialog,
    exportActivity,
  } = useExport({
    ...exportState,
    project,
    mediaItems,
    mainAudio: mainAudioModel.mainAudio,
    mainAudioPeaks: mainAudioModel.currentMainWaveform?.peaks,
    signature: timeline.signature,
    beatUnit: timeline.beatUnit,
    isPlaying,
    setIsPlaying,
    setStatus,
  });

  return (
    <div className="app-shell" ref={appShellRef}>
      <CollaborationCursors
        cursors={collaboration.collaborationView.remoteCursors}
      />
      <TopBar
        {...dialogs}
        {...sessionFiles}
        {...sharing}
        bpm={bpm}
        collaboration={collaboration}
        commitProjectChange={commitProjectChange}
        exportButtonLabel={exportState.exportButtonLabel}
        getEditMenuEntries={editing.getEditMenuEntries}
        handleCloseSession={workspace.handleCloseSession}
        isExporting={isExporting}
        offlineMedia={mediaImport.offlineMedia}
        openExportDialog={openExportDialog}
        projectHistory={projectHistory}
        renamingLaneIdRef={selection.renamingLaneIdRef}
        setStatus={setStatus}
        showsMediaSync={mediaImport.showsMediaSync}
      />

      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <TimelineToolbar
              {...project}
              playheadSignal={playheadSignal}
              signature={timeline.signature}
              adaptiveDivision={timeline.adaptiveDivision}
              canCreateLayer={editing.canCreateLayer}
              commitProjectPatch={store.commitProjectPatch}
              onCreateLayer={editing.handleCreateLayer}
            />

            <div
              ref={layout.editorGridRef}
              className="editor-grid"
              style={{
                ["--preview-width" as string]: `${layout.effectivePreviewWidth}px`,
              }}
            >
              <Timeline
                {...timeline}
                timelineScrollRef={timelineScrollRef}
                labelResize={layout.labelResize}
                playheadQ={playheadQ}
                playheadSignal={playheadSignal}
              >
                <Ruler
                  {...timeline}
                  {...mediaImport}
                  {...playback}
                  sessionName={sessionName}
                  setIsMediaSyncDialogOpen={dialogs.setIsMediaSyncDialogOpen}
                  setIsOfflineMediaDialogOpen={
                    dialogs.setIsOfflineMediaDialogOpen
                  }
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
                />
                <ArrangementLanes
                  arrangementLanesRef={arrangementLanesRef}
                  lanes={lanes}
                  fxLaneId={fxPanel.fxLaneId}
                  laneStatusById={timeline.laneStatusById}
                  clipsByLane={timeline.clipsByLane}
                  emptyState={
                    timeline.showArrangementEmptyState ? (
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
                    layerReorder: editing.layerReorder,
                    renamingLaneId: selection.renamingLaneId,
                    setRenamingLaneId: selection.setRenamingLaneId,
                    openLayerMenu: editing.openLayerMenu,
                    selectLaneFromLabel: selection.selectLaneFromLabel,
                    focusLaneLabel: selection.focusLaneLabel,
                    commitLayerRename: editing.commitLayerRename,
                    setLayerFxEnabled: fxEditing.setLayerFxEnabled,
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
                      signature: timeline.signature,
                      mediaItemsById,
                      thumbnails: timeline.thumbnails,
                      clipFilmstrips: timeline.clipFilmstrips,
                      remoteMediaProgress: media.remoteMediaProgress,
                      timelineEffects,
                      effects,
                      prefersReducedMotion,
                      revealedMediaIds: media.revealedMediaIds,
                      shortcutLabels,
                      openArrangementClipMenu: editing.openArrangementClipMenu,
                      startTextEdit: preview.startTextEdit,
                      setPendingSelection,
                      setDragPreviewClips,
                      setSelectedClipId,
                      setDragState,
                    },
                  }}
                />
                <MainAudioRow
                  audio={mainAudioModel}
                  drop={mediaImport.mainAudioDrop}
                  openMainAudioMenu={editing.openMainAudioMenu}
                  prefersReducedMotion={prefersReducedMotion}
                  bpm={bpm}
                  quarterPx={quarterPx}
                  visibleTimelineStartPx={visibleTimelineStartPx}
                  visibleTimelineWidthPx={visibleTimelineWidthPx}
                  gridStyle={gridStyle}
                />
                <SourceTracks
                  sourceTracks={sourceTracks}
                  sourceSpansByTrack={timeline.sourceSpansByTrack}
                  isSourceTracksCollapsed={layout.isSourceTracksCollapsed}
                  setSourceTracksCollapsed={layout.setSourceTracksCollapsed}
                  drop={mediaImport.sourceTrackDrop}
                  sourceSelection={selection.sourceSelection}
                  selectSource={selection.selectSource}
                  onImport={() => void sessionFiles.handleImport()}
                  onOpenSample={sessionFiles.sample.handleOpenSample}
                  onOpenSession={() => void sessionFiles.handleOpenSession()}
                  gridStyle={gridStyle}
                  listRef={editing.sourceTracksListRef}
                  label={{
                    reorder: editing.sourceTrackReorder,
                    openMenu: editing.openSourceTrackMenu,
                  }}
                  span={{
                    bpm,
                    quarterPx,
                    mediaItemsById,
                    thumbnails: timeline.thumbnails,
                    spanFilmstrips: timeline.spanFilmstrips,
                    remoteMediaProgress: media.remoteMediaProgress,
                    prefersReducedMotion,
                    revealedMediaIds: media.revealedMediaIds,
                    clipMenu: selection.clipMenu,
                    sourceSelection: selection.sourceSelection,
                    selectSourceSpan: (span) =>
                      selection.selectSource(selectSourceSpan(span)),
                    shortcutLabels,
                    addSourceSpanToArrangement:
                      editing.addSourceSpanToArrangement,
                    openSourceSpanMenu: editing.openSourceSpanMenu,
                  }}
                />
              </Timeline>

              <PreviewPanel
                {...preview}
                {...layout}
                bpm={bpm}
                canvasHeight={canvasHeight}
                canvasWidth={canvasWidth}
                compositionPlayerRef={compositionPlayerRef}
                fps={fps}
                isPlaying={isPlaying}
                isTimelineAudibleScrubbing={playback.isTimelineAudibleScrubbing}
                mainAudio={mainAudioModel.mainAudio}
                mediaItems={mediaItems}
                playheadQ={playheadQ}
                playheadSignal={playheadSignal}
                previewLaneId={selection.previewLaneId}
                projectDurationFrames={project.projectDurationFrames}
                selectedClip={selectedClip}
                timelineDragState={selection.timelineDragState}
                timelineEffects={timelineEffects}
              />
            </div>

            <TransportBar
              {...timeline}
              {...previewVolume}
              isPlaying={isPlaying}
              jumpPlayhead={playback.jumpPlayhead}
              onTransportToggle={playback.handleTransportToggle}
              onRandomize={handleRandomizeTimeline}
            />
          </section>

          <FxPanel {...fxEditing} {...fxPanel} {...layout} />
        </div>
      </main>

      <AppDialogs
        {...dialogs}
        {...workspace}
        {...mediaImport}
        {...sharing}
        collaboration={collaboration}
        commitProjectChange={commitProjectChange}
        exportDialog={exportDialog}
        handleMediaStorageCleared={media.handleMediaStorageCleared}
        isTakeOverPromptOpen={store.isTakeOverPromptOpen}
        isWorkspaceReadOnly={store.isWorkspaceReadOnly}
        mediaItemsById={mediaItemsById}
        projectHistory={projectHistory}
        retrySampleMedia={retrySampleMedia}
        setIsTakeOverPromptOpen={store.setIsTakeOverPromptOpen}
        workspaceAccess={store.workspaceAccess}
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
        offlineCount={mediaImport.offlineCount}
        playheadSignal={playheadSignal}
        previewMedia={preview.previewMedia}
        reopenExportDialog={reopenExportDialog}
        sessionName={sessionName}
        setIsSessionSettingsOpen={dialogs.setIsSessionSettingsOpen}
        shareUrl={collaboration.shareUrl}
        signature={timeline.signature}
        status={status}
        timelineMode={timelineMode}
        trackCount={lanes.length}
      />
      <TimelineContextMenu
        clipMenu={selection.clipMenu}
        getClipMenuEntries={editing.getClipMenuEntries}
        onClose={() => selection.setClipMenu(null)}
      />
    </div>
  );
}

export default App;
