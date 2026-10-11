import type { FxSheetHeight } from "../hooks/useMobileShell.ts";

// How far a finger drags a sheet before it counts as a drag rather than a
// tap, and how far it must travel to move the sheet to its next height.
export const SHEET_DRAG_SLOP = 6;
export const SHEET_DRAG_THRESHOLD = 48;

// The half-height FX sheet's share of the viewport (52dvh in
// mobile-shell.css).
const FX_HALF_SHARE = 0.52;

// Where the FX sheet lands after its header is dragged `dy` pixels (down is
// positive): up goes to full height, down from half closes it, and down
// from full stops at half unless the finger carried on well past half.
export function fxSheetAfterDrag(
  height: FxSheetHeight,
  dy: number,
  viewportHeight: number,
): FxSheetHeight | null {
  if (Math.abs(dy) < SHEET_DRAG_THRESHOLD) {
    return height;
  }
  if (dy < 0) {
    return "full";
  }
  if (height === "half") {
    return null;
  }
  const toHalf = viewportHeight * (1 - FX_HALF_SHARE);
  return dy < toHalf + SHEET_DRAG_THRESHOLD ? "half" : null;
}

// Whether dragging a menu sheet's grabber `dy` pixels down dismisses it.
export function menuSheetClosesAfterDrag(dy: number) {
  return dy >= SHEET_DRAG_THRESHOLD;
}
