import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SetStateAction,
} from "react";
import { type ClipClipboard, canPasteOntoLayer } from "../app/clip-ops.ts";
import { FX_CLIP_BARS, TEXT_CLIP_BARS } from "../app/constants.ts";
import type { getShortcutLabels } from "../app/shortcut-labels.ts";
import { getClipDurationQ, getClipEndQ } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  ClipMenuState,
  Lane,
  SourceSpan,
  SourceTrack,
  TimelineSelection,
} from "../app/types.ts";
import { getSwatch } from "../app/util.ts";
import { canSplitAt, isInSelection } from "../clip-menu.ts";
import type { ContextMenuEntry, MenuPoint } from "../context-menu.ts";
import { addableEffectsFor } from "../fx-chain.ts";
import { isLayerFxEnabled } from "../fx-stack.ts";
import type { useClipActions } from "../hooks/useClipActions.ts";
import type { useClipInsertion } from "../hooks/useClipInsertion.ts";
import type { useFxEditing } from "../hooks/useFxEditing.ts";
import type { useLayerActions } from "../hooks/useLayerActions.ts";
import type { usePlayback } from "../hooks/usePlayback.ts";
import type { useSourceClipActions } from "../hooks/useSourceClipActions.ts";
import type { useSourceTrackActions } from "../hooks/useSourceTrackActions.ts";
import { sourceTrackHasFootage } from "../random-arrangement.ts";
import { canPasteIntoSourceTrack } from "../source-clip-edits.ts";
import { buildAudioMenuEntries } from "./audio-menu.ts";
import { buildClipMenuEntries } from "./clip-menu.ts";
import { buildEditMenuEntries } from "./edit-menu.ts";
import { buildHistoryEntries } from "./entries/edit-history.ts";
import { buildLayerMenuEntries } from "./layer-menu.ts";
import { buildSelectionMenuEntries } from "./selection-menu.ts";
import { buildSourceSpanMenuEntries } from "./source-span-menu.ts";
import { buildSourceTrackMenuEntries } from "./source-track-menu.ts";
import { useKeyboardContextMenu } from "./useKeyboardContextMenu.ts";

type ClipActions = ReturnType<typeof useClipActions>;
type ClipInsertion = ReturnType<typeof useClipInsertion>;
type LayerActions = ReturnType<typeof useLayerActions>;
type SourceTrackActions = ReturnType<typeof useSourceTrackActions>;

export type MenusInputs = Pick<
  ClipActions,
  | "copyArrangementClip"
  | "cutArrangementClip"
  | "deleteArrangementClip"
  | "copySelectionRange"
  | "copySelection"
  | "cutSelection"
  | "deleteSelection"
  | "pasteArrangementClip"
  | "splitArrangementClip"
  | "duplicateArrangementClip"
  | "copySourceSpanToLayer"
> &
  Pick<ReturnType<typeof useSourceClipActions>, "sourceClipActions"> &
  Pick<
    ClipInsertion,
    | "commitPendingSelectionToSourceTrack"
    | "insertFillClip"
    | "insertTextClip"
    | "insertFxClip"
  > &
  Pick<
    LayerActions,
    | "duplicateLayer"
    | "deleteLayer"
    | "insertLayer"
    | "moveLayer"
    | "addLayerFx"
  > &
  Pick<
    SourceTrackActions,
    "duplicateSourceTrack" | "deleteSourceTrack" | "moveSourceTrack"
  > &
  Pick<ReturnType<typeof useFxEditing>, "setLayerFxEnabled"> &
  Pick<ReturnType<typeof usePlayback>, "jumpToClipStart"> & {
    barLength: number;
    bpm: number;
    canRedo: boolean;
    canUndo: boolean;
    clipClipboardRef: RefObject<ClipClipboard | null>;
    fxLaneId: string | undefined;
    handleRedo: () => void;
    handleUndo: () => void;
    laneStatusById: ReadonlyMap<string, { effectCount: number }>;
    lanes: Lane[];
    pendingSelection: TimelineSelection | null;
    playheadQRef: RefObject<number>;
    quarterPx: number;
    redoLabel: string | undefined;
    refreshAudio: () => void;
    renamingLaneId: string | undefined;
    renamingSourceTrackId: string | undefined;
    selectLaneFromLabel: (laneId: string) => void;
    selectedClip: ArrangementClip | undefined;
    selectedLaneId: string | undefined;
    // The selected source clip, while no layer clip is selected.
    selectedSourceSpan: SourceSpan | undefined;
    selectedSourceTrack: SourceTrack | undefined;
    setClipMenu: Dispatch<SetStateAction<ClipMenuState | null>>;
    setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
    setRenamingLaneId: Dispatch<SetStateAction<string | undefined>>;
    setRenamingSourceTrackId: Dispatch<SetStateAction<string | undefined>>;
    setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
    setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
    shortcutLabels: ReturnType<typeof getShortcutLabels>;
    sourceSpans: SourceSpan[];
    sourceTracks: SourceTrack[];
    sourceTracksLocked: boolean;
    timelineClips: ArrangementClip[];
    timelineScrollRef: RefObject<HTMLDivElement | null>;
    undoLabel: string | undefined;
  };

