// Picks the "Press 1-9 to commit" hint shown inside a pending timeline range
// selection from the selection's pixel width, so the hint never spills past a
// narrow selection box.

export type SelectionHint = {
  // Text to render, or null when not even the short hint fits.
  label: string | null;
  // Symmetric horizontal padding (px) for the selection box.
  paddingPx: number;
};

export const SELECTION_HINT_FULL = "Press 1-9 to commit";
export const SELECTION_HINT_SHORT = "1-9";

// Rendered widths of the hints in `.timeline-selection span` (0.72rem Space
// Grotesk, uppercase, 0.06em letter spacing measure about 132px and 19px),
// rounded up with a little slack for font fallback.
export const SELECTION_HINT_FULL_WIDTH_PX = 140;
export const SELECTION_HINT_SHORT_WIDTH_PX = 22;

// Matches `.timeline-selection` padding in App.css; narrow selections drop to
// the compact padding so the dashed box keeps its shape around a short hint.
export const SELECTION_PADDING_PX = 14;
export const SELECTION_COMPACT_PADDING_PX = 6;

// The selection's 1px dashed border on each side.
const SELECTION_BORDER_PX = 1;

function fits(widthPx: number, textPx: number, paddingPx: number) {
  return widthPx >= textPx + 2 * (paddingPx + SELECTION_BORDER_PX);
}

/**
 * The hint and padding for a selection `widthPx` wide: the full hint with
 * the regular padding when it fits, otherwise the short hint with compact
 * padding, otherwise no hint at all.
 */
export function selectionHint(widthPx: number): SelectionHint {
  if (fits(widthPx, SELECTION_HINT_FULL_WIDTH_PX, SELECTION_PADDING_PX)) {
    return { label: SELECTION_HINT_FULL, paddingPx: SELECTION_PADDING_PX };
  }
  if (
    fits(widthPx, SELECTION_HINT_SHORT_WIDTH_PX, SELECTION_COMPACT_PADDING_PX)
  ) {
    return {
      label: SELECTION_HINT_SHORT,
      paddingPx: SELECTION_COMPACT_PADDING_PX,
    };
  }
  return { label: null, paddingPx: SELECTION_COMPACT_PADDING_PX };
}
