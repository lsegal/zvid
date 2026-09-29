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
  type FrameBounds,
  orderStackedLayers,
  resolveFrameBounds,
} from "./composition-layout.ts";
import {
  type BoxCorners,
  canvasToLayer,
  frameBoxInCanvas,
  IDENTITY_TRANSFORM,
  isTransformEffectName,
  type LayerTransform,
  layerBoxInCanvas,
  type Point,
  parseLayerTransform,
  TRANSFORM_EFFECT_NAME,
} from "./composition-transform.ts";
import {
  addEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
} from "./fx-stack.ts";

export type Size = { width: number; height: number };

export type Rect = { left: number; top: number; width: number; height: number };

export const TRANSFORM_POSITION_X_KEY = "PositionX";
export const TRANSFORM_POSITION_Y_KEY = "PositionY";
const POSITION_LIMIT = 2;

// Shift snaps a rotation to these steps; without it, the angle still settles
// onto a right angle within the soft-snap range.
export const ROTATION_SNAP_STEP_DEG = 15;
export const ROTATION_SOFT_SNAP_DEG = 3;

export const PREVIEW_NUDGE_PX = 1;
export const PREVIEW_NUDGE_LARGE_PX = 10;

// Where the canvas is drawn inside the monitor: letterboxed like CSS
// `object-fit: contain`, centred, then magnified by `zoom` about the centre.
export function resolveVideoRect(monitor: Size, canvas: Size, zoom = 1): Rect {
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

type StackableLayer = {
  clip: { id: string; laneId: string; startQ: number };
  laneRank: number;
  isInBounds: boolean;
  visual: { transform?: LayerTransform };
};

// A layer as the preview draws it: its band, its Transform, and the corners
// of the transformed box in canvas pixels.
export type PreviewLayer = {
  laneId: string;
  clipId: string;
  placement: { frame: FrameBounds };
  transform: LayerTransform;
  corners: BoxCorners;
};

// The layers the compositor draws at the playhead, in draw order (the last
// one is on top). As in the compositor, only in-bounds layers take a band.
export function resolvePreviewLayers(
  activeClips: readonly StackableLayer[],
  canvas: Size,
): PreviewLayer[] {
  const stacked = orderStackedLayers(
    activeClips.filter((entry) => entry.isInBounds),
  );
  const canvasAspect = canvas.width / Math.max(1, canvas.height);

  return stacked.map((entry, index) => {
    const placement = {
      frame: resolveFrameBounds(index, stacked.length, canvasAspect),
    };
    const transform = entry.visual.transform ?? IDENTITY_TRANSFORM;
    return {
      laneId: entry.clip.laneId,
      clipId: entry.clip.id,
      placement,
      transform,
      corners: layerBoxInCanvas(placement, transform, canvas),
    };
  });
}

export function isPointOnLayer(
  point: Point,
  layer: Pick<PreviewLayer, "placement" | "transform">,
  canvas: Size,
) {
  const local = canvasToLayer(point, layer.placement, layer.transform, canvas);
  const edge = 1 + 1e-9;
  return (
    local !== undefined &&
    Math.abs(local.x) <= edge &&
    Math.abs(local.y) <= edge
  );
}

// The topmost layer whose transformed box holds `point`. `layers` are in
// draw order, so the last one drawn is on top.
export function hitTestLayers<
  T extends Pick<PreviewLayer, "placement" | "transform">,
>(layers: readonly T[], point: Point, canvas: Size) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (isPointOnLayer(point, layers[index], canvas)) {
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

// The Transform a drag edits: the layer's last enabled one, which is the one
// the compositor applies, or else its last bypassed one.
export function findLayerTransform(
  effects: readonly SessionEffect[],
  laneId: string,
) {
  const transforms = effects.filter(
    (effect) =>
      effect.trackId === laneId && isTransformEffectName(effect.effectName),
  );
  return (
    transforms.findLast((effect) => effect.enabled !== false) ??
    transforms[transforms.length - 1]
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

// The full Transform a drag edits, or the identity when the layer has none.
export function readLayerTransform(
  effects: readonly SessionEffect[],
  laneId: string,
): LayerTransform {
  const transform = findLayerTransform(effects, laneId);
  return transform
    ? parseLayerTransform(transform.parameters)
    : { ...IDENTITY_TRANSFORM };
}

function readNumericParameter(effect: SessionEffect | undefined, key: string) {
  const parameter = effect?.parameters.find(
    (candidate) => candidate.key === key,
  );
  const value =
    parameter?.numericValue ?? Number.parseFloat(parameter?.value ?? "");
  return Number.isFinite(value) ? value : 0;
}

// Writes the layer's Transform position, first adding a Transform with the
// registry defaults (with `newEffectId`) to the end of the layer's stack if
// it has none. A bypassed Transform is turned back on so the move shows.
// Returns `effects` itself when nothing changed.
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

  result = setEffectEnabled(result, transform.id, true);
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

export function readLayerTransformRotation(
  effects: readonly SessionEffect[],
  laneId: string,
) {
  return readLayerTransform(effects, laneId).rotationDeg;
}

// Writes the layer's Transform rotation, adding or re-enabling the Transform
// as `setLayerTransformPosition` does.
export function setLayerTransformRotation(
  effects: SessionEffect[],
  laneId: string,
  rotationDeg: number,
  newEffectId: string,
) {
  return setLayerTransformParameters(
    effects,
    laneId,
    { rotationDeg: wrapRotation(rotationDeg) },
    newEffectId,
  );
}

const TRANSFORM_PARAMETER_KEYS: Record<keyof LayerTransform, string> = {
  positionX: TRANSFORM_POSITION_X_KEY,
  positionY: TRANSFORM_POSITION_Y_KEY,
  scaleX: "ScaleX",
  scaleY: "ScaleY",
  originX: "OriginX",
  originY: "OriginY",
  rotationDeg: "Rotation",
};

// Writes the given fields of the layer's Transform, adding or re-enabling it
// as `setLayerTransformPosition` does.
export function setLayerTransformParameters(
  effects: SessionEffect[],
  laneId: string,
  values: Partial<LayerTransform>,
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

  result = setEffectEnabled(result, transform.id, true);
  for (const field of Object.keys(values) as Array<keyof LayerTransform>) {
    const value = values[field];
    if (value !== undefined && Number.isFinite(value)) {
      result = setEffectParameter(
        result,
        transform.id,
        TRANSFORM_PARAMETER_KEYS[field],
        value,
      );
    }
  }
  return result;
}

export function moveHistoryLabel(layerName: string) {
  return `Move ${layerName}`;
}

// Where the layer's origin marker sits on the canvas. The Transform pivots on
// its origin and then offsets by its position, so the origin stays put while
// the layer rotates or scales about it.
export function layerOriginInCanvas(
  layer: Pick<PreviewLayer, "placement" | "transform">,
  canvas: Size,
): Point {
  const box = frameBoxInCanvas(layer.placement.frame, canvas);
  const { transform } = layer;
  return {
    x:
      box.x +
      ((transform.originX + 1) / 2) * box.width +
      transform.positionX * canvas.width,
    y:
      box.y +
      ((transform.originY + 1) / 2) * box.height +
      transform.positionY * canvas.height,
  };
}

// Into the Transform's -180..180 range, keeping 180 rather than -180.
export function wrapRotation(degrees: number) {
  if (!Number.isFinite(degrees)) {
    return 0;
  }

  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

// The Rotation for a rotate drag: the start rotation plus how far the pointer
// has turned about the origin. Positive is clockwise on screen, as the canvas
// has +y down. Position is left alone: the Transform already pivots on its
// origin, so the origin stays put and the box swings around it. Shift snaps
// to 15 degree steps; otherwise the angle settles onto 0, 90, 180 or -90 when
// within a few degrees of one.
export function rotateTransform(
  start: LayerTransform,
  originCanvas: Point,
  pointerStart: Point,
  pointerNow: Point,
  { snap15 = false }: { snap15?: boolean } = {},
): LayerTransform {
  const angleOf = (point: Point) =>
    (Math.atan2(point.y - originCanvas.y, point.x - originCanvas.x) * 180) /
    Math.PI;
  const turned = angleOf(pointerNow) - angleOf(pointerStart);
  let rotation = wrapRotation(start.rotationDeg + turned);
  if (snap15) {
    rotation = wrapRotation(
      Math.round(rotation / ROTATION_SNAP_STEP_DEG) * ROTATION_SNAP_STEP_DEG,
    );
  } else {
    const rightAngle = wrapRotation(Math.round(rotation / 90) * 90);
    if (
      Math.abs(wrapRotation(rotation - rightAngle)) <= ROTATION_SOFT_SNAP_DEG
    ) {
      rotation = rightAngle;
    }
  }

  // Avoid writing -0.
  return { ...start, rotationDeg: rotation === 0 ? 0 : rotation };
}

// The angle readout shown while rotating, e.g. "32.5°".
export function formatRotation(degrees: number) {
  const rounded = Math.round(degrees * 10) / 10;
  return `${rounded === 0 ? "0" : rounded.toFixed(1).replace(/\.0$/, "")}°`;
}

export function rotateHistoryLabel(layerName: string) {
  return `Rotate ${layerName}`;
}

export function resetRotationHistoryLabel(layerName: string) {
  return `Reset rotation of ${layerName}`;
}
