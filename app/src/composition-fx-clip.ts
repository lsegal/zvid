// How the compositor applies an FX clip without an Order: its chain runs on
// the composite drawn so far and the result replaces it inside the clip's
// box.

import type {
  CompositeLayer,
  CompositeSurface,
  FrameContext,
  WebGlResources,
} from "./composition-draw.ts";
import { resolveCanvasBounds } from "./composition-layout.ts";
import {
  frameBoxInCanvas,
  isIdentityChain,
  matrixQuadAxes,
  type QuadAxes,
  visualTransformChain,
  visualTransformMatrix,
} from "./composition-transform.ts";
import type { PreparedEffectStep, TextureRegion } from "./fx-shaders/chain.ts";
import { POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";

// Runs an FX clip's chain on the composite drawn so far, `scene`, and writes
// the result back over the clip's box: the whole canvas, or where the
// layer's and the clip's Transforms move it.
export function applyFxClip(
  resources: WebGlResources,
  scene: { framebuffer: WebGLFramebuffer; region: TextureRegion },
  surface: CompositeSurface,
  entry: CompositeLayer,
  steps: PreparedEffectStep[],
  frameContext: FrameContext,
) {
  const { gl, effectChain, fxMask } = resources;
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
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, adjusted.texture);
  gl.uniform1i(fxMask.texture, 0);
  gl.uniform2f(fxMask.uvScale, ...adjusted.uvScale);
  gl.uniform2f(fxMask.uvMax, ...adjusted.uvMax);
  gl.uniform2f(fxMask.axisX, ...axes.axisX);
  gl.uniform2f(fxMask.axisY, ...axes.axisY);
  gl.uniform2f(fxMask.offset, ...axes.offset);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
