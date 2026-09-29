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
  visibleLayerCount,
} from "./composition-order.ts";
import type {
  LayerTransform,
  TransformMotion,
} from "./composition-transform.ts";

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
  clip: { startQ: number };
};

// One step of drawing the composite: a layer drawn into slot `slot` of
// `slotCount`, an FX clip whose chain adjusts what has been drawn so far, or
// an FX clip with an Order that arranges the layers beneath it (`steps`) by
// `order` inside its own box.
export type LayerDrawStep<T> =
  | { type: "layer"; entry: T; slot: number; slotCount: number }
  | { type: "fx"; entry: T }
  | {
      type: "arrange";
      entry: T;
      order: CompositionOrder;
      steps: LayerDrawStep<T>[];
    };

/**
 * The steps that draw `layers`, back to front. Layers take slots as
 * `orderStackedLayers` orders them, and a Grid shows no more layers than it
 * has cells. FX clips (`fx` set) take no slot: each is applied once every
 * higher-numbered layer beneath it is drawn and before the layers above it.
 * Without an Order that is the usual draw order; with one, layers are drawn
 * from the highest-numbered up while an FX clip is present, which changes
 * nothing since each layer is cropped to its own slot.
 *
 * The topmost FX clip with an Order of its own (`order` set) governs every
 * layer beneath it: they are planned again by its Order, as an "arrange"
 * step drawn first, under everything above it. Layers above it keep the
 * slots they have without it: the slots are counted over every layer.
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
  const ordered = orderStackedLayers(
    layers.filter((layer) => !layer.fx),
    order,
  );
  const stacked = ordered.slice(0, visibleLayerCount(ordered.length, order));
  const draws = stacked
    .map<LayerDrawStep<T> & { type: "layer" }>((entry, slot) => ({
      type: "layer",
      entry,
      slot,
      slotCount: stacked.length,
    }))
    .filter((draw) => !isGoverned(draw.entry));
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
  if (!fxLayers.length) {
    return [...arrange, ...draws];
  }

  const steps: LayerDrawStep<T>[] = [...arrange];
  let nextFx = 0;
  for (const draw of [...draws].sort(
    (left, right) => right.entry.laneRank - left.entry.laneRank,
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

export function resolveSlotBounds(
  index: number,
  count: number,
  order: CompositionOrder,
  canvasWidth: number,
  canvasHeight: number,
): FrameBounds {
  const width = Math.max(1, canvasWidth);
  const height = Math.max(1, canvasHeight);
  const slot = resolveSlotRect(index, count, order, width, height);
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
// gap or overlap at any size.
export function resolveSlotScissor(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
): ScissorBox {
  const slot = resolveSlotRect(index, count, order, width, height);
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
}): LayerPlacement {
  const { index, count, canvasWidth, canvasHeight, visual } = options;
  const order = options.order ?? DEFAULT_COMPOSITION_ORDER;
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  const sourceAspect = options.sourceWidth / Math.max(1, options.sourceHeight);
  const frame =
    options.frame ??
    resolveSlotBounds(index, count, order, canvasWidth, canvasHeight);
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
    scissor: resolveSlotScissor(index, count, order, canvasWidth, canvasHeight),
  };
}
