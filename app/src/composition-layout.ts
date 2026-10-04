// Pure layout math for the preview/export compositor. With an Order effect
// every active layer gets its own slot of the canvas: a horizontal band, a
// column or a grid cell as the Order arranges them. Without one every layer's
// slot is the whole canvas and the layers overlap. The layer's source covers
// its slot and the Layout anchor decides which part of an overflowing source
// shows. Everything a layer draws, Transforms included, is cropped to its
// slot. Positions are in clip space (-1..1, +y up), matching the composite
// shader.

import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  isLayerArranged,
  visibleLayerCount,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import { resolveSlotMotions } from "./composition-slot-motions.ts";
import {
  isSquishOrder,
  resolveSquishRect,
  type SlotCollapse,
  type SlotEntry,
  type SlotRect,
} from "./composition-squish.ts";
import type {
  LayerTransform,
  TransformMotion,
} from "./composition-transform.ts";
import type { SessionEdges } from "./fx-animation-clip.ts";

export type LayoutAnchor = "top" | "center" | "bottom";

export type FrameBounds = {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  aspect: number;
};

export type HalfExtents = { x: number; y: number };

export type ScissorBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayerVisual = {
  scale: number;
  translateX: number;
  translateY: number;
  layoutAnchor: LayoutAnchor;
  // Applied after Layout, to the slot as a whole. Absent means identity.
  transform?: LayerTransform;
  // A clip's own Transform, applied inside `transform`. Absent means
  // identity.
  clipTransform?: LayerTransform;
  // The layer's and the clip's Moves at the playhead, nested with their
  // stack's Transform. Absent means none.
  motion?: TransformMotion;
  clipMotion?: TransformMotion;
};

export type LayerPlacement = {
  frame: FrameBounds;
  // Half size of the drawn quad, including the layer's own scale.
  halfExtents: HalfExtents;
  translate: { x: number; y: number };
  // Slot in framebuffer pixels (origin bottom-left), for gl.scissor: the
  // layer is cropped to it, transformed or not.
  scissor: ScissorBox;
  // What the layer's opacity is multiplied by while it fades in or out of
  // an animated Order (`resolveSlotOpacity`).
  opacity: number;
};

export type StackedLayer = {
  laneRank: number;
  clip: {
    // Absent in tests that never need it.
    id?: string;
    startQ: number;
    laneId?: string;
    durationSeconds?: number;
    // Set when this is one piece of a layer clip (see render-clips.ts): the
    // whole clip's duration, which its slides are timed over.
    layerClipDurationSeconds?: number;
    // Set when the clip's layer is hidden: it is drawn only into the mask
    // of a layer whose Mask targets it.
    hidden?: boolean;
  };
  // How far through its clip the playhead is, 0..1. With the clip's
  // duration it times an animated Order's slides.
  clipProgress?: number;
  // The clip's ends on the session's, which it doesn't slide in or out at.
  sessionEdges?: SessionEdges;
  // Set for a clip drawn only for a Transition beneath which it is not
  // active, held on its last or first frame (see composition-clip-timing.ts).
  held?: boolean;
};

// The clips a Transition FX clip blends between, by id: those beneath it at
// its start (comp A) and at its end (comp B).
export type TransitionComps = {
  outgoing: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
};

// How an animated Order's layer sits between arrangements while clips
// enter and exit. Its slot is the weighted sum of `slots`, each a slot
// `slot` of `slotCount` of the Order, and it is `slide` of the way out of
// it, 0 in place. An entering or exiting layer is cropped to the gap the
// others leave for it, collapsed that far towards `collapse` (see
// composition-squish.ts), 1 zero wide or high, from its `entry` side. With
// Squish its content fills that gap. With Push it is drawn that far towards
// its `entry` edge, 1 just off the canvas, or from the middle it stays in
// its slot and fades out that far.
export type SlotMotion = {
  slots: {
    slot: number;
    slotCount: number;
    weight: number;
    collapse?: SlotCollapse;
  }[];
  slide: number;
  entry?: SlotEntry;
};

