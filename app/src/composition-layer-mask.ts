// How the compositor draws a layer a Mask masks: its Target layer's clips
// are drawn again, as they are on the surface both draw on, into a mask
// target cleared to transparent, and the masked layer's quad is drawn with
// its alpha multiplied by the alpha there at each pixel (by 1 minus it when
// Subtractive). The Target still draws as usual on its own, unless its layer
// is hidden, in which case it draws only into the masks that target it.

import type { LayerDrawStep } from "./composition-layout.ts";
import {
  COMPOSITE_VERTEX_SOURCE,
  MASKED_COMPOSITE_FRAGMENT_SOURCE,
} from "./composition-shaders.ts";
import type { LayerMask, MaskMode } from "./fx/effects/mask/mask.ts";
import type { EffectChainRenderer, TextureRegion } from "./fx-shaders/chain.ts";
import { linkProgram } from "./fx-shaders/gl.ts";

export type CompositeUniformLocations = {
  position: number;
  texture: WebGLUniformLocation | null;
  axisX: WebGLUniformLocation | null;
  axisY: WebGLUniformLocation | null;
  offset: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  brightness: WebGLUniformLocation | null;
  contrast: WebGLUniformLocation | null;
  saturation: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvMax: WebGLUniformLocation | null;
};

export function locateCompositeUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): CompositeUniformLocations {
  return {
    position: gl.getAttribLocation(program, "aPosition"),
    texture: gl.getUniformLocation(program, "uTexture"),
    axisX: gl.getUniformLocation(program, "uAxisX"),
    axisY: gl.getUniformLocation(program, "uAxisY"),
    offset: gl.getUniformLocation(program, "uOffset"),
    opacity: gl.getUniformLocation(program, "uOpacity"),
    brightness: gl.getUniformLocation(program, "uBrightness"),
    contrast: gl.getUniformLocation(program, "uContrast"),
    saturation: gl.getUniformLocation(program, "uSaturation"),
    uvScale: gl.getUniformLocation(program, "uUvScale"),
    uvMax: gl.getUniformLocation(program, "uUvMax"),
  };
}

// The layer shader with a mask.
export type MaskedComposite = {
  program: WebGLProgram;
  uniforms: CompositeUniformLocations;
  mask: WebGLUniformLocation | null;
  maskSize: WebGLUniformLocation | null;
  maskUvScale: WebGLUniformLocation | null;
  maskUvMax: WebGLUniformLocation | null;
  maskInvert: WebGLUniformLocation | null;
};

export function createMaskedComposite(
  gl: WebGLRenderingContext,
): MaskedComposite {
  const program = linkProgram(
    gl,
    COMPOSITE_VERTEX_SOURCE,
    MASKED_COMPOSITE_FRAGMENT_SOURCE,
  );
  return {
    program,
    uniforms: locateCompositeUniforms(gl, program),
    mask: gl.getUniformLocation(program, "uMask"),
    maskSize: gl.getUniformLocation(program, "uMaskSize"),
    maskUvScale: gl.getUniformLocation(program, "uMaskUvScale"),
    maskUvMax: gl.getUniformLocation(program, "uMaskUvMax"),
    maskInvert: gl.getUniformLocation(program, "uMaskInvert"),
  };
}

// What a masked layer is drawn with: its Target's drawn alpha, in a
// picture the size of the surface the layer is drawn on.
export type DrawnMask = { region: TextureRegion; mode: MaskMode };

type MaskSurface = {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
};

type MaskableLayer = { fx?: boolean; clip: { laneId?: string } };

// The steps among `steps` that draw Mask `entry`'s Target layer: the clips
// on it drawn on the same surface as `entry`, in their draw order.
export function findMaskTargetSteps<T extends MaskableLayer>(
  steps: readonly LayerDrawStep<T>[],
  entry: T,
  mask: LayerMask,
) {
  return steps.filter(
    (step): step is LayerDrawStep<T> & { type: "layer" } =>
      step.type === "layer" &&
      step.entry !== entry &&
      !step.entry.fx &&
      step.entry.clip.laneId === mask.targetLaneId,
  );
}

// Draws `targetSteps`, a Mask's Target's clips, into a mask target the size
// of `surface` with `drawStep`, after `bind` binds the composite state for
// it. Returns null when the Target draws nothing, as when it has no active
// clip, which leaves an Additive mask nothing to show and a Subtractive one
// nothing to hide.
export function drawLayerMask<S>(
  resources: { gl: WebGLRenderingContext; effectChain: EffectChainRenderer },
  targetSteps: readonly S[],
  mask: LayerMask,
  surface: MaskSurface,
  bind: (target: MaskSurface) => void,
  drawStep: (target: MaskSurface, step: S) => void,
): DrawnMask | null {
  if (!targetSteps.length) {
    return null;
  }
  const { gl, effectChain } = resources;
  const drawn = effectChain.getMaskTarget(surface.width, surface.height);
  const target = { ...surface, framebuffer: drawn.framebuffer };
  bind(target);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const step of targetSteps) {
    drawStep(target, step);
  }
  gl.disable(gl.SCISSOR_TEST);
  return { region: drawn.region, mode: mask.mode };
}

// Draws a layer's quad with `draw`, given the masked shader's uniforms, with
// its alpha multiplied by `mask`'s at each pixel of the `width` × `height`
// surface bound for it, or by 1 minus it when Subtractive.
export function drawMaskedQuad(
  gl: WebGLRenderingContext,
  masked: MaskedComposite,
  mask: DrawnMask,
  width: number,
  height: number,
  draw: (uniforms: CompositeUniformLocations) => void,
) {
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
  gl.useProgram(masked.program);
  gl.enableVertexAttribArray(masked.uniforms.position);
  gl.vertexAttribPointer(masked.uniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, mask.region.texture);
  gl.uniform1i(masked.mask, 1);
  gl.uniform2f(masked.maskSize, width, height);
  gl.uniform2f(masked.maskUvScale, ...mask.region.uvScale);
  gl.uniform2f(masked.maskUvMax, ...mask.region.uvMax);
  gl.uniform1f(masked.maskInvert, mask.mode === "subtractive" ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  draw(masked.uniforms);
  // Unbound, so no later draw into the mask's target reads it.
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
}
