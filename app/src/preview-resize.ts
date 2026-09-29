// Pure maths behind the preview's resize handles and origin marker: dragging
// a handle rescales the layer's Transform about the opposite edge or corner
// (or the box centre), and dragging the origin moves the pivot without moving
// the layer on screen.
//
// Box-local points use the Transform's origin units: -1 is the left (top)
// edge, 0 the centre, 1 the right (bottom) edge. Canvas points are
// composition pixels, origin top-left, +y down.
import {
  applyMatrix,
  type Box,
  type CanvasSize,
  type LayerTransform,
  invertMatrix,
  type Point,
  transformMatrix,
} from "./composition-transform.ts";

export const TRANSFORM_SCALE_MIN = 0.05;
export const TRANSFORM_SCALE_MAX = 8;
const POSITION_LIMIT = 2;
const ORIGIN_LIMIT = 1;

// A resize handle by where it sits on the box: -1, 0 or 1 on each axis, with
// 0 on one axis for an edge midpoint.
export type ResizeHandle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
];

export type ResizeOptions = {
  // Shift: keep the aspect ratio.
  proportional?: boolean;
  // Ctrl/Cmd: grow or shrink about the box centre.
  fromCenter?: boolean;
};

export type ResizeSnap = {
  // Canvas x / y lines the moving edges snap to (the canvas edges and centre
  // lines).
  xLines: readonly number[];
  yLines: readonly number[];
  // Snap distance, in canvas pixels.
  threshold: number;
};

export type ResizeResult = {
  transform: LayerTransform;
  // The canvas lines a moving edge snapped to, for guide lines.
  guides: { x: number[]; y: number[] };
};

export function handleName(handle: ResizeHandle) {
  const vertical = handle.y < 0 ? "n" : handle.y > 0 ? "s" : "";
  const horizontal = handle.x < 0 ? "w" : handle.x > 0 ? "e" : "";
  return `${vertical}${horizontal}`;
}

// A box-local point in canvas pixels, after the Transform.
export function layerPointInCanvas(
  local: Point,
  transform: LayerTransform,
  box: Box,
  canvas: CanvasSize,
): Point {
  return applyMatrix(transformMatrix(transform, box, canvas), {
    x: box.x + ((local.x + 1) / 2) * box.width,
    y: box.y + ((local.y + 1) / 2) * box.height,
  });
}

// The resize cursor for a handle, turned with the box: the handle's direction
// from the centre on screen, rounded to the nearest of the four cursors.
export function resizeCursor(handle: ResizeHandle, rotationDeg: number) {
  const base = (Math.atan2(handle.y, handle.x) * 180) / Math.PI;
  const angle = (((base + rotationDeg) % 180) + 180) % 180;
  const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return cursors[Math.round(angle / 45) % 4];
}

