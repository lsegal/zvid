export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
export const ZOOM_DEFAULT = 1;
// The zooms the -/+ buttons step between. They grow by roughly the same
// factor each step, so a press feels the same at 25% as at 300%.
export const ZOOM_LADDER = [
  0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3,
] as const;

// Guards the ladder against float noise such as 0.6700000001.
const LADDER_EPSILON = 1e-6;

export function clampZoom(zoom: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

export function formatZoomFactor(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

// Moves to the next ladder zoom in the given direction, so a zoom of 0.73
// steps in to 0.8 and out to 0.67.
export function stepZoom(zoom: number, direction: 1 | -1) {
  const next =
    direction > 0
      ? ZOOM_LADDER.find((step) => step > zoom + LADDER_EPSILON)
      : ZOOM_LADDER.findLast((step) => step < zoom - LADDER_EPSILON);
  return clampZoom(next ?? zoom);
}

// The slider moves along log(zoom), so 25% to 100% and 100% to 300% get
// comparable travel. Positions run from 0 at ZOOM_MIN to 1 at ZOOM_MAX.
export const ZOOM_SLIDER_STEP = 0.005;

export function zoomToSliderPosition(zoom: number) {
  return Math.log(clampZoom(zoom) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
}

// Rounded to a whole percent, which is what the readout shows.
export function sliderPositionToZoom(position: number) {
  const fraction = Math.max(0, Math.min(1, position));
  const zoom = ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** fraction;
  return clampZoom(Math.round(zoom * 100) / 100);
}

// Fraction of the slider track that sits left of the thumb, from 0 to 1.
export function zoomFillFraction(zoom: number) {
  return zoomToSliderPosition(zoom);
}

// Right-dragging the timeline ruler up or down zooms once the pointer has
// moved past the threshold. Each further pixel multiplies the zoom by
// e^speed, so a drag feels the same at any zoom.
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
    originZoom *
      Math.exp(Math.sign(verticalDelta) * distance * TIMELINE_DRAG_ZOOM_SPEED),
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
