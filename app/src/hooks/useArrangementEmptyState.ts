import { useEffect, useState } from "react";
import type { TimelineSelection } from "../app/types.ts";
import type { SavedWorkspaceSession } from "../app/workspace-types.ts";
import {
  hasArrangementActivity,
  isArrangementEmptyStateDismissedOnOpen,
  shouldShowArrangementEmptyState,
} from "../arrangement-empty-state.ts";

export type ArrangementEmptyStateInputs = {
  restoredSession: SavedWorkspaceSession | null;
  clipCount: number;
  sourceSpanCount: number;
  selectedClipId: string | undefined;
  pendingSelection: TimelineSelection | null;
  syncTimelineViewport: () => void;
};

// Whether the empty arrangement's call to action shows. Any clip or
// selection dismisses it for the rest of the session.
export function useArrangementEmptyState({
  restoredSession,
  clipCount,
  sourceSpanCount,
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
    clipCount,
    sourceSpanCount,
    dismissed: arrangementEmptyStateDismissed,
  });
  useEffect(() => {
    if (
      hasArrangementActivity({
        clipCount,
        hasClipSelection: selectedClipId !== undefined,
        hasPendingSelection: pendingSelection !== null,
      })
    ) {
      setArrangementEmptyStateDismissed(true);
    }
  }, [clipCount, pendingSelection, selectedClipId]);

  // The empty arrangement's call to action sizes itself below the ruler.
  useEffect(() => {
    if (showArrangementEmptyState) {
      syncTimelineViewport();
    }
  }, [showArrangementEmptyState, syncTimelineViewport]);

  return { showArrangementEmptyState, setArrangementEmptyStateDismissed };
}
