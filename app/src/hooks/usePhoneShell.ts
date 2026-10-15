import type { RefObject } from "react";
import { getClipEndQ } from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import type { CompositionPlayerHandle } from "../CompositionPlayer";
import type { MobileShareButtonProps } from "../components/mobile/MobileShareButton";
import type { ContextMenuEntry } from "../context-menu.ts";
import {
  buildFileMenuEntries,
  type FileMenuInputs,
} from "../menus/file-menu.ts";
import {
  playheadLoopRange,
  quickLoopRegion,
} from "../mobile/timeline-touch.ts";
import { setTheme } from "../theme.ts";
import type { AppLayout } from "./useAppLayout.ts";
import { useCenterPlayhead } from "./useCenterPlayhead.ts";
import { useMasterMeterTap } from "./useMasterMeterTap.ts";
import type { useMediaDrawer } from "./useMediaDrawer.ts";
import { useMobileShell } from "./useMobileShell.ts";
import { usePhoneExportSupport } from "./usePhoneExportSupport.ts";
import type { usePlayback } from "./usePlayback.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import type { Recording } from "./useRecording.ts";
import type { Timeline } from "./useTimeline.ts";
import type { useTimelineEditing } from "./useTimelineEditing.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import { useTheme } from "./useTheme.ts";
import { useTouchClipGestures } from "./useTouchClipGestures.ts";

type TimelineEditing = ReturnType<typeof useTimelineEditing>;

export type PhoneShellInputs = {
  project: ProjectState;
  layout: AppLayout;
  store: ProjectStore;
  selection: TimelineSelectionState;
  timeline: Timeline;
  playback: ReturnType<typeof usePlayback>;
  recording: Recording;
  mediaDrawer: ReturnType<typeof useMediaDrawer>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  compositionPlayerRef: RefObject<CompositionPlayerHandle | null>;
  playbackOriginRef: { current: number };
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  editing: Pick<
    TimelineEditing,
    "getClipMenuEntries" | "getEditMenuEntries" | "getHistoryEntries"
  >;
  fileMenu: FileMenuInputs;
  collaboration: MobileShareButtonProps["collaboration"];
  sharing: MobileShareButtonProps["sharing"];
  setStatus: (status: string) => void;
};

