// The GL state and quad drawing the composite draw shares with the
// Transition's (composition-transition-draw.ts).
import type { WebGlResources } from "./composition-draw.ts";
import type { QuadAxes } from "./composition-transform.ts";
import type { TextureRegion } from "./fx-shaders/chain.ts";

export type CompositeUniforms = QuadAxes & {
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

// Restores everything the composite draw depends on. The effect chain and
// render-target setup rebind the program, array buffer, attribute pointer,
// blending, viewport and texture unit, so this runs before every draw
// instead of relying on state left over from initialization. Scissoring is
// left off; each layer draw scissors to its own slot.
export function bindCompositeState(
  resources: WebGlResources,
  framebuffer: WebGLFramebuffer | null,
  width: number,
  height: number,
) {
  const { gl, uniforms } = resources;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, width, height);
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
  gl.useProgram(resources.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer);
  gl.enableVertexAttribArray(uniforms.position);
  gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  // Alpha accumulates as "over" too, so a translucent layer on an opaque
  // border leaves it opaque when an FX clip's arrangement is drawn out.
  gl.blendFuncSeparate(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.disable(gl.SCISSOR_TEST);
  gl.activeTexture(gl.TEXTURE0);
}

export function drawQuad(
  resources: WebGlResources,
  source: TextureRegion,
  values: CompositeUniforms,
) {
  const { gl, uniforms } = resources;
  gl.bindTexture(gl.TEXTURE_2D, source.texture);
  gl.uniform1i(uniforms.texture, 0);
  gl.uniform2f(uniforms.uvScale, ...source.uvScale);
  gl.uniform2f(uniforms.uvMax, ...source.uvMax);
  gl.uniform2f(uniforms.axisX, ...values.axisX);
  gl.uniform2f(uniforms.axisY, ...values.axisY);
  gl.uniform2f(uniforms.offset, ...values.offset);
  gl.uniform1f(uniforms.opacity, values.opacity);
  gl.uniform1f(uniforms.brightness, values.brightness);
  gl.uniform1f(uniforms.contrast, values.contrast);
  gl.uniform1f(uniforms.saturation, values.saturation);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
