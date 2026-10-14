// How big a transformed layer is framed and rasterized: at the size its
// Transforms draw it, not its whole slot, so hundreds of small animated
// clips, such as a grid of dots, each cost their own pixels and passes
// rather than a full frame's.
import type { CompositeVisual, WebGlResources } from "./composition-draw.ts";
import { bindCompositeState, drawQuad } from "./composition-draw-gl.ts";
import type {
  FrameBounds,
  LayerPlacement,
  ScissorBox,
} from "./composition-layout.ts";
import { fitTextureSize } from "./composition-textures.ts";
import {
  type CanvasSize,
  frameBoxInCanvas,
  isIdentityChain,
  type Matrix2D,
  quadAxes,
  type TransformedVisual,
  visualTransformChain,
  visualTransformMatrix,
} from "./composition-transform.ts";
import type { TextureRegion } from "./fx-shaders/chain.ts";

// How much `matrix` shrinks what it places: the longer of its axes'
// lengths, up to 1, so neither side of a picture drawn at that scale is
// stretched when it is placed.
export function transformShrink(matrix: Matrix2D) {
  return Math.min(
    1,
    Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)),
  );
}

// `size` scaled by `shrink`, in whole pixels.
export function shrunkSize<T extends { width: number; height: number }>(
  size: T,
  shrink: number,
) {
  return shrink < 1
    ? {
        width: Math.max(1, Math.ceil(size.width * shrink)),
        height: Math.max(1, Math.ceil(size.height * shrink)),
      }
    : size;
}

// How much `visual`'s Transforms shrink a layer framed in `frame`.
export function visualShrink(
  frame: FrameBounds,
  canvas: CanvasSize,
  visual: TransformedVisual,
) {
  return isIdentityChain(visualTransformChain(visual))
    ? 1
    : transformShrink(
        visualTransformMatrix(frameBoxInCanvas(frame, canvas), canvas, visual),
      );
}

// The box the layer's source covers, unrotated or around its rotation, in
// clip space. A source covering its slot reaches past it, by as much as a
// portrait picture in a landscape slot.
export function sourceBounds(
  placement: LayerPlacement,
  rotationDeg: number,
): FrameBounds {
  const { frame, halfExtents, translate } = placement;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = cos * halfExtents.x + sin * halfExtents.y;
  const halfHeight = sin * halfExtents.x + cos * halfExtents.y;
  return {
    centerX: translate.x,
    centerY: translate.y,
    halfWidth,
    halfHeight,
    // In pixels, like its slot's.
    aspect:
      (frame.aspect * halfWidth * frame.halfHeight) /
      Math.max(halfHeight * frame.halfWidth, 1e-12),
  };
}

// `placement` with its frame grown to hold its whole source, and how much
// that grows each side. A Transform or Move moves the source, not the crop
// its slot makes of it, so moving it reveals what the slot crops away: the
// layer is framed whole, drawn transformed and only then cropped to its
// slot.
export function frameWholeSource(
  placement: LayerPlacement,
  rotationDeg: number,
) {
  const { frame } = placement;
  const source = sourceBounds(placement, rotationDeg);
  const left = Math.min(
    frame.centerX - frame.halfWidth,
    source.centerX - source.halfWidth,
  );
  const right = Math.max(
    frame.centerX + frame.halfWidth,
    source.centerX + source.halfWidth,
  );
  const bottom = Math.min(
    frame.centerY - frame.halfHeight,
    source.centerY - source.halfHeight,
  );
  const top = Math.max(
    frame.centerY + frame.halfHeight,
    source.centerY + source.halfHeight,
  );
  const halfWidth = (right - left) / 2;
  const halfHeight = (top - bottom) / 2;
  const grow = {
    x: halfWidth / Math.max(frame.halfWidth, 1e-6),
    y: halfHeight / Math.max(frame.halfHeight, 1e-6),
  };
  // Within a rounding error, the slot already holds the whole source.
  if (grow.x < 1 + 1e-6 && grow.y < 1 + 1e-6) {
    return { placement, grow: { x: 1, y: 1 } };
  }
  return {
    placement: {
      ...placement,
      frame: {
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2,
        halfWidth,
        halfHeight,
        aspect: (frame.aspect * grow.x) / grow.y,
      },
    },
    grow,
  };
}

// The size a layer is framed at, and its pixels per output pixel: its
// slot's `scissor`, grown by `grow` to hold its whole source, at the size
// its Transform draws it (`shrink`), and no larger than a texture can be.
export function wholeSourceFrameSize(
  gl: WebGLRenderingContext,
  scissor: ScissorBox,
  grow: { x: number; y: number },
  shrink: number,
) {
  if (grow.x === 1 && grow.y === 1) {
    return { size: shrunkSize(scissor, shrink), scale: shrink };
  }
  const fitted = fitTextureSize(
    gl,
    scissor.width * grow.x * shrink,
    scissor.height * grow.y * shrink,
  );
  return { size: fitted, scale: fitted.factor * shrink };
}

// Draws the layer's source into a `size` region exactly as it would appear
// in its slot, or a text layer's box (cover, Layout anchor, scale, offset
// and rotation), so the effect chain works on what the slot shows rather
// than on the whole source. Rows are written top row first to match
// uploaded video textures, which is the orientation the effect passes and the composite shader expect.
export function renderLayerFrame(
  resources: WebGlResources,
  texture: TextureRegion,
  placement: LayerPlacement,
  visual: CompositeVisual,
  size: { width: number; height: number },
  opacity: number,
) {
  const { gl, effectChain } = resources;
  const { frame, halfExtents, translate } = placement;
  const target = effectChain.getLayerTarget(size.width, size.height);
  bindCompositeState(resources, target.framebuffer, size.width, size.height);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawQuad(resources, texture, {
    ...quadAxes(
      [halfExtents.x / frame.halfWidth, -halfExtents.y / frame.halfHeight],
      [
        (translate.x - frame.centerX) / frame.halfWidth,
        -(translate.y - frame.centerY) / frame.halfHeight,
      ],
      (-visual.rotationDeg * Math.PI) / 180,
    ),
    opacity,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  });
  return target.region;
}
