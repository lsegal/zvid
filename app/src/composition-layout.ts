// Pure layout math for the preview/export compositor. Every active layer gets
// its own slot of the canvas: a horizontal band by default, or a column or
// grid cell as the Order effect arranges them. The layer's source covers its
// slot and the Layout anchor decides which part of an overflowing source
// shows. Positions are in clip space (-1..1, +y up), matching the composite
// shader.

import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
} from "./composition-order.ts";
import type { LayerTransform } from "./composition-transform.ts";

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
};

export type LayerPlacement = {
  frame: FrameBounds;
  // Half size of the drawn quad, including the layer's own scale.
  halfExtents: HalfExtents;
  translate: { x: number; y: number };
  // Slot in framebuffer pixels (origin bottom-left), for gl.scissor.
  scissor: ScissorBox;
};

type StackedLayer = {
  laneRank: number;
  clip: { startQ: number };
};

// Draw order, which is also slot order (bands from the top, or cells left to
// right, then down): lanes in timeline order
// (Layer 1 on top), then earlier clips first within a lane.
export function orderStackedLayers<T extends StackedLayer>(layers: T[]) {
  return [...layers].sort((left, right) => {
    if (left.laneRank !== right.laneRank) {
      return left.laneRank - right.laneRank;
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

// The grid of slots `order` arranges `count` layers in.
export function resolveSlotGrid(count: number, order: CompositionOrder) {
  const normalizedCount = Math.max(1, count);
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
// row, left to right.
function resolveSlotRect(
  index: number,
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
) {
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
}): LayerPlacement {
  const { index, count, canvasWidth, canvasHeight, visual } = options;
  const order = options.order ?? DEFAULT_COMPOSITION_ORDER;
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  const sourceAspect = options.sourceWidth / Math.max(1, options.sourceHeight);
  const frame = resolveSlotBounds(
    index,
    count,
    order,
    canvasWidth,
    canvasHeight,
  );
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
    ),
  };
}
