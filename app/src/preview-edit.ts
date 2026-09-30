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
  type LayerDrawStep,
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
  applyMatrix,
  type Box,
  type BoxCorners,
  canvasToLayer,
  chainTransformMatrix,
  frameBoxInCanvas,
  IDENTITY_MATRIX,
  IDENTITY_TRANSFORM,
  invertMatrix,
  isTransformEffectName,
  type LayerTransform,
  type Matrix2D,
  matrixBoxCorners,
  multiplyMatrix,
  type Point,
  parseLayerTransform,
  resolveVisualTextBox,
  stackTransformChain,
  TRANSFORM_EFFECT_NAME,
  type TransformedVisual,
  type TransformMotion,
  visualTransformMatrix,
} from "./composition-transform.ts";
import {
  addEffect,
  clipEffectTrackId,
  type SessionEffect,
  setEffectAnimationEnabled,
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
// `object-fit: contain`, centered, then magnified by `zoom` about the center.
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
  clip: {
    id: string;
    laneId: string;
    startQ: number;
    durationSeconds?: number;
  };
  // With the clip's duration, times an animated Order's slides.
  clipProgress?: number;
  laneRank: number;
  isInBounds: boolean;
  visual: TransformedVisual;
  // Set for FX clips, which take no slot and adjust the whole canvas.
  fx?: boolean;
  // Set for FX clips with an Order, which arranges the layers beneath them.
  order?: CompositionOrder;
};

// The box an FX clip with an Order arranges the layers beneath it in, as
// the compositor draws it: the layers are placed on a surface of `canvas`'s
// size, which `matrix` then maps into the composition canvas (moved, resized
// and turned by the FX clip's Transforms).
export type PreviewArrangement = { matrix: Matrix2D; canvas: Size };

// A layer as the preview draws it: its slot, its layer's Transform, its
// clip's own Transform (inside the layer's), their Moves at the playhead,
// and the corners of the clip's transformed box in canvas pixels. The
// compositor crops the layer to its slot, however its Transforms and Moves
// move it. A layer beneath an FX clip with an Order
// has that FX clip's `arrangement`: its slot and Transforms are then measured
// on the arrangement's surface rather than the canvas.
export type PreviewLayer = {
  laneId: string;
  clipId: string;
  placement: { frame: FrameBounds };
  transform: LayerTransform;
  clipTransform: LayerTransform;
  motion?: TransformMotion;
  clipMotion?: TransformMotion;
  arrangement?: PreviewArrangement;
  corners: BoxCorners;
};

// The surface a layer's slot and Transforms are measured on, and the matrix
// that maps it into the canvas.
export function resolveLayerSpace(
  layer: { arrangement?: PreviewArrangement },
  canvas: Size,
): PreviewArrangement {
  return layer.arrangement ?? { matrix: IDENTITY_MATRIX, canvas };
}

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
// matrix that places the result (the layer's Transform, for a clip's, and
// the Moves around the edited Transform, in the arrangement the layer is
// drawn in): the drag maths work in that parent's space, then map back to
// the canvas.
export type PreviewEditFrame = {
  box: Box;
  transform: LayerTransform;
  parent: Matrix2D;
  // The surface the Transform is measured on: the canvas, or the layer's
  // arrangement. `box`, and the Transform's position, are in its pixels.
  canvas: Size;
  // The edited box's corners in canvas pixels, as drawn at the playhead:
  // with the Moves nested inside the edited Transform too.
  corners: BoxCorners;
};

