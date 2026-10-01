// Scrubbing the playhead from the ruler keeps it under the pointer by
// scrolling the timeline. The track labels cover the first `labelWidth`
// pixels of the viewport, so the pointer is only anchored within the lanes,
// and the view never scrolls against the drag: dragging left past 00:00:00
// leaves it put instead of scrolling right.

/**
 * The timeline scroll position during a scrub. `playheadPx` is the playhead
 * in scroll content pixels, `pointerX` is the pointer relative to the
 * viewport's left edge, and `deltaX` is the pointer's horizontal movement
 * since the last scrub update.
 */
export function scrubScrollLeft({
  playheadPx,
  pointerX,
  deltaX,
  scrollLeft,
  viewportWidth,
  labelWidth,
  maxScrollLeft,
}: {
  playheadPx: number;
  pointerX: number;
  deltaX: number;
  scrollLeft: number;
  viewportWidth: number;
  labelWidth: number;
  maxScrollLeft: number;
}) {
  const anchorX = Math.min(
    Math.max(pointerX, labelWidth),
    Math.max(labelWidth, viewportWidth),
  );
  const target = Math.min(
    Math.max(0, playheadPx - anchorX),
    Math.max(0, maxScrollLeft),
  );

  if (deltaX < 0) {
    return Math.min(target, scrollLeft);
  }
  if (deltaX > 0) {
    return Math.max(target, scrollLeft);
  }
  return scrollLeft;
}
