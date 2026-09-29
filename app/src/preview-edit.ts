// Pure geometry and effect edits behind on-canvas editing in the preview
// monitor: mapping pointer positions onto the composition canvas, picking the
// layer under the pointer, and writing drags to a Transform effect: the
// selected clip's own, nested inside its layer's, or the layer's when only
// the layer is selected.
//
// Screen points are CSS pixels relative to the preview monitor's top-left
// corner. Canvas points are composition pixels (the session's canvas size,
// origin top-left, +y down). Pointer events and element sizes are already in
// CSS pixels, so the device pixel ratio never enters the mapping: it only
// changes the canvas backing store, not where the canvas sits on screen.
import {
  type FrameBounds,
  orderStackedLayers,
  planLayerDraws,
  resolveCanvasBounds,
  resolveSlotBounds,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
} from "./composition-order.ts";
import {
  type Box,
  type BoxCorners,
  canvasToLayer,
  frameBoxInCanvas,
  IDENTITY_MATRIX,
  IDENTITY_TRANSFORM,
  invertMatrix,
  isTransformEffectName,
  type LayerTransform,
  layerBoxInCanvas,
  type Matrix2D,
  type Point,
  parseLayerTransform,
  TRANSFORM_EFFECT_NAME,
  transformMatrix,
} from "./composition-transform.ts";
import {
  addEffect,
  clipEffectTrackId,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
} from "./fx-stack.ts";

export type Size = { width: number; height: number };

export type Rect = { left: number; top: number; width: number; height: number };

export const TRANSFORM_POSITION_X_KEY = "PositionX";
export const TRANSFORM_POSITION_Y_KEY = "PositionY";
const POSITION_LIMIT = 2;

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
  visual: { transform?: LayerTransform; clipTransform?: LayerTransform };
  // Set for FX clips, which take no slot and adjust the whole canvas.
  fx?: boolean;
};

// A layer as the preview draws it: its slot, its layer's Transform, its
// clip's own Transform (inside the layer's), and the corners of the clip's
// transformed box in canvas pixels.
export type PreviewLayer = {
  laneId: string;
  clipId: string;
  placement: { frame: FrameBounds };
  transform: LayerTransform;
  clipTransform: LayerTransform;
  corners: BoxCorners;
};

// What a preview edit writes to: the clip's own Transform when `clipId` is
// set, else the layer's.
export type PreviewEditTarget = { laneId: string; clipId?: string };

// The stack holding a target's Transform.
export function getPreviewEditTrackId(target: PreviewEditTarget) {
  return target.clipId === undefined
    ? target.laneId
    : clipEffectTrackId(target.clipId);
}

// The Transform a drag edits on `layer`, with the box it applies to and the
// matrix that places the result (the layer's Transform, for a clip's): the
// drag maths work in that parent's space, then map back to the canvas.
export type PreviewEditFrame = {
  box: Box;
  transform: LayerTransform;
  parent: Matrix2D;
  // The edited box's corners in canvas pixels.
  corners: BoxCorners;
};

export function resolvePreviewEditFrame(
  layer: Pick<PreviewLayer, "placement" | "transform" | "clipTransform">,
  editsClip: boolean,
  canvas: Size,
): PreviewEditFrame {
  const box = frameBoxInCanvas(layer.placement.frame, canvas);
  const parent = editsClip
    ? transformMatrix(layer.transform, box, canvas)
    : IDENTITY_MATRIX;
  const transform = editsClip ? layer.clipTransform : layer.transform;
  return {
    box,
    transform,
    parent,
    corners: layerBoxInCanvas(layer.placement, transform, canvas, parent),
  };
}

// A canvas-pixel move in the space of `parent`'s input, where a nested
// Transform's position and size are measured.
export function toParentDelta(parent: Matrix2D, delta: Point): Point {
  const inverse = invertMatrix({ ...parent, e: 0, f: 0 });
  return inverse
    ? {
        x: inverse.a * delta.x + inverse.c * delta.y,
        y: inverse.b * delta.x + inverse.d * delta.y,
      }
    : delta;
}

// `parent`'s turn on screen, in degrees.
export function matrixRotationDeg(parent: Matrix2D) {
  return (Math.atan2(parent.b, parent.a) * 180) / Math.PI;
}

