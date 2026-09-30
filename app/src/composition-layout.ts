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
  type OrderSlide,
  visibleLayerCount,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import type {
  LayerTransform,
  TransformMotion,
} from "./composition-transform.ts";
import { orderSlideWeight } from "./fx-animation-clip.ts";

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
};

type StackedLayer = {
  laneRank: number;
  clip: { startQ: number; laneId?: string; durationSeconds?: number };
  // How far through its clip the playhead is, 0..1. With the clip's
  // duration it times an animated Order's slides.
  clipProgress?: number;
};

// How an animated Order's layer sits between arrangements while clips
// enter and exit. Its slot is the weighted sum of `slots`, each a slot
// `slot` of `slotCount` of the Order, and it is drawn `slide` of the way
// out of that slot towards the canvas edge it enters from, 0 in place to
// 1 just off the canvas, cropped to the slot.
export type SlotMotion = {
  slots: { slot: number; slotCount: number; weight: number }[];
  slide: number;
};

// One step of drawing the composite: a layer drawn into slot `slot` of
// `slotCount` as `order` arranges them, an FX clip whose chain adjusts what
// has been drawn so far, or an FX clip with an Order that arranges the
// layers beneath it (`steps`) by `order` inside its own box. A layer the
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
 * layer.
 */
export function planLayerDraws<
  T extends StackedLayer & { fx?: boolean; order?: CompositionOrder },
>(
  layers: readonly T[],
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
): LayerDrawStep<T>[] {
  const arranger = layers
    .filter((layer) => layer.fx && layer.order)
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
    layers.filter((layer) => !layer.fx && isArranged(layer)),
    order,
  );
  const stacked = ordered.slice(0, visibleLayerCount(ordered.length, order));
  const motions = order.slide
    ? resolveSlotMotions(stacked, order.slide)
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
  const arrange: LayerDrawStep<T>[] =
    arranger?.order === undefined
      ? []
      : [
          {
            type: "arrange",
            entry: arranger,
            order: arranger.order,
            steps: planLayerDraws(layers.filter(isGoverned), arranger.order),
          },
        ];
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

// Transitions blended at once. Clips entering or exiting at the same moment
// move together, so this is only reached with that many overlapping at
// different moments; any more are drawn settled in their slots.
const MAX_SLOT_TRANSITIONS = 6;

// Weights closer than this move as one transition.
const TRANSITION_EPSILON = 1e-6;

/**
 * Where each of `stacked`, the layers an animated Order arranges in slot
 * order, is while clips enter and exit. Each layer's weight says how far it
 * has slid in: 1 settled in its slot, 0 not yet in or already out, from its
 * clip's position and the Order's timing. A layer that is entering or
 * exiting slides between its slot and the canvas edge, and every other
 * layer's slot is between the arrangement with it and the one without it,
 * by the same weight. Layers moving at once blend every combination of
 * their arrangements. Layers that are all settled have no motion.
 */
