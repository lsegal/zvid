// Pure geometry and effect edits behind on-canvas editing in the preview
// monitor: mapping pointer positions onto the composition canvas, picking the
// layer under the pointer, and writing drags to the layer's Transform effect.
//
// Screen points are CSS pixels relative to the preview monitor's top-left
// corner. Canvas points are composition pixels (the session's canvas size,
// origin top-left, +y down). Pointer events and element sizes are already in
// CSS pixels, so the device pixel ratio never enters the mapping: it only
// changes the canvas backing store, not where the canvas sits on screen.
import {
  addEffect,
  type SessionEffect,
  setEffectParameter,
} from "./fx-stack.ts";

export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

export type Rect = { left: number; top: number; width: number; height: number };

// Corners of a layer's box in canvas pixels, in drawing order around the box.
export type Quad = readonly [Point, Point, Point, Point];

export const TRANSFORM_EFFECT_NAME = "Transform";
export const TRANSFORM_POSITION_X_KEY = "PositionX";
export const TRANSFORM_POSITION_Y_KEY = "PositionY";
const POSITION_LIMIT = 2;

export const PREVIEW_NUDGE_PX = 1;
export const PREVIEW_NUDGE_LARGE_PX = 10;

// Where the canvas is drawn inside the monitor: letterboxed like CSS
// `object-fit: contain`, centred, then magnified by `zoom` about the centre.
export function resolveVideoRect(
  monitor: Size,
  canvas: Size,
  zoom = 1,
): Rect {
  const canvasWidth = Math.max(1, canvas.width);
  const canvasHeight = Math.max(1, canvas.height);
  const fit =
    Math.min(monitor.width / canvasWidth, monitor.height / canvasHeight) *
    Math.max(0.0001, zoom);
  const width = canvasWidth * fit;
  const height = canvasHeight * fit;

  return {
    left: (monitor.width - width) / 2,
    top: (monitor.height - height) / 2,
    width,
    height,
  };
}

export function screenToCanvas(point: Point, video: Rect, canvas: Size): Point {
  return {
    x: ((point.x - video.left) / Math.max(0.0001, video.width)) * canvas.width,
    y: ((point.y - video.top) / Math.max(0.0001, video.height)) * canvas.height,
  };
}

export function canvasToScreen(point: Point, video: Rect, canvas: Size): Point {
  return {
    x: video.left + (point.x / Math.max(1, canvas.width)) * video.width,
    y: video.top + (point.y / Math.max(1, canvas.height)) * video.height,
  };
}

// Converts a clip-space point (-1..1, +y up), as the compositor places
// layers, into canvas pixels.
export function clipSpaceToCanvas(point: Point, canvas: Size): Point {
  return {
    x: ((point.x + 1) / 2) * canvas.width,
    y: ((1 - point.y) / 2) * canvas.height,
  };
}

// True when `point` lies inside or on the edge of the convex `quad`, in
// either winding.
export function isPointInQuad(point: Point, quad: Quad) {
  let sign = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const from = quad[index];
    const to = quad[(index + 1) % quad.length];
    const cross =
      (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    if (cross === 0) {
      continue;
    }

    const side = Math.sign(cross);
    if (sign === 0) {
      sign = side;
    } else if (side !== sign) {
      return false;
    }
  }

  return true;
}

// The topmost layer whose box holds `point`. `layers` are in draw order, so
// the last one drawn is on top.
export function hitTestLayers<T extends { quad: Quad }>(
  layers: readonly T[],
  point: Point,
) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (isPointInQuad(point, layers[index].quad)) {
      return layers[index];
    }
  }

  return undefined;
}

// Shift constrains a drag to whichever axis it has moved further along.
export function constrainDragDelta(delta: Point, axisLock: boolean): Point {
  if (!axisLock) {
    return delta;
  }

  return Math.abs(delta.x) >= Math.abs(delta.y)
    ? { x: delta.x, y: 0 }
    : { x: 0, y: delta.y };
}

// Transform positions are in canvas widths (x) and heights (y, +down) from
// the centre, so a pixel delta divides by the canvas size.
export function offsetTransformPosition(
  start: Point,
  deltaCanvasPx: Point,
  canvas: Size,
): Point {
  return {
    x: clampPosition(start.x + deltaCanvasPx.x / Math.max(1, canvas.width)),
    y: clampPosition(start.y + deltaCanvasPx.y / Math.max(1, canvas.height)),
  };
}

function clampPosition(value: number) {
  return Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, value));
}

// The canvas-pixel move for an arrow key, or undefined for other keys.
export function resolveNudgeDelta(key: string, large: boolean) {
  const step = large ? PREVIEW_NUDGE_LARGE_PX : PREVIEW_NUDGE_PX;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return undefined;
  }
}

export function isTransformEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "transform";
}

// The layer's own Transform effect: the last one in its stack, since it is
// applied last.
export function findLayerTransform(
  effects: readonly SessionEffect[],
  laneId: string,
) {
  return effects.findLast(
    (effect) =>
      effect.trackId === laneId && isTransformEffectName(effect.effectName),
  );
}

export function readLayerTransformPosition(
  effects: readonly SessionEffect[],
  laneId: string,
): Point {
  const transform = findLayerTransform(effects, laneId);
  return {
    x: readNumericParameter(transform, TRANSFORM_POSITION_X_KEY),
    y: readNumericParameter(transform, TRANSFORM_POSITION_Y_KEY),
  };
}

function readNumericParameter(
  effect: SessionEffect | undefined,
  key: string,
) {
  const parameter = effect?.parameters.find(
    (candidate) => candidate.key === key,
  );
  const value =
    parameter?.numericValue ?? Number.parseFloat(parameter?.value ?? "");
  return Number.isFinite(value) ? value : 0;
}

// Writes the layer's Transform position, first adding a Transform with the
// registry defaults (with `newEffectId`) to the end of the layer's stack if
// it has none. Returns `effects` itself when nothing changed.
export function setLayerTransformPosition(
  effects: SessionEffect[],
  laneId: string,
  position: Point,
  newEffectId: string,
) {
  let result = effects;
  let transform = findLayerTransform(result, laneId);
  if (!transform) {
    result = addEffect(
      result,
      laneId,
      TRANSFORM_EFFECT_NAME,
      undefined,
      newEffectId,
    );
    transform = findLayerTransform(result, laneId);
    if (!transform) {
      return effects;
    }
  }

  result = setEffectParameter(
    result,
    transform.id,
    TRANSFORM_POSITION_X_KEY,
    clampPosition(position.x),
  );
  return setEffectParameter(
    result,
    transform.id,
    TRANSFORM_POSITION_Y_KEY,
    clampPosition(position.y),
  );
}

export function moveHistoryLabel(layerName: string) {
  return `Move ${layerName}`;
}
