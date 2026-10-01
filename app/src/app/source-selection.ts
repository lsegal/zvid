import type { SourceSpan, SourceTrack } from "./types.ts";

// A selected source track, or a selected source clip and the track it sits
// on, which selecting the clip makes the active source track.
export type SourceSelection = {
  sourceTrackId: string;
  sourceSpanId?: string;
};

// How a source selection is kept with the workspace view.
export type SourceSelectionView = {
  selectedSourceTrackId?: string;
  selectedSourceSpanId?: string;
};

export function selectSourceTrack(sourceTrackId: string): SourceSelection {
  return { sourceTrackId };
}

export function selectSourceSpan(
  span: Pick<SourceSpan, "id" | "sourceTrackId">,
): SourceSelection {
  return { sourceTrackId: span.sourceTrackId, sourceSpanId: span.id };
}

export function isSourceTrackSelected(
  selection: SourceSelection | undefined,
  sourceTrackId: string,
) {
  return selection?.sourceTrackId === sourceTrackId;
}

export function isSourceSpanSelected(
  selection: SourceSelection | undefined,
  sourceSpanId: string,
) {
  return selection?.sourceSpanId === sourceSpanId;
}

// Only one thing in the timeline is selected at a time, so selecting a layer
// or clip clears the source selection.
export function keepSourceSelection(
  selection: SourceSelection | undefined,
  selectedClipId: string | undefined,
  selectedLaneId: string | undefined,
) {
  return selectedClipId === undefined && selectedLaneId === undefined
    ? selection
    : undefined;
}

export function toSourceSelectionView(
  selection: SourceSelection | undefined,
): SourceSelectionView {
  return {
    selectedSourceTrackId: selection?.sourceTrackId,
    selectedSourceSpanId: selection?.sourceSpanId,
  };
}

// The saved source selection, while its track still exists. A saved clip
// that no longer exists, or moved to another track, leaves its track
// selected.
export function findRestoredSourceSelection(
  view: SourceSelectionView,
  sourceTracks: readonly Pick<SourceTrack, "id">[],
  sourceSpans: readonly Pick<SourceSpan, "id" | "sourceTrackId">[],
): SourceSelection | undefined {
  const { selectedSourceTrackId, selectedSourceSpanId } = view;
  if (
    !selectedSourceTrackId ||
    !sourceTracks.some((track) => track.id === selectedSourceTrackId)
  ) {
    return undefined;
  }
  const span = sourceSpans.find(
    (candidate) =>
      candidate.id === selectedSourceSpanId &&
      candidate.sourceTrackId === selectedSourceTrackId,
  );
  return span
    ? selectSourceSpan(span)
    : selectSourceTrack(selectedSourceTrackId);
}

// The selected source track, while no source clip on it is selected: what
// the source track keyboard shortcuts and menu act on.
export function findSelectedSourceTrack<T extends Pick<SourceTrack, "id">>(
  selection: SourceSelection | undefined,
  sourceTracks: readonly T[],
): T | undefined {
  if (!selection || selection.sourceSpanId !== undefined) {
    return undefined;
  }
  return sourceTracks.find((track) => track.id === selection.sourceTrackId);
}
