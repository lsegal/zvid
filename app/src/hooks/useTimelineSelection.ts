import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findRestoredSourceSelection,
  keepSourceSelection,
  type SourceSelection,
  toSourceSelectionView,
} from "../app/source-selection.ts";
import type {
  ArrangementClip,
  ClipMenuState,
  DragState,
  SourceSpan,
  SourceSpanDragState,
  SourceTrack,
  TimelineDragState,
  TimelineSelection,
} from "../app/types.ts";
import { findRestoredSelection } from "../app/workspace-boot.ts";
import type { SavedWorkspaceSession } from "../app/workspace-types.ts";
import { previewDuplicateClipEffects, type SessionEffect } from "../fx-stack";

export type TimelineSelectionInputs = {
  restoredSession: SavedWorkspaceSession | null;
  clips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  effects: SessionEffect[];
  sourceTracks: SourceTrack[];
};

// The timeline's selection and gesture state: the selected clip and layer
// or, instead of them, the selected source track or clip, the range
// selection, the layer outlined in the preview, the open context menu, the
// layer being renamed, and the clip, source clip and ruler drags with the
// clips, source clips and effects a drag previews.
export function useTimelineSelection({
  restoredSession,
  clips,
  sourceSpans,
  effects,
  sourceTracks,
}: TimelineSelectionInputs) {
  const [restoredSelection] = useState(() =>
    findRestoredSelection(restoredSession),
  );
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
  // A selected source track or clip. Only one thing is selected at a time:
  // selecting a source clears the layer and clip, and the reverse.
  const [storedSourceSelection, setSourceSelection] = useState<
    SourceSelection | undefined
  >(restoredSelection.sourceSelection);
  // Deleting the selected source track drops the selection, and deleting
  // the selected source clip leaves its track selected.
  const sourceSelection = useMemo(
    () =>
      storedSourceSelection &&
      findRestoredSourceSelection(
        toSourceSelectionView(storedSourceSelection),
        sourceTracks,
        sourceSpans,
      ),
    [sourceSpans, sourceTracks, storedSourceSelection],
  );
  useEffect(() => {
    setSourceSelection((selection) =>
      keepSourceSelection(selection, selectedClipId, selectedLaneId),
    );
  }, [selectedClipId, selectedLaneId]);
  const [pendingSelection, setPendingSelection] =
    useState<TimelineSelection | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineDragState, setTimelineDragState] =
    useState<TimelineDragState | null>(null);
  const [sourceSpanDrag, setSourceSpanDrag] =
    useState<SourceSpanDragState | null>(null);
  const [dragPreviewSourceSpans, setDragPreviewSourceSpans] = useState<
    SourceSpan[] | null
  >(null);
  const timelineSourceSpans = dragPreviewSourceSpans ?? sourceSpans;

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

  // Only a clip the user selected; rendering and edits never fall back to
  // another one.
  const selectedClip = useMemo(
    () => timelineClips.find((clip) => clip.id === selectedClipId),
    [selectedClipId, timelineClips],
  );
  // What the preview describes when no clip is at the playhead: the selected
  // clip, else the first. Read-only; never used to render or edit a clip.
  const inspectorClip = selectedClip ?? timelineClips[0];
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

  // Selecting a source never moves the playhead.
  const selectSource = useCallback((selection: SourceSelection | undefined) => {
    setSelectedClipId(undefined);
    setSelectedLaneId(undefined);
    setPreviewLaneId(undefined);
    setSourceSelection(selection);
  }, []);

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

  return {
    dragPreviewClips,
    setDragPreviewClips,
    selectedClipId,
    setSelectedClipId,
    clipMenu,
    setClipMenu,
    renamingLaneId,
    setRenamingLaneId,
    renamingLaneIdRef,
    selectedLaneId,
    setSelectedLaneId,
    sourceSelection,
    setSourceSelection,
    selectSource,
    pendingSelection,
    setPendingSelection,
    dragState,
    setDragState,
    timelineDragState,
    setTimelineDragState,
    sourceSpanDrag,
    setSourceSpanDrag,
    dragPreviewSourceSpans,
    setDragPreviewSourceSpans,
    timelineSourceSpans,
    timelineClips,
    timelineClipsRef,
    timelineEffects,
    selectedClip,
    inspectorClip,
    previewLaneId,
    setPreviewLaneId,
    selectLaneFromLabel,
    focusLaneLabel,
  };
}

export type TimelineSelectionState = ReturnType<typeof useTimelineSelection>;
