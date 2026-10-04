// How the compositor applies an FX clip without an Order: its chain runs on
// the composite drawn so far and the result replaces it inside the clip's
// box. With an Order, it places the clip's arrangement on its parent. With
// a Mask, the result is blended over the composite only where it lets it.

import type {
  CompositeLayer,
  CompositeSurface,
  FrameContext,
  WebGlResources,
} from "./composition-draw.ts";
import { bindCompositeState, drawQuad } from "./composition-draw-gl.ts";
import {
  type DrawnMask,
  drawMaskedQuad,
  locateMaskUniforms,
  type MaskUniformLocations,
  withLayerMask,
} from "./composition-layer-mask.ts";
import { resolveCanvasBounds } from "./composition-layout.ts";
import { fitTextureSize } from "./composition-textures.ts";
import {
  canvasBoxToFrame,
  frameBoxInCanvas,
  isIdentityChain,
  matrixQuadAxes,
  type QuadAxes,
  resolveVisualTextBox,
  visualTransformChain,
  visualTransformMatrix,
} from "./composition-transform.ts";
import {
  FX_MASK_FRAGMENT_SOURCE,
  FX_MASK_VERTEX_SOURCE,
  MASKED_FX_MASK_FRAGMENT_SOURCE,
} from "./composition-shaders.ts";
import type { PreparedEffectStep, TextureRegion } from "./fx-shaders/chain.ts";
import { linkProgram, POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";

// Copies an FX clip's adjusted composite back into its box, or blends it
// there by a Mask (`masked`).
export type FxMaskProgram = {
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  axisX: WebGLUniformLocation | null;
  axisY: WebGLUniformLocation | null;
  offset: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvMax: WebGLUniformLocation | null;
  masked?: MaskUniformLocations;
};

export function createFxMaskProgram(
  gl: WebGLRenderingContext,
  masked = false,
): FxMaskProgram {
  const program = linkProgram(
    gl,
    FX_MASK_VERTEX_SOURCE,
    masked ? MASKED_FX_MASK_FRAGMENT_SOURCE : FX_MASK_FRAGMENT_SOURCE,
  );
  return {
    program,
    texture: gl.getUniformLocation(program, "uTexture"),
    axisX: gl.getUniformLocation(program, "uAxisX"),
    axisY: gl.getUniformLocation(program, "uAxisY"),
    offset: gl.getUniformLocation(program, "uOffset"),
    uvScale: gl.getUniformLocation(program, "uUvScale"),
    uvMax: gl.getUniformLocation(program, "uUvMax"),
    ...(masked ? { masked: locateMaskUniforms(gl, program) } : {}),
  };
}

// Runs an FX clip's chain on the composite drawn so far, `scene`, and writes
// the result back over the clip's box: the whole canvas, or where the
// layer's and the clip's Transforms move it. With `mask`, drawn on
// `scene`'s surface, the result is blended over the composite by it.
export function applyFxClip(
  resources: WebGlResources,
  scene: { framebuffer: WebGLFramebuffer; region: TextureRegion },
  surface: CompositeSurface,
  entry: CompositeLayer,
  steps: PreparedEffectStep[],
  frameContext: FrameContext,
  mask?: DrawnMask,
) {
  const { gl, effectChain } = resources;
  const fxMask = mask ? resources.maskedFxMask : resources.fxMask;
  const { width, height } = surface;
  const source = scene.region;
  const adjusted = effectChain.run(source, width, height, steps, {
    time: frameContext.time,
    clipProgress: entry.clipProgress,
    resolution: [width, height],
    // The scene framebuffer is rendered normally, so it is bottom-up.
    bottomUp: true,
  });
  if (!adjusted || adjusted === source) {
    return;
  }

  const frame = resolveCanvasBounds(width, height);
  const axes: QuadAxes = isIdentityChain(visualTransformChain(entry.visual))
    ? { axisX: [1, 0], axisY: [0, 1], offset: [0, 0] }
    : matrixQuadAxes(
        frame,
        visualTransformMatrix(
          frameBoxInCanvas(frame, surface),
          surface,
          entry.visual,
        ),
        surface,
      );
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
  gl.viewport(0, 0, width, height);
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
  gl.useProgram(fxMask.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer);
  gl.enableVertexAttribArray(POSITION_ATTRIBUTE_LOCATION);
  gl.vertexAttribPointer(POSITION_ATTRIBUTE_LOCATION, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.SCISSOR_TEST);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, adjusted.texture);
  gl.uniform1i(fxMask.texture, 0);
  gl.uniform2f(fxMask.uvScale, ...adjusted.uvScale);
  gl.uniform2f(fxMask.uvMax, ...adjusted.uvMax);
  gl.uniform2f(fxMask.axisX, ...axes.axisX);
  gl.uniform2f(fxMask.axisY, ...axes.axisY);
  gl.uniform2f(fxMask.offset, ...axes.offset);
  if (!mask || !fxMask.masked) {
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return;
  }
  // The masked result, its alpha multiplied by the mask's, is drawn over
  // the composite it was made from: where the composite is opaque, that is
  // the two mixed by the mask.
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  withLayerMask(gl, fxMask.masked, mask, width, height, () =>
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4),
  );
}

// Draws an FX clip's processed picture, `processed`, with `axes` over the
// unprocessed one already drawn on `target`, where `mask` lets it. A
// `premultiplied` picture is blended as one.
export function drawMaskedFxResult(
  resources: WebGlResources,
  target: CompositeSurface & { framebuffer: WebGLFramebuffer | null },
  processed: TextureRegion,
  axes: QuadAxes,
  mask: DrawnMask,
  premultiplied = false,
) {
  const { gl } = resources;
  const { width, height } = target;
  bindCompositeState(resources, target.framebuffer, width, height);
  if (premultiplied) {
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
  }
  const values = {
    ...axes,
    opacity: 1,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  };
  drawMaskedQuad(
    gl,
    resources.masked,
    mask,
    width,
    height,
    (located) => drawQuad(resources, processed, values, located),
    premultiplied,
  );
}

// The size of FX clip `entry`'s arrangement on `parent`, and the axes that
// draw it there. The box takes the Transforms' scale, so the layers are
// arranged in a smaller or larger box rather than squeezed or stretched.
// The arrangement is bottom-up, unlike the top-row-first layer textures the
// composite shader expects, so it is drawn flipped.
export function placeArrangement(
  gl: WebGLRenderingContext,
  entry: CompositeLayer,
  parent: { width: number; height: number },
) {
  const parentSurface = { width: parent.width, height: parent.height };
  const placed = resolveVisualTextBox(
    { x: 0, y: 0, width: parent.width, height: parent.height },
    parentSurface,
    entry.visual,
  );
  const axes = matrixQuadAxes(
    canvasBoxToFrame(placed.box, parentSurface),
    placed.matrix,
    parentSurface,
  );
  return {
    size: fitTextureSize(gl, placed.box.width, placed.box.height),
    axes: {
      axisX: axes.axisX,
      axisY: [-axes.axisY[0], -axes.axisY[1]],
      offset: axes.offset,
    } satisfies QuadAxes,
  };
}
