// Pure layout math for the preview/export compositor. Every active layer gets
// its own horizontal band of the canvas; the layer's source covers that band
// and the Layout anchor decides which part of an overflowing source shows.
// Positions are in clip space (-1..1, +y up), matching the composite shader.

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
};

export type LayerPlacement = {
  frame: FrameBounds;
  // Half size of the drawn quad, including the layer's own scale.
  halfExtents: HalfExtents;
  translate: { x: number; y: number };
  // Band in framebuffer pixels (origin bottom-left), for gl.scissor.
  scissor: ScissorBox;
};

type StackedLayer = {
  laneRank: number;
  clip: { startQ: number };
};

// Draw order, which is also band order from the top: lanes in timeline order
// (Layer 1 on top), then earlier clips first within a lane.
export function orderStackedLayers<T extends StackedLayer>(layers: T[]) {
  return [...layers].sort((left, right) => {
    if (left.laneRank !== right.laneRank) {
      return left.laneRank - right.laneRank;
    }

    return left.clip.startQ - right.clip.startQ;
  });
}

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
// band to the band's matching edge.
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

export function resolveLayerPlacement(options: {
  index: number;
  count: number;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  visual: LayerVisual;
}): LayerPlacement {
  const { index, count, canvasWidth, canvasHeight, visual } = options;
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  const sourceAspect = options.sourceWidth / Math.max(1, options.sourceHeight);
  const frame = resolveFrameBounds(index, count, canvasAspect);
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
    scissor: resolveBandScissor(index, count, canvasWidth, canvasHeight),
  };
}
