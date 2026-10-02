import type { RefObject } from "react";
import type { ProjectState } from "../app/types.ts";
import type { SavedWorkspaceSession } from "../app/workspace-types.ts";
import type { MediaItem } from "../media";
import type { createSpaceHold } from "../space-shortcut";
import type { AppLayout } from "./useAppLayout.ts";
import { useArrangementEmptyState } from "./useArrangementEmptyState.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import { useRulerGestures } from "./useRulerGestures.ts";
import { useTimelineLanes } from "./useTimelineLanes.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import { useTimelineThumbnails } from "./useTimelineThumbnails.ts";
import { useTimelineViewport } from "./useTimelineViewport.ts";

export type TimelineInputs = {
  restoredSession: SavedWorkspaceSession | null;
  project: ProjectState;
  store: Pick<ProjectStore, "playheadQRef" | "commitViewChange">;
  selection: Pick<
    TimelineSelectionState,
    | "timelineClips"
    | "timelineSourceSpans"
    | "pendingSelection"
    | "selectedClipId"
  >;
  layout: Pick<
    AppLayout,
    "labelWidth" | "shortcutLabels" | "prefersReducedMotion"
  >;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  spaceHoldRef: { current: ReturnType<typeof createSpaceHold> };
};

// The timeline's view: its zoom, grid and scroll position
// (useTimelineViewport), the empty arrangement's call to action, the clips
// grouped by layer, the filmstrips and thumbnails, and the ruler and pan
// gestures.
export function useTimeline({
  restoredSession,
  project,
  store,
  selection,
  layout,
  mediaItemsById,
  timelineScrollRef,
  arrangementLanesRef,
  spaceHoldRef,
}: TimelineInputs) {
  const {
    timelineMode,
    signatureId,
    bpm,
    zoom,
    lanes,
    sourceSpans,
    clips,
    effects,
  } = project;
  const { playheadQRef, commitViewChange } = store;
  const { timelineClips, pendingSelection, selectedClipId } = selection;
  // A source clip being dragged draws where the drop would put it.
  const { timelineSourceSpans } = selection;
  const { labelWidth, shortcutLabels, prefersReducedMotion } = layout;

  const viewport = useTimelineViewport({
    zoom,
    signatureId,
    timelineMode,
    bpm,
    timelineClips,
    sourceSpans,
    pendingSelection,
    labelWidth,
    playheadQRef,
    timelineScrollRef,
    arrangementLanesRef,
    commitViewChange,
  });
  const {
    resolvedZoom,
    updateZoomDraft,
    flushZoomDraft,
    quarterPx,
    totalQuarters,
    filmstripRangeStartPx,
    filmstripRangeEndPx,
    syncTimelineViewport,
  } = viewport;
  const emptyState = useArrangementEmptyState({
    restoredSession,
    clips,
    sourceSpans,
    selectedClipId,
    pendingSelection,
    syncTimelineViewport,
  });
  const timelineLanes = useTimelineLanes({
    lanes,
    timelineClips,
    sourceSpans: timelineSourceSpans,
    effects,
  });
  const thumbnails = useTimelineThumbnails({
    bpm,
    quarterPx,
    timelineClips,
    sourceSpans: timelineSourceSpans,
    mediaItemsById,
    filmstripRangeStartPx,
    filmstripRangeEndPx,
  });
  const rulerGestures = useRulerGestures({
    shortcutLabels,
    resolvedZoom,
    labelWidth,
    totalQuarters,
    prefersReducedMotion,
    timelineScrollRef,
    spaceHoldRef,
    updateZoomDraft,
    flushZoomDraft,
  });

  return {
    ...viewport,
    ...emptyState,
    ...timelineLanes,
    ...thumbnails,
    ...rulerGestures,
  };
}

export type Timeline = ReturnType<typeof useTimeline>;
