// Visibility rules for the "Generate a sweet timeline" call to action shown
// over an empty arrangement.

export type ArrangementEmptyStateInput = {
  clipCount: number;
  sourceSpanCount: number;
  dismissed: boolean;
};

// Without source spans the wand has nothing to pick from, so the source
// header's own empty state is the call to action instead.
export function shouldShowArrangementEmptyState({
  clipCount,
  sourceSpanCount,
  dismissed,
}: ArrangementEmptyStateInput) {
  return !dismissed && clipCount === 0 && sourceSpanCount > 0;
}

// Any clip or selection means the user has started arranging, which dismisses
// the call to action for the rest of the session.
export function hasArrangementActivity({
  clipCount,
  hasClipSelection,
  hasPendingSelection,
}: {
  clipCount: number;
  hasClipSelection: boolean;
  hasPendingSelection: boolean;
}) {
  return clipCount > 0 || hasClipSelection || hasPendingSelection;
}

// Opening or importing a session starts a new one: the call to action comes
// back only when that session's arrangement is empty.
export function isArrangementEmptyStateDismissedOnOpen(clipCount: number) {
  return clipCount > 0;
}
