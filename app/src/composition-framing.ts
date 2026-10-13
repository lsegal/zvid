// How big a transformed layer is framed and rasterized: at the size its
// Transforms draw it, not its whole slot, so hundreds of small animated
// clips, such as a grid of dots, each cost their own pixels and passes
// rather than a full frame's.
import type { CompositeVisual, WebGlResources } from "./composition-draw.ts";
import { bindCompositeState, drawQuad } from "./composition-draw-gl.ts";
import type { FrameBounds, LayerPlacement } from "./composition-layout.ts";
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

// Whether the layer's source covers exactly its frame, unrotated, so
// framing it would only copy it.
export function fillsFrame(placement: LayerPlacement, rotationDeg: number) {
  const { frame, halfExtents, translate } = placement;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return (
    !rotationDeg &&
    near(halfExtents.x, frame.halfWidth) &&
    near(halfExtents.y, frame.halfHeight) &&
    near(translate.x, frame.centerX) &&
    near(translate.y, frame.centerY)
  );
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