// One step of drawing the composite: a layer drawn into slot `slot` of
// `slotCount` as `order` arranges them, an FX clip whose chain adjusts what
// has been drawn so far, or an FX clip with an Order that arranges the
// layers beneath it (`steps`) by `order` inside its own box, or an FX clip
// with a Transition that blends from the layers beneath it at its start
// (`outgoing`) to those at its end (`incoming`), each arranged by `order`
// as one comp. A layer the
// Order leaves out is drawn with the z-order overlay, into the whole
// canvas. While an animated Order's clips enter or exit, `motion` says
// where the layer is on its way.
export type LayerDrawStep<T> =
  | {
      type: "layer";
      entry: T;
      slot: number;
      slotCount: number;
      order: CompositionOrder;
      motion?: SlotMotion;
    }
  | { type: "fx"; entry: T }
  | {
      type: "arrange";
      entry: T;
      order: CompositionOrder;
      steps: LayerDrawStep<T>[];
    }
  | {
      type: "transition";
      entry: T;
      order: CompositionOrder;
      outgoing: LayerDrawStep<T>[];
      incoming: LayerDrawStep<T>[];
    };

/**
 * The steps that draw `layers`, back to front. Layers the Order arranges
 * take slots as `orderStackedLayers` orders them, and a Grid shows no more
 * layers than it has cells. Layers it excludes take no slot and cover the
 * whole canvas. FX clips (`fx` set) take no slot: each is applied once
 * every higher-numbered layer beneath it is drawn and before the layers
 * above it. Without an Order that is the usual draw order; with one, layers
 * are drawn from the highest-numbered up while an excluded layer or an FX
 * clip is present, so they stack by z-order around the arranged layers.
 * Among arranged layers that changes nothing, since each is cropped to its
 * own slot.
 *
 * The topmost FX clip with an Order of its own (`order` set) governs every
 * layer beneath it: they are planned again by its Order, as an "arrange"
 * step drawn first, under everything above it. Layers above it keep the
 * slots they have without it: the slots are counted over every arranged
 * layer but those held for a Transition.
 *
 * An FX clip with a Transition (`transition` set) governs the layers
 * beneath it the same way, if it is above any FX clip with an Order: they
 * are planned as two comps, each arranged by the clip's Order or `order`,
 * in a "transition" step. A layer whose clip is in neither comp started
 * after the Transition did, so it is coming in with comp B.
 *
 * Clips on a hidden layer are left out, as if they weren't there: they take
 * no slot and FX clips on it change nothing (see planHiddenLayerDraws).
 */
export function planLayerDraws<
  T extends StackedLayer & {
    fx?: boolean;
    order?: CompositionOrder;
    transition?: TransitionComps;
  },
>(
  allLayers: readonly T[],
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
): LayerDrawStep<T>[] {
  const layers = allLayers.filter((layer) => !layer.clip.hidden);
  const arranger = layers
    .filter((layer) => layer.fx && (layer.order || layer.transition))
    .reduce<T | undefined>(
      (top, layer) =>
        top === undefined || layer.laneRank < top.laneRank ? layer : top,
      undefined,
    );
  const isGoverned = (layer: T) =>
    arranger !== undefined && layer.laneRank > arranger.laneRank;
  const isArranged = (layer: T) =>
    order.arrangement === "none" ||
    layer.clip.laneId === undefined ||
    isLayerArranged(order, layer.clip.laneId);
  const ordered = orderStackedLayers(
    layers.filter(
      (layer) =>
        !layer.fx && isArranged(layer) && !(layer.held && isGoverned(layer)),
    ),
    order,
  );
  const stacked = ordered.slice(0, visibleLayerCount(ordered.length, order));
  const motions = order.slide
    ? resolveSlotMotions(stacked, order.slide, order)
    : undefined;
  const draws = stacked
    .map<LayerDrawStep<T> & { type: "layer" }>((entry, slot) => {
      const motion = motions?.get(entry);
      return {
        type: "layer",
        entry,
        slot,
        slotCount: stacked.length,
        order,
        ...(motion ? { motion } : {}),
      };
    })
    .filter((draw) => !isGoverned(draw.entry));
  const excluded = orderStackedLayers(
    layers.filter(
      (layer) => !layer.fx && !isArranged(layer) && !isGoverned(layer),
    ),
    Z_ORDER_COMPOSITION,
  ).map<LayerDrawStep<T> & { type: "layer" }>((entry) => ({
    type: "layer",
    entry,
    slot: 0,
    slotCount: 1,
    order: Z_ORDER_COMPOSITION,
  }));
  const arrange: LayerDrawStep<T>[] = !arranger
    ? []
    : arranger.transition
      ? [planTransition(arranger, layers.filter(isGoverned), order)]
      : arranger.order
        ? [
            {
              type: "arrange",
              entry: arranger,
              order: arranger.order,
              steps: planLayerDraws(layers.filter(isGoverned), arranger.order),
            },
          ]
        : [];
  const fxLayers = layers
    .filter((layer) => layer.fx && layer !== arranger && !isGoverned(layer))
    .sort((left, right) => right.laneRank - left.laneRank);
  if (!fxLayers.length && !excluded.length) {
    return [...arrange, ...draws];
  }

  const steps: LayerDrawStep<T>[] = [...arrange];
  let nextFx = 0;
  for (const draw of [...draws, ...excluded].sort(
    (left, right) =>
      right.entry.laneRank - left.entry.laneRank ||
      left.entry.clip.startQ - right.entry.clip.startQ,
  )) {
    while (
      nextFx < fxLayers.length &&
      fxLayers[nextFx].laneRank > draw.entry.laneRank
    ) {
      steps.push({ type: "fx", entry: fxLayers[nextFx++] });
    }
    steps.push(draw);
  }
  for (const entry of fxLayers.slice(nextFx)) {
    steps.push({ type: "fx", entry });
  }
  return steps;
}

