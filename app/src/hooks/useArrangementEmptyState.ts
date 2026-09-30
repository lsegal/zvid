import { useEffect, useState } from "react";
import type {
  ArrangementClip,
  SourceSpan,
  TimelineSelection,
} from "../app/types.ts";
import type { SavedWorkspaceSession } from "../app/workspace-types.ts";
import {
  hasArrangementActivity,
  isArrangementEmptyStateDismissedOnOpen,
  shouldShowArrangementEmptyState,
} from "../arrangement-empty-state.ts";

export type ArrangementEmptyStateInputs = {
  restoredSession: SavedWorkspaceSession | null;
  clips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  selectedClipId: string | undefined;
  pendingSelection: TimelineSelection | null;
  syncTimelineViewport: () => void;
};

// Whether the empty arrangement's call to action shows. Any clip or
// selection dismisses it for the rest of the session.
export function useArrangementEmptyState({
  restoredSession,
  clips,
  sourceSpans,
  selectedClipId,
  pendingSelection,
  syncTimelineViewport,
}: ArrangementEmptyStateInputs) {
  const [arrangementEmptyStateDismissed, setArrangementEmptyStateDismissed] =
    useState(() =>
      restoredSession
        ? isArrangementEmptyStateDismissedOnOpen(
            restoredSession.history.present.clips.length,
          )
        : false,
    );
  const showArrangementEmptyState = shouldShowArrangementEmptyState({
    clipCount: clips.length,
    sourceSpanCount: sourceSpans.length,
    dismissed: arrangementEmptyStateDismissed,
  });
  useEffect(() => {
    if (
      hasArrangementActivity({
        clipCount: clips.length,
        hasClipSelection: selectedClipId !== undefined,
        hasPendingSelection: pendingSelection !== null,
      })
    ) {
      setArrangementEmptyStateDismissed(true);
    }
  }, [clips.length, pendingSelection, selectedClipId]);

  // The empty arrangement's call to action sizes itself below the ruler.
  useEffect(() => {
    if (showArrangementEmptyState) {
      syncTimelineViewport();
    }
  }, [showArrangementEmptyState, syncTimelineViewport]);

  return { showArrangementEmptyState, setArrangementEmptyStateDismissed };
}
