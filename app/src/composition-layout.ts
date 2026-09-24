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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

// Draw order, which is also band order from the top: the highest lane first,
// then earlier clips first within a lane.
export function orderStackedLayers<T extends StackedLayer>(layers: T[]) {
  return [...layers].sort((left, right) => {
    if (right.laneRank !== left.laneRank) {
      return right.laneRank - left.laneRank;
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

export function resolveFrameScissor(
  frame: FrameBounds,
  width: number,
  height: number,
): ScissorBox {
  const minX = clamp(
    Math.floor(((frame.centerX - frame.halfWidth + 1) * width) / 2),
    0,
    width,
  );
  const maxX = clamp(
    Math.ceil(((frame.centerX + frame.halfWidth + 1) * width) / 2),
    0,
    width,
  );
  const minY = clamp(
    Math.floor(((frame.centerY - frame.halfHeight + 1) * height) / 2),
    0,
    height,
  );
  const maxY = clamp(
    Math.ceil(((frame.centerY + frame.halfHeight + 1) * height) / 2),
    0,
    height,
  );

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
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
    scissor: resolveFrameScissor(frame, canvasWidth, canvasHeight),
  };
}