// The steps that would draw the clips on hidden layers among `layers`, for a
// Mask that targets one: each covers the whole surface, as a layer the Order
// excludes does, since a hidden layer takes no slot. FX clips draw nothing,
// so they have none.
export function planHiddenLayerDraws<T extends StackedLayer & { fx?: boolean }>(
  layers: readonly T[],
): (LayerDrawStep<T> & { type: "layer" })[] {
  return orderStackedLayers(
    layers.filter((layer) => layer.clip.hidden && !layer.fx),
    Z_ORDER_COMPOSITION,
  ).map((entry) => ({
    type: "layer",
    entry,
    slot: 0,
    slotCount: 1,
    order: Z_ORDER_COMPOSITION,
  }));
}

// The "transition" step of `entry`, whose comps are made of `governed`, the
// layers beneath it, each arranged by the clip's own Order or `order`.
function planTransition<
  T extends StackedLayer & {
    fx?: boolean;
    order?: CompositionOrder;
    transition?: TransitionComps;
  },
>(entry: T, governed: readonly T[], order: CompositionOrder): LayerDrawStep<T> {
  const comps = entry.transition as TransitionComps;
  const outgoing = (layer: T) =>
    layer.clip.id !== undefined && comps.outgoing.has(layer.clip.id);
  const incoming = (layer: T) =>
    !outgoing(layer) ||
    (layer.clip.id !== undefined && comps.incoming.has(layer.clip.id));
  const compOrder = entry.order ?? order;
  return {
    type: "transition",
    entry,
    order: compOrder,
    outgoing: planLayerDraws(governed.filter(outgoing), compOrder),
    incoming: planLayerDraws(governed.filter(incoming), compOrder),
  };
}

// The whole canvas as clip-space bounds: the box an FX clip adjusts before
// its Transforms move it.
export function resolveCanvasBounds(
  canvasWidth: number,
  canvasHeight: number,
): FrameBounds {
  return {
    centerX: 0,
    centerY: 0,
    halfWidth: 1,
    halfHeight: 1,
    aspect: Math.max(1, canvasWidth) / Math.max(1, canvasHeight),
  };
}

// Draw order, back to front, then earlier clips first within a lane. With an
// Order arrangement this is also slot order (bands from the top, or cells
// left to right, then down): lanes in timeline order, Layer 1 in the first
// slot. Without one the layers overlap, so the highest-numbered layer is
// drawn first and Layer 1 last, on top.
export function orderStackedLayers<T extends StackedLayer>(
  layers: T[],
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
) {
  const laneDirection = order.arrangement === "none" ? -1 : 1;
  return [...layers].sort((left, right) => {
    if (left.laneRank !== right.laneRank) {
      return (left.laneRank - right.laneRank) * laneDirection;
    }

    return left.clip.startQ - right.clip.startQ;
  });
}