export function resolvePreviewEditFrame(
  layer: Pick<PreviewLayer, "placement" | "transform" | "clipTransform"> &
    Partial<Pick<PreviewLayer, "arrangement" | "motion" | "clipMotion">>,
  editsClip: boolean,
  canvas: Size,
): PreviewEditFrame {
  const space = resolveLayerSpace(layer, canvas);
  const box = frameBoxInCanvas(layer.placement.frame, space.canvas);
  const motion = editsClip ? layer.clipMotion : layer.motion;
  const parent = multiplyMatrix(
    space.matrix,
    chainTransformMatrix(
      [
        ...(editsClip
          ? stackTransformChain(layer.transform, layer.motion)
          : []),
        ...(motion?.outer ?? []),
      ],
      box,
      space.canvas,
    ),
  );
  const transform = editsClip ? layer.clipTransform : layer.transform;
  return {
    box,
    transform,
    parent,
    canvas: space.canvas,
    corners: matrixBoxCorners(
      multiplyMatrix(
        parent,
        chainTransformMatrix(
          [transform, ...(motion?.inner ?? [])],
          box,
          space.canvas,
        ),
      ),
      box,
    ),
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
// slot is the whole canvas and Layer 1 is drawn last. FX clips take no slot:
// their box starts as the whole surface they are drawn on, and they come
// first so a click only picks one where no other layer is. Layers beneath an
// FX clip with an Order take their slots from that Order, inside the FX
// clip's box, and come before the layers above it, which are drawn over
// them. They, and the FX clips beneath it, are measured on that box's own
// surface, which its Transforms move, resize and turn.
// Layers an Order excludes cover its whole box, in z-order with the layers
// it arranges.
export function resolvePreviewLayers(
  activeClips: readonly StackableLayer[],
  canvas: Size,
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
): PreviewLayer[] {
  const inBounds = activeClips.filter((entry) => entry.isInBounds);
  const fxLayers = orderStackedLayers(
    inBounds.filter((entry) => entry.fx),
    order,
  );
  type Placed = {
    entry: StackableLayer;
    frame: FrameBounds;
    arrangement?: PreviewArrangement;
  };
  const placed: Placed[] = [];
  // Each FX clip's box: the whole surface it is drawn on.
  const fxPlaced = new Map<StackableLayer, Placed>();
  const collect = (
    steps: LayerDrawStep<StackableLayer>[],
    arrangement: PreviewArrangement | undefined,
    stackOrder: CompositionOrder,
  ) => {
    const space = resolveLayerSpace({ arrangement }, canvas);
    const layers: typeof placed = [];
    // Arranged layers keep slot order. Once the Order excludes a layer,
    // which is placed by z-order instead, they all keep draw order.
    const byDrawOrder = steps.some(
      (step) => step.type === "layer" && step.order !== stackOrder,
    );
    for (const step of steps) {
      if (step.type === "arrange" || step.type === "fx") {
        fxPlaced.set(step.entry, {
          entry: step.entry,
          frame: resolveCanvasBounds(space.canvas.width, space.canvas.height),
          arrangement,
        });
      }
      if (step.type === "arrange") {
        collect(
          step.steps,
          resolveArrangement(space, step.entry.visual),
          step.order,
        );
      } else if (step.type === "layer") {
        layers[byDrawOrder ? layers.length : step.slot] = {
          entry: step.entry,
          frame: resolveSlotBounds(
            step.slot,
            step.slotCount,
            step.order,
            space.canvas.width,
            space.canvas.height,
            step.motion,
          ),
          arrangement,
        };
      }
    }
    placed.push(...layers.filter(Boolean));
  };
  collect(planLayerDraws(inBounds, order), undefined, order);

  return [
    ...fxLayers.map(
      (entry) =>
        fxPlaced.get(entry) ?? {
          entry,
          frame: resolveCanvasBounds(canvas.width, canvas.height),
          arrangement: undefined,
        },
    ),
    ...placed,
  ].map(({ entry, frame, arrangement }) => {
    const placement = { frame };
    const transform = entry.visual.transform ?? IDENTITY_TRANSFORM;
    const clipTransform = entry.visual.clipTransform ?? IDENTITY_TRANSFORM;
    const { motion, clipMotion } = entry.visual;
    const layer = {
      placement,
      transform,
      clipTransform,
      ...(motion && { motion }),
      ...(clipMotion && { clipMotion }),
      ...(arrangement && { arrangement }),
    };
    return {
      laneId: entry.clip.laneId,
      clipId: entry.clip.id,
      ...layer,
      corners: resolvePreviewEditFrame(layer, true, canvas).corners,
    };
  });
}

// The surface an FX clip with an Order arranges the layers beneath it on,
// inside `parent`, as the compositor draws it: the FX clip's box resized by
// its Transforms' scale, so the layers are arranged in a smaller or larger
// box, which the rest of its Transforms then move and turn into place.
function resolveArrangement(
  parent: PreviewArrangement,
  visual: StackableLayer["visual"],
): PreviewArrangement {
  const placed = resolveVisualTextBox(
    { x: 0, y: 0, width: parent.canvas.width, height: parent.canvas.height },
    parent.canvas,
    visual,
  );
  // The surface's top-left corner is the resized box's.
  const fromSurface = multiplyMatrix(placed.matrix, {
    ...IDENTITY_MATRIX,
    e: placed.box.x,
    f: placed.box.y,
  });
  return {
    matrix: multiplyMatrix(parent.matrix, fromSurface),
    canvas: { width: placed.box.width, height: placed.box.height },
  };
}

type HitTestLayer = Pick<PreviewLayer, "placement" | "transform"> &
  Partial<
    Pick<
      PreviewLayer,
      "clipTransform" | "motion" | "clipMotion" | "arrangement"
    >
  >;

// The corners, in canvas pixels, of the slot the compositor crops `layer`
// to: its untransformed box, on the surface it is drawn on. Without an
// Order that is the whole canvas, or the whole arrangement it is drawn in.
export function resolveSlotCorners(
  layer: Pick<PreviewLayer, "placement"> &
    Partial<Pick<PreviewLayer, "arrangement">>,
  canvas: Size,
): BoxCorners {
  const space = resolveLayerSpace(layer, canvas);
  return matrixBoxCorners(
    space.matrix,
    frameBoxInCanvas(layer.placement.frame, space.canvas),
  );
}

// Whether `point` is inside the slot `layer` is cropped to.
function isPointInSlot(point: Point, layer: HitTestLayer, canvas: Size) {
  const space = resolveLayerSpace(layer, canvas);
  const inverse = invertMatrix(space.matrix);
  if (!inverse) {
    return false;
  }

  const local = applyMatrix(inverse, point);
  const box = frameBoxInCanvas(layer.placement.frame, space.canvas);
  const edge = 1e-6;
  return (
    local.x >= box.x - edge &&
    local.x <= box.x + box.width + edge &&
    local.y >= box.y - edge &&
    local.y <= box.y + box.height + edge
  );
}

// Whether `point` is on the layer's clip as drawn: its box after the clip's
// Transform, the layer's, their Moves, and the arrangement it is drawn in,
// where it shows inside its slot.
export function isPointOnLayer(
  point: Point,
  layer: HitTestLayer,
  canvas: Size,
) {
  if (!isPointInSlot(point, layer, canvas)) {
    return false;
  }

  const space = resolveLayerSpace(layer, canvas);
  const local = canvasToLayer(
    point,
    layer.placement,
    IDENTITY_TRANSFORM,
    space.canvas,
    multiplyMatrix(
      space.matrix,
      visualTransformMatrix(
        frameBoxInCanvas(layer.placement.frame, space.canvas),
        space.canvas,
        layer,
      ),
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
// the center, so a pixel delta divides by the canvas size: for a layer in an
// FX clip's arrangement, the arrangement's (`PreviewEditFrame.canvas`).
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

// Adds a Transform with the registry defaults to the end of stack
// `trackId`. Its Animation starts off, so the layer shows where it was
// dragged to rather than animating in to it from the clip's start.
function addLayerTransform(
  effects: SessionEffect[],
  trackId: string,
  newEffectId: string,
) {
  return setEffectAnimationEnabled(
    addEffect(effects, trackId, TRANSFORM_EFFECT_NAME, undefined, newEffectId),
    newEffectId,
    false,
  );
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
    result = addLayerTransform(result, trackId, newEffectId);
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
    result = addLayerTransform(result, trackId, newEffectId);
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
