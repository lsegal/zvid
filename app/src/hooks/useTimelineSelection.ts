import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dedupeSelectionItems,
  type SelectionItem,
  toggleSelectionItem,
} from "../app/multi-selection.ts";
import {
  findRestoredSourceSelection,
  keepSourceSelection,
  type SourceSelection,
  selectSourceSpan,
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
  const [selectedClipId, setPrimaryClipId] = useState<string | undefined>(
    restoredSelection.selectedClipId,
  );
  // The other clips and source clips selected along with the selected clip
  // or source clip (see multi-selection.ts). Selecting a single clip, layer
  // or source drops them.
  const [extraSelection, setExtraSelection] = useState<SelectionItem[]>([]);
  const setSelectedClipId: Dispatch<SetStateAction<string | undefined>> =
    useCallback((action) => {
      setExtraSelection([]);
      setPrimaryClipId(action);
    }, []);
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
  const [storedSourceSelection, setPrimarySourceSelection] = useState<
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
  const setSourceSelection: Dispatch<
    SetStateAction<SourceSelection | undefined>
  > = useCallback((action) => {
    setExtraSelection([]);
    setPrimarySourceSelection(action);
  }, []);
  useEffect(() => {
    setPrimarySourceSelection((selection) =>
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
  // Clips being Ctrl/Cmd-dragged to duplicate them are drawn with their
  // source clips' stacks; the drop commits the copies' own.
  const isDuplicateDragging = Boolean(
    dragPreviewClips && dragState?.kind === "move" && dragState.duplicateOnDrag,
  );
  const timelineEffects = useMemo(
    () =>
      isDuplicateDragging && dragState?.kind === "move"
        ? [
            ...(dragState.group ?? []),
            { sourceClipId: dragState.sourceClipId, clipId: dragState.clipId },
          ].reduce(
            (drawn, { sourceClipId, clipId }) =>
              previewDuplicateClipEffects(drawn, sourceClipId, clipId),
            effects,
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

  // Every selected clip and source clip that still exists, the primary one
  // last.
  const selectionItems = useMemo(() => {
    const items: SelectionItem[] = [...extraSelection];
    if (selectedClipId !== undefined) {
      items.push({ kind: "clip", id: selectedClipId });
    } else if (sourceSelection?.sourceSpanId !== undefined) {
      items.push({
        kind: "span",
        id: sourceSelection.sourceSpanId,
        sourceTrackId: sourceSelection.sourceTrackId,
      });
    }
    return dedupeSelectionItems(items).filter((item) =>
      item.kind === "clip"
        ? timelineClips.some((clip) => clip.id === item.id)
        : sourceSpans.some((span) => span.id === item.id),
    );
  }, [
    extraSelection,
    selectedClipId,
    sourceSelection,
    sourceSpans,
    timelineClips,
  ]);
  const selectedClipIds = useMemo(
    () =>
      new Set(
        selectionItems.flatMap((item) =>
          item.kind === "clip" ? [item.id] : [],
        ),
      ),
    [selectionItems],
  );
  const selectedSourceSpanIds = useMemo(
    () =>
      new Set(
        selectionItems.flatMap((item) =>
          item.kind === "span" ? [item.id] : [],
        ),
      ),
    [selectionItems],
  );
  // Whether `item` is one of several selected, so commands on it act on
  // the whole selection.
  const isInMultiSelection = useCallback(
    (item: Pick<SelectionItem, "kind" | "id">) =>
      selectionItems.length > 1 &&
      selectionItems.some(
        (candidate) => candidate.kind === item.kind && candidate.id === item.id,
      ),
    [selectionItems],
  );

  // Selects exactly `items`, the last one as the primary selection, which
  // the inspector and single-clip commands follow.
  const applySelection = useCallback((items: readonly SelectionItem[]) => {
    const unique = dedupeSelectionItems(items);
    const primary = unique.at(-1);
    if (primary?.kind === "span") {
      setPrimaryClipId(undefined);
      setSelectedLaneId(undefined);
      setPreviewLaneId(undefined);
      setPrimarySourceSelection(selectSourceSpan(primary));
    } else {
      setPrimaryClipId(primary?.id);
    }
    setExtraSelection(unique.slice(0, -1));
  }, []);

  // Shift-click: adds `item` to the selection, or takes it out when it is
  // already there.
  const toggleSelection = useCallback(
    (item: SelectionItem) => {
      applySelection(toggleSelectionItem(selectionItems, item));
    },
    [applySelection, selectionItems],
  );
  const selectionItemsRef = useRef(selectionItems);
  selectionItemsRef.current = selectionItems;

  const selectLaneFromLabel = (laneId: string) => {
    setSelectedClipId(undefined);
    setSelectedLaneId(laneId);
    setPreviewLaneId(laneId);
  };

  // Selecting a source never moves the playhead.
  const selectSource = useCallback(
    (selection: SourceSelection | undefined) => {
      setSelectedClipId(undefined);
      setSelectedLaneId(undefined);
      setPreviewLaneId(undefined);
      setSourceSelection(selection);
    },
    [setSelectedClipId, setSourceSelection],
  );

  // A click on a source clip selects just it, a Shift-click adds or removes
  // it, and a right-click keeps a selection it is one of, for its menu.
  const selectSourceSpanClip = useCallback(
    (
      span: Pick<SourceSpan, "id" | "sourceTrackId">,
      mode: "select" | "toggle" | "menu" = "select",
    ) => {
      const item: SelectionItem = {
        kind: "span",
        id: span.id,
        sourceTrackId: span.sourceTrackId,
      };
      if (mode === "toggle") {
        toggleSelection(item);
        return;
      }
      if (mode === "menu" && isInMultiSelection(item)) {
        return;
      }
      selectSource(selectSourceSpan(span));
    },
    [isInMultiSelection, selectSource, toggleSelection],
  );

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
    selectionItems,
    selectionItemsRef,
    selectedClipIds,
    selectedSourceSpanIds,
    isInMultiSelection,
    applySelection,
    toggleSelection,
    selectSourceSpanClip,
  };
}

export type TimelineSelectionState = ReturnType<typeof useTimelineSelection>;