// The Vertical arrangement with no spacing: `slotCount` equal full-width
// bands, top to bottom.
export function resolveFrameBounds(
  index: number,
  slotCount: number,
  canvasAspect: number,
): FrameBounds {
  const normalizedSlotCount = Math.max(1, slotCount);
  const slotHeight = 2 / normalizedSlotCount;
  const halfHeight = slotHeight / 2;

  return {
    centerX: 0,
    centerY: 1 - slotHeight * (index + 0.5),
    halfWidth: 1,
    halfHeight,
    aspect: canvasAspect * normalizedSlotCount,
  };
}

// Half extents that make a source of `sourceAspect` cover `frame` without
// distortion. `canvasAspect` converts between x and y clip-space units.
export function resolveCoverHalfExtents(
  frame: FrameBounds,
  sourceAspect: number,
  canvasAspect: number,
): HalfExtents {
  if (sourceAspect > frame.aspect) {
    return {
      x: (frame.halfHeight * sourceAspect) / Math.max(canvasAspect, 0.0001),
      y: frame.halfHeight,
    };
  }

  return {
    x: frame.halfWidth,
    y: (frame.halfWidth * canvasAspect) / Math.max(sourceAspect, 0.0001),
  };
}

// Vertical shift that pins the top or bottom edge of a source taller than its
// slot to the slot's matching edge.
export function resolveAnchorOffsetY(
  frame: FrameBounds,
  halfExtentY: number,
  anchor: LayoutAnchor,
) {
  if (anchor === "top") {
    return frame.halfHeight - halfExtentY;
  }

  if (anchor === "bottom") {
    return halfExtentY - frame.halfHeight;
  }

  return 0;
}

// Band `index` of `count` in whole framebuffer pixels (origin bottom-left).
// Edges are rounded from the same row positions for neighboring bands, so
// the boxes tile the surface with no gap or overlap at any size.
export function resolveBandScissor(
  index: number,
  count: number,
  width: number,
  height: number,
): ScissorBox {
  const normalizedCount = Math.max(1, count);
  const topRow = Math.round((index * height) / normalizedCount);
  const bottomRow = Math.round(((index + 1) * height) / normalizedCount);

  return {
    x: 0,
    y: height - bottomRow,
    width: Math.max(1, width),
    height: Math.max(1, bottomRow - topRow),
  };
}

// The grid of slots `order` arranges `count` layers in. Without an Order
// there is one slot, the whole canvas, which every layer shares.
export function resolveSlotGrid(count: number, order: CompositionOrder) {
  const normalizedCount = Math.max(1, count);
  if (order.arrangement === "none") {
    return { columns: 1, rows: 1 };
  }

  if (order.arrangement === "horizontal") {
    return { columns: normalizedCount, rows: 1 };
  }

  if (order.arrangement === "grid") {
    return { columns: order.gridSize, rows: order.gridSize };
  }

  return { columns: 1, rows: normalizedCount };
}

// Order spacing and margin are in output pixels at 1080p, so they keep the
// same share of the frame at any output size.
export function resolveSpacingPixels(
  order: CompositionOrder,
  width: number,
  height: number,
  value = order.spacing,
) {
  return (value * Math.max(0, Math.min(width, height))) / 1080;
}

// Start and end, in pixels, of cell `index` of `cells` equal cells across
// `size`, with `gap` between neighbors and `margin` before the first and
// after the last. Neighbors share the expressions for their edges, so with
// no gap one cell ends exactly where the next starts.
function resolveCellEdges(
  index: number,
  cells: number,
  size: number,
  gap: number,
  margin = 0,
) {
  const normalizedCells = Math.max(1, cells);
  // The margin and gaps never squeeze a cell below one pixel.
  const clampedMargin = Math.max(
    0,
    Math.min(margin, (size - normalizedCells) / 2),
  );
  const inner = size - clampedMargin * 2;
  const clampedGap =
    normalizedCells > 1
      ? Math.max(
          0,
          Math.min(gap, (inner - normalizedCells) / (normalizedCells - 1)),
        )
      : 0;
  const available = inner - clampedGap * (normalizedCells - 1);
  return {
    start:
      clampedMargin +
      (index * available) / normalizedCells +
      index * clampedGap,
    end:
      clampedMargin +
      ((index + 1) * available) / normalizedCells +
      index * clampedGap,
  };
}

