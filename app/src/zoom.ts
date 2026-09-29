export const ZOOM_MIN = 0.65;
export const ZOOM_MAX = 1.8;
export const ZOOM_DEFAULT = 1;
export const ZOOM_BUTTON_STEP = 0.1;

// Guards the grid snap against float noise such as 0.7 / 0.1 = 6.999....
const GRID_EPSILON = 1e-6;

export function clampZoom(zoom: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

export function formatZoomFactor(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

// Moves to the next multiple of the step in the given direction, so a zoom of
// 0.73 steps in to 0.8 rather than 0.83.
export function stepZoom(
  zoom: number,
  direction: 1 | -1,
  step = ZOOM_BUTTON_STEP,
) {
  const index = zoom / step;
  const nextIndex =
    direction > 0
      ? Math.floor(index + GRID_EPSILON) + 1
      : Math.ceil(index - GRID_EPSILON) - 1;
  return clampZoom(Math.round(nextIndex * step * 100) / 100);
}

// Fraction of the slider track that sits left of the thumb, from 0 to 1.
export function zoomFillFraction(zoom: number) {
  return (clampZoom(zoom) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
}

// Right-dragging the timeline ruler up or down zooms once the pointer has
// moved past the threshold, by the speed per further pixel.
export const TIMELINE_DRAG_ZOOM_SPEED = 0.004;
export const TIMELINE_DRAG_ZOOM_THRESHOLD_PX = 25;

// The zoom for a ruler drag that began at `originZoom` and has moved
// `verticalDelta` pixels up (negative for down): up zooms in.
export function timelineDragZoom(originZoom: number, verticalDelta: number) {
  const distance = Math.abs(verticalDelta) - TIMELINE_DRAG_ZOOM_THRESHOLD_PX;
  if (distance <= 0) {
    return clampZoom(originZoom);
  }

  return clampZoom(
    originZoom + Math.sign(verticalDelta) * distance * TIMELINE_DRAG_ZOOM_SPEED,
  );
}

// The timeline scroll that puts `anchorQ` (in quarters) at `pointerX`, the
// pointer's offset from the scroll view's left edge, when a quarter is
// `quarterPx` wide, clamped to the scrollable range.
export function anchoredTimelineScrollLeft({
  anchorQ,
  pointerX,
  quarterPx,
  labelWidth,
  totalQuarters,
  clientWidth,
}: {
  anchorQ: number;
  pointerX: number;
  quarterPx: number;
  labelWidth: number;
  totalQuarters: number;
  clientWidth: number;
}) {
  const maxScrollLeft = Math.max(
    0,
    labelWidth + totalQuarters * quarterPx - clientWidth,
  );
  return Math.max(
    0,
    Math.min(maxScrollLeft, labelWidth + anchorQ * quarterPx - pointerX),
  );
}