export function resolveSlotMotions<T extends StackedLayer>(
  stacked: readonly T[],
  slide: OrderSlide,
): Map<T, SlotMotion> {
  const weights = stacked.map((layer) => {
    const duration = layer.clip.durationSeconds;
    return duration === undefined || layer.clipProgress === undefined
      ? 1
      : orderSlideWeight(slide, layer.clipProgress * duration, duration);
  });
  // Moving layers, grouped by weight, so clips entering or exiting together
  // move as one.
  const groups: { weight: number; members: Set<number> }[] = [];
  weights.forEach((weight, index) => {
    if (weight >= 1) {
      return;
    }
    const group = groups.find(
      (candidate) => Math.abs(candidate.weight - weight) < TRANSITION_EPSILON,
    );
    if (group) {
      group.members.add(index);
    } else if (groups.length < MAX_SLOT_TRANSITIONS) {
      groups.push({ weight, members: new Set([index]) });
    }
  });
  const motions = new Map<T, SlotMotion>();
  if (!groups.length) {
    return motions;
  }

  const groupOf = (index: number) =>
    groups.findIndex((group) => group.members.has(index));
  // The layer's slots over every combination of the other groups being in
  // or out, with `forced` in.
  const blendSlots = (index: number, forced: number) => {
    const slots = new Map<string, SlotMotion["slots"][number]>();
    for (let mask = 0; mask < 1 << groups.length; mask++) {
      if (forced >= 0 && !(mask & (1 << forced))) {
        continue;
      }
      let weight = 1;
      groups.forEach((group, groupIndex) => {
        if (groupIndex !== forced) {
          weight *=
            mask & (1 << groupIndex) ? group.weight : 1 - group.weight;
        }
      });
      if (weight <= 0) {
        continue;
      }
      const present = stacked
        .map((_, other) => other)
        .filter((other) => {
          const group = groupOf(other);
          return group < 0 || Boolean(mask & (1 << group));
        });
      const slot = present.indexOf(index);
      const key = `${slot}/${present.length}`;
      const existing = slots.get(key);
      if (existing) {
        existing.weight += weight;
      } else {
        slots.set(key, { slot, slotCount: present.length, weight });
      }
    }
    return [...slots.values()];
  };

  stacked.forEach((layer, index) => {
    const group = groupOf(index);
    const slots = blendSlots(index, group);
    const settled =
      group < 0 &&
      slots.length === 1 &&
      slots[0].slot === index &&
      slots[0].slotCount === stacked.length;
    if (!settled) {
      motions.set(layer, {
        slots,
        slide: group < 0 ? 0 : 1 - groups[group].weight,
      });
    }
  });
  return motions;
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
// Edges are rounded from the same row positions for neighbouring bands, so
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

// Order spacing is in output pixels at 1080p, so it keeps the same share of
// the frame at any output size.
export function resolveSpacingPixels(
  order: CompositionOrder,
  width: number,
  height: number,
) {
  return (order.spacing * Math.max(0, Math.min(width, height))) / 1080;
}

// Start and end, in pixels, of cell `index` of `cells` equal cells across
// `size`, with `gap` between neighbours and none at either end. Neighbours
// share the expressions for their edges, so with no gap one cell ends
// exactly where the next starts.
function resolveCellEdges(
  index: number,
  cells: number,
  size: number,
  gap: number,
) {
  const normalizedCells = Math.max(1, cells);
  // Gaps never squeeze a cell below one pixel.
  const clampedGap =
    normalizedCells > 1
      ? Math.max(
          0,
          Math.min(gap, (size - normalizedCells) / (normalizedCells - 1)),
        )
      : 0;
  const available = size - clampedGap * (normalizedCells - 1);
  return {
    start: (index * available) / normalizedCells + index * clampedGap,
    end: ((index + 1) * available) / normalizedCells + index * clampedGap,
  };
}

// Slot `index` in canvas pixels (origin top-left). Slots are filled row by
// row, left to right; without an Order every slot is the whole canvas.
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
  const x = resolveCellEdges(index % columns, columns, width, gap);
  const y = resolveCellEdges(Math.floor(index / columns), rows, height, gap);
  return { left: x.start, right: x.end, top: y.start, bottom: y.end };
}

type SlotRect = ReturnType<typeof resolveSlotRect>;

// Slot `index`, or the slot a moving layer is at: the weighted sum of the
// slots it is between.
function resolveMovingSlotRect(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
  motion: SlotMotion | undefined,
): SlotRect {
  if (!motion?.slots.length) {
    return resolveSlotRect(index, count, order, width, height);
  }

  const total =
    motion.slots.reduce((sum, { weight }) => sum + weight, 0) || 1;
  return motion.slots.reduce(
    (rect, { slot, slotCount, weight }) => {
      const share = weight / total;
      const next = resolveSlotRect(slot, slotCount, order, width, height);
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

type CanvasEdge = "left" | "right" | "top" | "bottom";

// The canvas edge a layer slides into `slot` from: the left in a Vertical
// Order, the bottom in a Horizontal one, and in a Grid its cell's nearest
// edge, the left or right before the top or bottom when they tie.
export function resolveSlideEdge(
  slot: SlotRect,
  order: CompositionOrder,
  width: number,
  height: number,
): CanvasEdge {
  if (order.arrangement === "vertical") {
    return "left";
  }
  if (order.arrangement === "horizontal") {
    return "bottom";
  }

  const distances: [CanvasEdge, number][] = [
    ["left", slot.left],
    ["right", width - slot.right],
    ["top", slot.top],
    ["bottom", height - slot.bottom],
  ];
  return distances.reduce((nearest, candidate) =>
    candidate[1] < nearest[1] - TRANSITION_EPSILON ? candidate : nearest,
  )[0];
}

// Where a layer `slide` of the way out of `slot` is drawn: moved towards
// the edge it slides in from, just off the canvas at 1.
function resolveSlideRect(
  slot: SlotRect,
  order: CompositionOrder,
  width: number,
  height: number,
  slide: number,
): SlotRect {
  if (!(slide > 0)) {
    return slot;
  }

  const edge = resolveSlideEdge(slot, order, width, height);
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
// drawn where it has got to, which a slide can take out of its slot.
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
  const slot = resolveSlideRect(
    resolveMovingSlotRect(index, count, order, width, height, motion),
    order,
    width,
    height,
    motion?.slide ?? 0,
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
// neighbouring slots, so without spacing the boxes tile the surface with no
// gap or overlap at any size. A moving layer (`motion`) is cropped to the
// slot it is at, even while it slides into or out of it.
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
  };
}