// The pointer position, or below the element when the context-menu key or
// Shift+F10 opened the menu and reported no position.
function getMenuAnchor(event: ReactMouseEvent<HTMLElement>): MenuPoint {
  if (event.clientX || event.clientY) {
    return { x: event.clientX, y: event.clientY };
  }

  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom };
}

// Opens the right-click menus and builds their entries, and the Edit menu's,
// from the current selection.
export function useMenus({
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
  moveLayer,
  moveSourceTrack,
  pasteArrangementClip,
  pendingSelection,
  playheadQRef,
  quarterPx,
  redoLabel,
  refreshAudio,
  renamingLaneId,
  renamingSourceTrackId,
  selectLaneFromLabel,
  selectedClip,
  selectedLaneId,
  selectedSourceSpan,
  selectedSourceTrack,
  setClipMenu,
  setLayerFxEnabled,
  setPendingSelection,
  setRenamingLaneId,
  setRenamingSourceTrackId,
  setSelectedClipId,
  setSelectedLaneId,
  shortcutLabels,
  sourceClipActions,
  sourceSpans,
  sourceTracks,
  sourceTracksLocked,
  splitArrangementClip,
  timelineClips,
  timelineScrollRef,
  undoLabel,
}: MenusInputs) {
  // Right-clicking a clip selects it (and so its layer) before the menu opens.
  function openArrangementClipMenu(
    event: ReactMouseEvent<HTMLElement>,
    clip: ArrangementClip,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setPendingSelection(null);
    setSelectedClipId(clip.id);
    setClipMenu({
      kind: "clip",
      clipId: clip.id,
      anchor: getMenuAnchor(event),
    });
  }

  // Right-clicking inside the uncommitted selection keeps it and opens the
  // selection menu; anywhere else on the lane clears it for the lane menu.
  function openLaneMenu(event: ReactMouseEvent<HTMLElement>, laneId: string) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerQ = (event.clientX - bounds.left) / quarterPx;
    if (isInSelection(pendingSelection, laneId, pointerQ)) {
      setClipMenu({ kind: "selection", anchor: getMenuAnchor(event) });
      return;
    }

    setPendingSelection(null);
    setSelectedClipId(undefined);
    setSelectedLaneId(laneId);
    setClipMenu({ kind: "lane", laneId, anchor: getMenuAnchor(event) });
  }

  // Right-clicking a layer header, or the context-menu key on it, selects
  // the layer before the menu opens.
  function openLayerMenu(event: ReactMouseEvent<HTMLElement>, laneId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (renamingLaneId === laneId) {
      return;
    }

    selectLaneFromLabel(laneId);
    setClipMenu({ kind: "layer", laneId, anchor: getMenuAnchor(event) });
  }

  function openAudioMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setClipMenu({ kind: "audio", anchor: getMenuAnchor(event) });
  }

  function openSourceSpanMenu(
    event: ReactMouseEvent<HTMLElement>,
    span: SourceSpan,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setClipMenu({
      kind: "span",
      spanId: span.id,
      anchor: getMenuAnchor(event),
    });
  }

  function openSourceTrackMenu(
    event: ReactMouseEvent<HTMLElement>,
    trackId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (renamingSourceTrackId === trackId) {
      return;
    }

    setClipMenu({
      kind: "source-track",
      trackId,
      anchor: getMenuAnchor(event),
    });
  }

  useKeyboardContextMenu({
    fxLaneId,
    pendingSelection,
    playheadQRef,
    quarterPx,
    selectedClip,
    selectedSourceTrack,
    setClipMenu,
    setSelectedLaneId,
    timelineScrollRef,
  });

  function getClipMenuEntries(menu: ClipMenuState): ContextMenuEntry[] {
    if (menu.kind === "audio") {
      return getAudioMenuEntries();
    }

    if (menu.kind === "layer") {
      const lane = lanes.find((item) => item.id === menu.laneId);
      return lane ? getLayerMenuEntries(lane) : [];
    }

    if (menu.kind === "source-track") {
      const track = sourceTracks.find((item) => item.id === menu.trackId);
      return track
        ? buildSourceTrackMenuEntries({
            tracks: sourceTracks,
            trackId: track.id,
            locked: sourceTracksLocked,
            actions: {
              rename: () => setRenamingSourceTrackId(track.id),
              duplicate: () => duplicateSourceTrack(track),
              remove: () => deleteSourceTrack(track),
              moveUp: () => moveSourceTrack(track, -1),
              moveDown: () => moveSourceTrack(track, 1),
            },
          })
        : [];
    }

    if (menu.kind === "selection") {
      return pendingSelection ? getSelectionMenuEntries(pendingSelection) : [];
    }

    if (menu.kind === "span") {
      const span = sourceSpans.find((item) => item.id === menu.spanId);
      return span ? getSourceSpanMenuEntries(span) : [];
    }

    const clip =
      menu.kind === "clip"
        ? timelineClips.find((item) => item.id === menu.clipId)
        : undefined;
    return getArrangementClipEntries(
      clip,
      menu.kind === "lane" ? menu.laneId : clip?.laneId,
    );
  }

  function getSourceSpanMenuEntries(span: SourceSpan) {
    const withSpan = (action: (span: SourceSpan) => void) => () => action(span);
    return buildSourceSpanMenuEntries({
      lanes,
      mac: shortcutLabels.mac,
      canPaste: canPasteIntoSourceTrack(clipClipboardRef.current),
      canSplit: canSplitAt(
        span.startQ,
        getClipEndQ(span, bpm),
        playheadQRef.current,
      ),
      locked: sourceTracksLocked,
      actions: {
        jumpToStart: withSpan(sourceClipActions.jumpToStart),
        cut: withSpan(sourceClipActions.cut),
        copy: withSpan(sourceClipActions.copy),
        paste: withSpan(sourceClipActions.paste),
        duplicate: withSpan(sourceClipActions.duplicate),
        split: withSpan(sourceClipActions.split),
        remove: withSpan(sourceClipActions.remove),
      },
      copyToLayer: (target) => copySourceSpanToLayer(span, target),
    });
  }

  // Insert Track commits the selection exactly like the track's number key,
  // and Insert Fill Clip covers it with a fill clip.
  function getSelectionMenuEntries(selection: TimelineSelection) {
    const endQ = selection.startQ + selection.durationQ;
    return buildSelectionMenuEntries({
      tracks: sourceTracks.map((track) => ({
        id: track.id,
        name: track.name,
        color: getSwatch(track.colorIndex).accent,
        hasFootage: sourceTrackHasFootage(
          sourceSpans,
          (span) => span.startQ + getClipDurationQ(span, bpm),
          track.id,
          selection.startQ,
          endQ,
        ),
      })),
      clipboard: {
        mac: shortcutLabels.mac,
        hasContent: copySelectionRange(selection).fragments.length > 0,
        cut: () => cutSelection(selection),
        copy: () => copySelection(selection),
        remove: () => deleteSelection(selection),
      },
      insertTrack: commitPendingSelectionToSourceTrack,
      insertFill: () =>
        insertFillClip(selection.laneId, selection.startQ, selection.durationQ),
      insertText: () =>
        insertTextClip(selection.laneId, selection.startQ, selection.durationQ),
      insertFx: () =>
        insertFxClip(selection.laneId, selection.startQ, selection.durationQ),
      clear: () => setPendingSelection(null),
    });
  }

  function getAudioMenuEntries() {
    return buildAudioMenuEntries({ refresh: refreshAudio });
  }

  function getLayerMenuEntries(lane: Lane) {
    const fxEnabled = isLayerFxEnabled(lane);
    return buildLayerMenuEntries({
      lanes,
      laneId: lane.id,
      fxEnabled,
      effectCount: laneStatusById.get(lane.id)?.effectCount ?? 0,
      effects: addableEffectsFor("layer"),
      actions: {
        rename: () => setRenamingLaneId(lane.id),
        duplicate: () => duplicateLayer(lane),
        remove: () => deleteLayer(lane),
        toggleFx: () => setLayerFxEnabled(lane.id, !fxEnabled),
        addFx: (effectName) => addLayerFx(lane.id, effectName),
        insertText: () =>
          insertTextClip(
            lane.id,
            playheadQRef.current,
            TEXT_CLIP_BARS * barLength,
          ),
        insertFx: () =>
          insertFxClip(lane.id, playheadQRef.current, FX_CLIP_BARS * barLength),
        insertAbove: () => insertLayer(lane.id, "above"),
        insertBelow: () => insertLayer(lane.id, "below"),
        moveUp: () => moveLayer(lane, -1),
        moveDown: () => moveLayer(lane, 1),
      },
    });
  }

  // The clip menu, or the empty lane space menu without a clip. Paste goes on
  // `pasteLaneId`, or on the selected layer when it is undefined.
  function getArrangementClipEntries(
    clip: ArrangementClip | undefined,
    pasteLaneId: string | undefined,
  ): ContextMenuEntry[] {
    const withClip = (action: (clip: ArrangementClip) => void) => () => {
      if (clip) {
        action(clip);
      }
    };
    return buildClipMenuEntries({
      hasClip: Boolean(clip),
      canPaste: canPasteOntoLayer(clipClipboardRef.current),
      canSplit: clip
        ? canSplitAt(clip.startQ, getClipEndQ(clip, bpm), playheadQRef.current)
        : false,
      mac: shortcutLabels.mac,
      actions: {
        jumpToStart: withClip((clip) => jumpToClipStart(clip.id)),
        cut: withClip(cutArrangementClip),
        copy: withClip(copyArrangementClip),
        paste: () => pasteArrangementClip(pasteLaneId),
        duplicate: withClip(duplicateArrangementClip),
        split: withClip(splitArrangementClip),
        remove: withClip(deleteArrangementClip),
      },
    });
  }

  // Built when the Edit menu opens, so it reflects the current selection.
  function getEditMenuEntries(): ContextMenuEntry[] {
    const selectedLane = lanes.find((lane) => lane.id === selectedLaneId);
    return buildEditMenuEntries(
      buildHistoryEntries({
        undoLabel,
        redoLabel,
        canUndo,
        canRedo,
        shortcuts: shortcutLabels,
        undo: handleUndo,
        redo: handleRedo,
      }),
      {
        clip: selectedClip?.label,
        // A selected source clip gives Cut, Copy and Paste only: Edit has no
        // Clip submenu for it, so its Split never splits a source clip.
        clipEntries:
          selectedSourceSpan && !selectedClip
            ? getSourceSpanMenuEntries(selectedSourceSpan)
            : getArrangementClipEntries(selectedClip, undefined),
        selectionEntries: pendingSelection
          ? getSelectionMenuEntries(pendingSelection)
          : undefined,
        layer: selectedLane
          ? {
              name: selectedLane.name,
              entries: getLayerMenuEntries(selectedLane),
            }
          : undefined,
        audioEntries: getAudioMenuEntries(),
      },
    );
  }

  return {
    openArrangementClipMenu,
    openLaneMenu,
    openLayerMenu,
    openAudioMenu,
    openSourceSpanMenu,
    openSourceTrackMenu,
    getClipMenuEntries,
    getEditMenuEntries,
  };
}