// Slot `index` in canvas pixels (origin top-left). Slots are filled row by
// row, left to right; without an Order every slot is the whole canvas. An
// Order's margin insets them from the canvas edges, independently of the
// spacing between them.
function resolveSlotRect(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
) {
  if (order.arrangement === "none") {
    return { left: 0, right: width, top: 0, bottom: height };
  }

  const { columns, rows } = resolveSlotGrid(count, order);
  const gap = resolveSpacingPixels(order, width, height);
  const margin = resolveSpacingPixels(order, width, height, order.margin ?? 0);
  const x = resolveCellEdges(index % columns, columns, width, gap, margin);
  const y = resolveCellEdges(
    Math.floor(index / columns),
    rows,
    height,
    gap,
    margin,
  );
  return { left: x.start, right: x.end, top: y.start, bottom: y.end };
}

// Slot `index`, or the slot a moving layer is at: the weighted sum of the
// slots it is between. An entering or exiting layer is at each of them
// collapsed into the gap the others leave it, unless `collapsed` is false.
function resolveMovingSlotRect(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
  motion?: SlotMotion,
  collapsed = true,
): SlotRect {
  if (!motion?.slots.length) {
    return resolveSlotRect(index, count, order, width, height);
  }

  // A moving layer's slot is asked for several times a frame (its scissor,
  // bounds and placement), and a squishing one blends its neighbors' slots,
  // so it is worked out once per motion, which is planned anew each frame.
  // It depends only on the motion's own slots, not on `index` of `count`.
  const key = `${width}x${height}/${collapsed}`;
  const cached = movingSlotRects.get(motion);
  if (cached?.order === order && cached.rects.has(key)) {
    return cached.rects.get(key) as SlotRect;
  }
  const rect = blendMovingSlotRect(order, width, height, motion, collapsed);
  if (cached?.order === order) {
    cached.rects.set(key, rect);
  } else {
    movingSlotRects.set(motion, { order, rects: new Map([[key, rect]]) });
  }
  return rect;
}

const movingSlotRects = new WeakMap<
  SlotMotion,
  { order: CompositionOrder; rects: Map<string, SlotRect> }
>();

function blendMovingSlotRect(
  order: CompositionOrder,
  width: number,
  height: number,
  motion: SlotMotion,
  collapsed: boolean,
): SlotRect {
  const total = motion.slots.reduce((sum, { weight }) => sum + weight, 0) || 1;
  const squish = collapsed && motion.slide > 0;
  const slotRect = (slot: number, slotCount: number) =>
    resolveSlotRect(slot, slotCount, order, width, height);
  return motion.slots.reduce(
    (rect, { slot, slotCount, weight, collapse }) => {
      const share = weight / total;
      const settled = slotRect(slot, slotCount);
      const next = squish
        ? resolveSquishRect(
            settled,
            motion.entry,
            collapse,
            order,
            width,
            height,
            slotRect,
            1 - motion.slide,
          )
        : settled;
      return {
        left: rect.left + next.left * share,
        right: rect.right + next.right * share,
        top: rect.top + next.top * share,
        bottom: rect.bottom + next.bottom * share,
      };
    },
    { left: 0, right: 0, top: 0, bottom: 0 },
  );
}

// Where a layer `slide` of the way out of `slot` is drawn: moved towards
// the canvas `edge` it slides in from, just off the canvas at 1. From the
// middle it stays in its slot.
function resolveSlideRect(
  slot: SlotRect,
  edge: SlotEntry | undefined,
  width: number,
  height: number,
  slide: number,
): SlotRect {
  if (!(slide > 0)) {
    return slot;
  }

  const dx =
    edge === "left" ? -slot.right : edge === "right" ? width - slot.left : 0;
  const dy =
    edge === "top" ? -slot.bottom : edge === "bottom" ? height - slot.top : 0;
  return {
    left: slot.left + dx * slide,
    right: slot.right + dx * slide,
    top: slot.top + dy * slide,
    bottom: slot.bottom + dy * slide,
  };
}