// The layers the compositor draws at the playhead, in draw order (the last
// one is on top). As in the compositor, only in-bounds layers take a slot,
// and a Grid shows no more layers than it has cells. Without an Order every
// slot is the whole canvas and Layer 1 is drawn last; layers the Order
// excludes cover the whole canvas too, in the same z-order. FX clips take
// no slot: their box starts as the whole canvas, and they come first so a
// click only picks one where no other layer is.
export function resolvePreviewLayers(
  activeClips: readonly StackableLayer[],
  canvas: Size,
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
): PreviewLayer[] {
  const layerDraws = planLayerDraws(
    activeClips.filter((entry) => entry.isInBounds && !entry.fx),
    order,
  ).flatMap((step) => (step.type === "layer" ? [step] : []));
  const fxLayers = orderStackedLayers(
    activeClips.filter((entry) => entry.isInBounds && entry.fx),
    order,
  );

  return [
    ...fxLayers.map((entry) => ({
      entry,
      frame: resolveCanvasBounds(canvas.width, canvas.height),
    })),
    ...layerDraws.map((step) => ({
      entry: step.entry,
      frame: resolveSlotBounds(
        step.slot,
        step.slotCount,
        step.order,
        canvas.width,
        canvas.height,
      ),
    })),
  ].map(({ entry, frame }) => {
    const placement = { frame };
    const transform = entry.visual.transform ?? IDENTITY_TRANSFORM;
    const clipTransform = entry.visual.clipTransform ?? IDENTITY_TRANSFORM;
    return {
      laneId: entry.clip.laneId,
      clipId: entry.clip.id,
      placement,
      transform,
      clipTransform,
      corners: resolvePreviewEditFrame(
        { placement, transform, clipTransform },
        true,
        canvas,
      ).corners,
    };
  });
}

type HitTestLayer = Pick<PreviewLayer, "placement" | "transform"> & {
  clipTransform?: LayerTransform;
};

// Whether `point` is on the layer's clip as drawn: its box after the clip's
// Transform and the layer's.
export function isPointOnLayer(
  point: Point,
  layer: HitTestLayer,
  canvas: Size,
) {
  const local = canvasToLayer(
    point,
    layer.placement,
    layer.clipTransform ?? IDENTITY_TRANSFORM,
    canvas,
    transformMatrix(
      layer.transform,
      frameBoxInCanvas(layer.placement.frame, canvas),
      canvas,
    ),
  );
  const edge = 1 + 1e-9;
  return (
    local !== undefined &&
    Math.abs(local.x) <= edge &&
    Math.abs(local.y) <= edge
  );
}

// The topmost layer whose transformed box holds `point`. `layers` are in
// draw order, so the last one drawn is on top.
export function hitTestLayers<T extends HitTestLayer>(
  layers: readonly T[],
  point: Point,
  canvas: Size,
) {
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

// The Transform a drag edits on stack `trackId` (a layer's, or a clip's as
// `getPreviewEditTrackId` gives it): the stack's last enabled one, which is
// the one the compositor applies, or else its last bypassed one.
export function findLayerTransform(
  effects: readonly SessionEffect[],
  trackId: string,
) {
  const transforms = effects.filter(
    (effect) =>
      effect.trackId === trackId && isTransformEffectName(effect.effectName),
  );
  return (
    transforms.findLast((effect) => effect.enabled !== false) ??
    transforms[transforms.length - 1]
  );
}

export function readLayerTransformPosition(
  effects: readonly SessionEffect[],
  trackId: string,
): Point {
  const transform = findLayerTransform(effects, trackId);
  return {
    x: readNumericParameter(transform, TRANSFORM_POSITION_X_KEY),
    y: readNumericParameter(transform, TRANSFORM_POSITION_Y_KEY),
  };
}

// The full Transform a drag edits, or the identity when the stack has none.
export function readLayerTransform(
  effects: readonly SessionEffect[],
  trackId: string,
): LayerTransform {
  const transform = findLayerTransform(effects, trackId);
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

// Writes the Transform position on stack `trackId` (a layer's or a clip's),
// first adding a Transform with the registry defaults (with `newEffectId`)
// to the end of the stack if it has none. A bypassed Transform is turned back on so the move shows.
// Returns `effects` itself when nothing changed.
export function setLayerTransformPosition(
  effects: SessionEffect[],
  trackId: string,
  position: Point,
  newEffectId: string,
) {
  let result = effects;
  let transform = findLayerTransform(result, trackId);
  if (!transform) {
    result = addEffect(
      result,
      trackId,
      TRANSFORM_EFFECT_NAME,
      undefined,
      newEffectId,
    );
    transform = findLayerTransform(result, trackId);
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

const TRANSFORM_PARAMETER_KEYS: Record<keyof LayerTransform, string> = {
  positionX: TRANSFORM_POSITION_X_KEY,
  positionY: TRANSFORM_POSITION_Y_KEY,
  scaleX: "ScaleX",
  scaleY: "ScaleY",
  originX: "OriginX",
  originY: "OriginY",
  rotationDeg: "Rotation",
};

// Writes the given fields of a stack's Transform, adding or re-enabling it
// as `setLayerTransformPosition` does.
export function setLayerTransformParameters(
  effects: SessionEffect[],
  trackId: string,
  values: Partial<LayerTransform>,
  newEffectId: string,
) {
  let result = effects;
  let transform = findLayerTransform(result, trackId);
  if (!transform) {
    result = addEffect(
      result,
      trackId,
      TRANSFORM_EFFECT_NAME,
      undefined,
      newEffectId,
    );
    transform = findLayerTransform(result, trackId);
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