// The Transform after dragging `handle` by `pointerDelta` canvas pixels from
// where it was on `start`. The fixed point is the opposite edge or corner, or
// the box centre with `fromCenter`, and the position moves so that point stays
// put on screen. Scales clamp to the Transform's limits, so dragging past the
// fixed point stops at the smallest size instead of flipping the layer.
export function resizeTransform(
  start: LayerTransform,
  handle: ResizeHandle,
  pointerDelta: Point,
  box: Box,
  canvas: CanvasSize,
  options: ResizeOptions = {},
  snap?: ResizeSnap,
): ResizeResult {
  const guides: ResizeResult["guides"] = { x: [], y: [] };
  if (box.width <= 0 || box.height <= 0) {
    return { transform: start, guides };
  }

  const anchor = options.fromCenter
    ? { x: 0, y: 0 }
    : { x: -handle.x, y: -handle.y };
  const radians = (start.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // The pointer's move along the box's own (rotated) axes.
  const along = {
    x: cos * pointerDelta.x + sin * pointerDelta.y,
    y: -sin * pointerDelta.x + cos * pointerDelta.y,
  };
  // Box-local units between the fixed point and the handle, per axis.
  const spanX = handle.x - anchor.x;
  const spanY = handle.y - anchor.y;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scaleFor = (span: number, half: number, scale: number, move: number) =>
    span === 0 ? scale : (span * scale * half + move) / (span * half);

  let scaleX = scaleFor(spanX, halfWidth, start.scaleX, along.x);
  let scaleY = scaleFor(spanY, halfHeight, start.scaleY, along.y);

  if (options.proportional) {
    let factor: number;
    if (spanX !== 0 && spanY !== 0) {
      // A corner scales both axes by how far the pointer travels along the
      // line from the fixed point through the handle.
      const fromX = spanX * start.scaleX * halfWidth;
      const fromY = spanY * start.scaleY * halfHeight;
      factor =
        ((fromX + along.x) * fromX + (fromY + along.y) * fromY) /
        (fromX * fromX + fromY * fromY);
    } else {
      factor = spanX !== 0 ? scaleX / start.scaleX : scaleY / start.scaleY;
    }

    const lowest = Math.max(
      TRANSFORM_SCALE_MIN / start.scaleX,
      TRANSFORM_SCALE_MIN / start.scaleY,
    );
    const highest = Math.min(
      TRANSFORM_SCALE_MAX / start.scaleX,
      TRANSFORM_SCALE_MAX / start.scaleY,
    );
    factor = Math.max(lowest, Math.min(highest, factor));
    scaleX = start.scaleX * factor;
    scaleY = start.scaleY * factor;
  } else {
    scaleX = clampScale(scaleX);
    scaleY = clampScale(scaleY);
  }

  const next = withScale(start, scaleX, scaleY, anchor, box, canvas);

  // Snapping only lines up edges of an unrotated box with plain drags.
  if (
    !snap ||
    options.proportional ||
    options.fromCenter ||
    start.rotationDeg % 360 !== 0
  ) {
    return { transform: next, guides };
  }

  const fixed = layerPointInCanvas(anchor, start, box, canvas);
  const snapScale = (
    span: number,
    half: number,
    scale: number,
    fixedAt: number,
    lines: readonly number[],
    found: number[],
  ) => {
    if (span === 0) {
      return scale;
    }

    const edge = fixedAt + span * scale * half;
    let best = scale;
    let bestDistance = snap.threshold;
    for (const line of lines) {
      const distance = Math.abs(line - edge);
      const snapped = (line - fixedAt) / (span * half);
      if (
        distance <= bestDistance &&
        snapped >= TRANSFORM_SCALE_MIN &&
        snapped <= TRANSFORM_SCALE_MAX
      ) {
        best = snapped;
        bestDistance = distance;
        found.length = 0;
        found.push(line);
      }
    }
    return best;
  };

  const snappedX = snapScale(
    spanX,
    halfWidth,
    scaleX,
    fixed.x,
    snap.xLines,
    guides.x,
  );
  const snappedY = snapScale(
    spanY,
    halfHeight,
    scaleY,
    fixed.y,
    snap.yLines,
    guides.y,
  );
  return {
    transform: withScale(start, snappedX, snappedY, anchor, box, canvas),
    guides,
  };
}

// `start` rescaled, with the position moved so that `anchor` (box-local)
// stays where it was on screen.
function withScale(
  start: LayerTransform,
  scaleX: number,
  scaleY: number,
  anchor: Point,
  box: Box,
  canvas: CanvasSize,
): LayerTransform {
  const next = { ...start, scaleX, scaleY };
  const before = layerPointInCanvas(anchor, start, box, canvas);
  const after = layerPointInCanvas(anchor, next, box, canvas);
  return {
    ...next,
    positionX: clampPosition(
      start.positionX + (before.x - after.x) / Math.max(1, canvas.width),
    ),
    positionY: clampPosition(
      start.positionY + (before.y - after.y) / Math.max(1, canvas.height),
    ),
  };
}

// Box-local points the origin snaps to: the centre, corners and edge
// midpoints.
export const ORIGIN_SNAP_POINTS: readonly Point[] = [
  { x: 0, y: 0 },
  ...RESIZE_HANDLES,
];

// The Transform with its origin moved to `originCanvas` (a canvas point) and
// its position compensated so the layer doesn't move on screen. The origin is
// clamped to the box. Returns `start` for a box that has collapsed.
export function moveOrigin(
  start: LayerTransform,
  originCanvas: Point,
  box: Box,
  canvas: CanvasSize,
): LayerTransform {
  const local = canvasToBoxLocal(originCanvas, start, box, canvas);
  if (!local) {
    return start;
  }

  return setOrigin(start, local, box, canvas);
}

// The Transform with its origin set to `origin` (box-local), with the position
// compensated so the layer doesn't move on screen.
export function setOrigin(
  start: LayerTransform,
  origin: Point,
  box: Box,
  canvas: CanvasSize,
): LayerTransform {
  const next = {
    ...start,
    originX: clampOrigin(origin.x),
    originY: clampOrigin(origin.y),
  };
  // Any box point works as a reference: the position only has to undo how
  // the pivot shifts the whole box.
  const reference = { x: 0, y: 0 };
  const before = layerPointInCanvas(reference, start, box, canvas);
  const after = layerPointInCanvas(reference, next, box, canvas);
  return {
    ...next,
    positionX: clampPosition(
      start.positionX + (before.x - after.x) / Math.max(1, canvas.width),
    ),
    positionY: clampPosition(
      start.positionY + (before.y - after.y) / Math.max(1, canvas.height),
    ),
  };
}

// Snaps a dragged origin (a canvas point) to the nearest of the box's centre,
// corners and edge midpoints within `threshold` canvas pixels.
export function snapOriginPoint(
  point: Point,
  transform: LayerTransform,
  box: Box,
  canvas: CanvasSize,
  threshold: number,
): Point {
  let best = point;
  let bestDistance = threshold;
  for (const candidate of ORIGIN_SNAP_POINTS) {
    const snapped = layerPointInCanvas(candidate, transform, box, canvas);
    const distance = Math.hypot(snapped.x - point.x, snapped.y - point.y);
    if (distance <= bestDistance) {
      best = snapped;
      bestDistance = distance;
    }
  }

  return best;
}

function canvasToBoxLocal(
  point: Point,
  transform: LayerTransform,
  box: Box,
  canvas: CanvasSize,
): Point | undefined {
  if (box.width <= 0 || box.height <= 0) {
    return undefined;
  }

  const inverse = invertMatrix(transformMatrix(transform, box, canvas));
  if (!inverse) {
    return undefined;
  }

  const { x, y } = applyMatrix(inverse, point);
  return {
    x: ((x - box.x) / box.width) * 2 - 1,
    y: ((y - box.y) / box.height) * 2 - 1,
  };
}

export function resizeHistoryLabel(layerName: string) {
  return `Resize ${layerName}`;
}

export const MOVE_ORIGIN_HISTORY_LABEL = "Move origin";

function clampScale(value: number) {
  return Math.max(TRANSFORM_SCALE_MIN, Math.min(TRANSFORM_SCALE_MAX, value));
}

function clampPosition(value: number) {
  return Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, value));
}

function clampOrigin(value: number) {
  return Math.max(-ORIGIN_LIMIT, Math.min(ORIGIN_LIMIT, value));
}