// Everything the phone shell adds on top of the editor's hooks: its view
// state, the center-playhead timeline and its touch gestures, the export
// check, and the props of its chrome (MobileShellChrome).
export function usePhoneShell(inputs: PhoneShellInputs) {
  const { project, layout, store, selection, timeline, playback } = inputs;
  const { recording, mediaDrawer, isPlaying, setIsPlaying } = inputs;
  const { editing, fileMenu } = inputs;
  const { isPhone } = layout;
  const { selectedClip } = selection;

  const mobile = useMobileShell({
    isPhone,
    isMediaDrawerOpen: mediaDrawer.isOpen,
    setMediaDrawerOpen: mediaDrawer.setOpen,
    openMediaTab: () => mediaDrawer.selectTab("media"),
    isAudioRowCollapsed: layout.isAudioRowCollapsed,
    setAudioRowCollapsed: layout.setAudioRowCollapsed,
  });
  useCenterPlayhead({
    enabled: isPhone,
    timelineScrollRef: inputs.timelineScrollRef,
    playheadSignal: store.playheadSignal,
    playheadQRef: store.playheadQRef,
    setPlayheadQ: store.setPlayheadQ,
    playbackOriginRef: inputs.playbackOriginRef,
    labelWidth: layout.labelWidth,
    quarterPx: timeline.quarterPx,
    resolvedZoom: timeline.resolvedZoom,
    isPlaying,
    setIsPlaying,
    updateZoomDraft: timeline.updateZoomDraft,
    flushZoomDraft: timeline.flushZoomDraft,
  });
  useTouchClipGestures({
    enabled: isPhone,
    timelineScrollRef: inputs.timelineScrollRef,
    timelineClips: selection.timelineClips,
    bpm: project.bpm,
    pendingSelection: selection.pendingSelection,
    labelWidth: layout.labelWidth,
    quarterPx: timeline.quarterPx,
    totalQuarters: timeline.totalQuarters,
    snapUnit: timeline.snapUnit,
    snapEnabled: project.snapEnabled,
    gridCellQ: timeline.gridCellQ,
    // As useClipDrag's shortest selection.
    minimumSelectionQ: Math.max(timeline.snapUnit, timeline.beatUnit / 4),
    setSelectedClipId: selection.setSelectedClipId,
    setSelectedLaneId: selection.setSelectedLaneId,
    setPendingSelection: selection.setPendingSelection,
    setDragPreviewClips: selection.setDragPreviewClips,
    setDragState: selection.setDragState,
    setClipMenu: selection.setClipMenu,
  });
  // The phone transport's VU meter reads the same master tap as the desktop
  // transport bar's.
  const getMeterTap = useMasterMeterTap(inputs.compositionPlayerRef);
  const theme = useTheme();
  const exportSupport = usePhoneExportSupport(
    isPhone,
    project.canvasWidth,
    project.canvasHeight,
  );

  function togglePlay() {
    // iOS starts audio only from inside the tap.
    inputs.compositionPlayerRef.current?.unlockAudio();
    void playback.handleTransportToggle();
  }

  function record() {
    if (recording.canRecord) {
      recording.toggleRecording();
      return;
    }
    // Recording needs an armed source track and inputs to record from.
    mobile.setShowsSourceTracks(true);
    mediaDrawer.selectTab("record");
    inputs.setStatus("Arm a source track to record a take.");
  }

  // Loops the timeline selection (a lane range, else the loop strip's
  // playback selection) and clears it, else the selected clip, else one bar
  // from the playhead, snapped to the grid.
  function toggleLoop() {
    if (timeline.loopRegion) {
      timeline.setLoopRegion(null);
      return;
    }
    const { pendingSelection } = selection;
    timeline.setLoopRegion(
      quickLoopRegion(
        store.playheadQRef.current,
        timeline.barLength,
        pendingSelection
          ? {
              startQ: pendingSelection.startQ,
              endQ: pendingSelection.startQ + pendingSelection.durationQ,
            }
          : undefined,
        timeline.playbackSelection ?? undefined,
        selectedClip
          ? {
              startQ: selectedClip.startQ,
              endQ: getClipEndQ(selectedClip, project.bpm),
            }
          : undefined,
        playheadLoopRange(
          store.playheadQRef.current,
          timeline.barLength,
          timeline.snapUnit,
          project.snapEnabled,
        ),
      ),
    );
    selection.setPendingSelection(null);
    timeline.setPlaybackSelection(null);
  }

  function getOverflowEntries(): ContextMenuEntry[] {
    return [
      {
        type: "item",
        id: "file",
        label: "File",
        submenu: buildFileMenuEntries({ ...fileMenu, theme, setTheme }),
      },
      {
        type: "item",
        id: "edit",
        label: "Edit",
        submenu: editing.getEditMenuEntries(),
      },
      {
        type: "item",
        id: "save",
        label: "Save to Library",
        onSelect: () => void fileMenu.handleSaveToLibrary(),
      },
      { type: "separator" },
      {
        type: "item",
        id: "reorder",
        label: mobile.isReordering ? "Done Reordering" : "Reorder Layers",
        onSelect: () => mobile.setIsReordering(!mobile.isReordering),
      },
      {
        type: "item",
        id: "source-tracks",
        label: mobile.showsSourceTracks
          ? "Hide Source Tracks"
          : "Show Source Tracks",
        onSelect: () => mobile.setShowsSourceTracks(!mobile.showsSourceTracks),
      },
    ];
  }

  const clipMenuEntries =
    isPhone && selectedClip
      ? editing.getClipMenuEntries({
          kind: "clip",
          clipId: selectedClip.id,
          anchor: { x: 0, y: 0 },
        })
      : [];
  // A lane selection's actions, while no clip is selected.
  const { pendingSelection } = selection;
  const showsSelectionActions = isPhone && !selectedClip && pendingSelection;
  const selectionMenuEntries = showsSelectionActions
    ? editing.getClipMenuEntries({ kind: "selection", anchor: { x: 0, y: 0 } })
    : [];

  const shellClassName = isPhone
    ? [
        "app-shell--phone",
        layout.shell === "phone-landscape" ? "app-shell--phone-landscape" : "",
        mobile.isReordering ? "app-shell--reordering" : "",
        mobile.showsSourceTracks ? "app-shell--source-tracks" : "",
        mobile.fxSheetShown ? `app-shell--fx-${mobile.fxSheetShown}` : "",
        mobile.isFxSheetClosing ? "app-shell--fx-closing" : "",
        `app-shell--fx-${mobile.fxScreen}`,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return {
    mobile,
    shellClassName,
    chrome: {
      mobile,
      sessionName: project.sessionName,
      exportSupport,
      isExporting: fileMenu.isExporting,
      openExportDialog: fileMenu.openExportDialog,
      getOverflowEntries,
      historyEntries: isPhone ? editing.getHistoryEntries() : [],
      share: { collaboration: inputs.collaboration, sharing: inputs.sharing },
      mediaDrawer,
      importMedia: () => void fileMenu.handleImport(),
      playheadSignal: store.playheadSignal,
      readout: {
        timelineMode: project.timelineMode,
        bpm: project.bpm,
        signature: timeline.signature,
        fps: project.fps,
      },
      getMeterTap,
      isPlaying,
      isRecording: recording.isRecording,
      isLooping: timeline.loopRegion !== null,
      togglePlay,
      skipToStart: () => playback.skipToEdge("back"),
      record,
      toggleLoop,
      hasSelectedClip: Boolean(selectedClip),
      clipMenuEntries,
      openClipMenu: () =>
        selectedClip &&
        selection.setClipMenu({
          kind: "clip",
          clipId: selectedClip.id,
          anchor: { x: 0, y: 0 },
        }),
      hasSelection: Boolean(showsSelectionActions),
      selectionMenuEntries,
      openSelectionMenu: () =>
        selection.setClipMenu({ kind: "selection", anchor: { x: 0, y: 0 } }),
    },
  };
}

export type PhoneShell = ReturnType<typeof usePhoneShell>;
export type MobileShellChromeProps = PhoneShell["chrome"];