// The box slot `index` draws its layer in. A moving layer (`motion`) is
// drawn where it has got to, which a Push can take out of its slot.
export function resolveSlotBounds(
  index: number,
  count: number,
  order: CompositionOrder,
  canvasWidth: number,
  canvasHeight: number,
  motion?: SlotMotion,
): FrameBounds {
  const width = Math.max(1, canvasWidth);
  const height = Math.max(1, canvasHeight);
  const squish = isSquishOrder(order);
  const slot = resolveSlideRect(
    resolveMovingSlotRect(index, count, order, width, height, motion, squish),
    motion?.entry,
    width,
    height,
    squish ? 0 : (motion?.slide ?? 0),
  );
  return {
    centerX: (slot.left + slot.right) / width - 1,
    centerY: 1 - (slot.top + slot.bottom) / height,
    halfWidth: (slot.right - slot.left) / width,
    halfHeight: (slot.bottom - slot.top) / height,
    aspect: (slot.right - slot.left) / Math.max(slot.bottom - slot.top, 0.0001),
  };
}

// Slot `index` in whole framebuffer pixels (origin bottom-left). Like
// `resolveBandScissor`, edges are rounded from the same positions for
// neighboring slots, so without spacing the boxes tile the surface with no
// gap or overlap at any size. A moving layer (`motion`) is cropped to the
// slot it is at, and one entering or exiting to the gap the others leave
// it, even while it slides into or out of it.
export function resolveSlotScissor(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
  motion?: SlotMotion,
): ScissorBox {
  const slot = resolveMovingSlotRect(
    index,
    count,
    order,
    width,
    height,
    motion,
  );
  const left = Math.round(slot.left);
  const right = Math.round(slot.right);
  const top = Math.round(slot.top);
  const bottom = Math.round(slot.bottom);
  return {
    x: left,
    y: height - bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

// Whether slot `index` covers no whole pixel, rounded as its scissor is: a
// clip squished to zero width or height, which is drawn nowhere rather
// than into the 1 px its scissor keeps for its framed texture.
export function isSlotScissorEmpty(
  ...slot: Parameters<typeof resolveMovingSlotRect>
) {
  const { left, right, top, bottom } = resolveMovingSlotRect(...slot);
  const round = Math.round;
  return round(right) <= round(left) || round(bottom) <= round(top);
}

// How opaque a layer is drawn where `motion` has it: a Push entering or
// exiting between others fades in and out, and everything else is opaque.
export function resolveSlotOpacity(
  order: CompositionOrder,
  motion?: SlotMotion,
) {
  return motion?.entry === "middle" && !isSquishOrder(order)
    ? 1 - motion.slide
    : 1;
}

export function resolveLayerPlacement(options: {
  index: number;
  count: number;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  visual: LayerVisual;
  // Absent means stacked bands with no spacing.
  order?: CompositionOrder;
  // The box the layer fills, when it isn't its slot: a text layer's box,
  // which its Transform resizes.
  frame?: FrameBounds;
  // Where an animated Order's layer is on its way between slots.
  motion?: SlotMotion;
}): LayerPlacement {
  const { index, count, canvasWidth, canvasHeight, visual, motion } = options;
  const order = options.order ?? DEFAULT_COMPOSITION_ORDER;
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  const sourceAspect = options.sourceWidth / Math.max(1, options.sourceHeight);
  const frame =
    options.frame ??
    resolveSlotBounds(index, count, order, canvasWidth, canvasHeight, motion);
  const cover = resolveCoverHalfExtents(frame, sourceAspect, canvasAspect);
  const layoutScale = Math.max(1, visual.scale);
  const halfExtents = { x: cover.x * layoutScale, y: cover.y * layoutScale };
  const anchorOffsetY = resolveAnchorOffsetY(
    frame,
    halfExtents.y,
    visual.layoutAnchor,
  );

  return {
    frame,
    halfExtents,
    translate: {
      x: frame.centerX + visual.translateX * frame.halfWidth,
      y: frame.centerY + anchorOffsetY + visual.translateY * frame.halfHeight,
    },
    scissor: resolveSlotScissor(
      index,
      count,
      order,
      canvasWidth,
      canvasHeight,
      motion,
    ),
    opacity: resolveSlotOpacity(order, motion),
  };
}
