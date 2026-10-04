// How the compositor draws a layer a Mask masks: its Target layer's clips
// are drawn again, where they end up on the surface the masked layer is
// drawn on, into a mask target cleared to transparent, and the masked
// layer's quad is drawn with its alpha multiplied by the alpha there at each
// pixel (by 1 minus it when Subtractive). The Target still draws as usual on
// its own. A masked Target is drawn with its own mask, except inside a
// cycle (A masks B and B masks A), where the layer that closes it is drawn
// unmasked.

import type { LayerDrawStep } from "./composition-layout.ts";
import {
  COMPOSITE_VERTEX_SOURCE,
  MASKED_COMPOSITE_FRAGMENT_SOURCE,
} from "./composition-shaders.ts";
import type { QuadAxes } from "./composition-transform.ts";
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

type Size = { width: number; height: number };

export type MaskSurface = Size & { framebuffer: WebGLFramebuffer | null };

type MaskableLayer = { fx?: boolean; clip: { laneId?: string } };

type LayerStep<T> = LayerDrawStep<T> & { type: "layer" };
type ArrangeStep<T> = LayerDrawStep<T> & { type: "arrange" };

// The steps among `steps` that draw Mask `entry`'s Target layer: the clips
// on it drawn on that surface, in their draw order.
export function findMaskTargetSteps<T extends MaskableLayer>(
  steps: readonly LayerDrawStep<T>[],
  entry: T,
  mask: LayerMask,
) {
  return steps.filter(
    (step): step is LayerStep<T> =>
      step.type === "layer" &&
      step.entry !== entry &&
      !step.entry.fx &&
      step.entry.clip.laneId === mask.targetLaneId,
  );
}

// A surface is the canvas, or reached from it through the FX clips with an
// Order in a path, outermost first, each arranging the layers beneath it. A
// Transition's comps are on the surface its FX clip is on.
export type MaskTargetGroup<T> = {
  path: ArrangeStep<T>[];
  steps: LayerStep<T>[];
};

// Where a masked layer is drawn and where its Target's clips are, on any
// surface: an FX clip's Order can draw one inside its arrangement and the
// other outside it.
export type MaskTargets<T> = {
  maskedPath: ArrangeStep<T>[];
  groups: MaskTargetGroup<T>[];
};

// Finds Mask `mask` of the layer `masked` draws among all of `root`, the
// steps that draw the canvas, and its Target's clips, grouped by surface.
export function findMaskTargets<T extends MaskableLayer>(
  root: readonly LayerDrawStep<T>[],
  masked: LayerStep<T>,
  mask: LayerMask,
): MaskTargets<T> {
  const found: MaskTargets<T> = { maskedPath: [], groups: [] };
  const visit = (
    steps: readonly LayerDrawStep<T>[],
    path: ArrangeStep<T>[],
  ) => {
    const targetSteps = findMaskTargetSteps(steps, masked.entry, mask);
    if (targetSteps.length) {
      found.groups.push({ path, steps: targetSteps });
    }
    for (const step of steps) {
      if (step === masked) {
        found.maskedPath = path;
      } else if (step.type === "arrange") {
        visit(step.steps, [...path, step]);
      } else if (step.type === "transition") {
        // A Transition's comps are drawn whole, the size of the surface
        // it is on.
        visit(step.outgoing, path);
        visit(step.incoming, path);
      }
    }
  };
  visit(root, []);
  return found;
}

// The axes that draw a parent surface's bottom-up picture into the
// arrangement `axes` draw on it, undoing them: a point the arrangement
// draws at a place on the parent samples the parent's picture there.
export function inverseArrangementAxes(axes: QuadAxes): QuadAxes {
  // `axes` draw a bottom-up picture flipped, so its own clip space maps to
  // the parent's by the columns axisX and -axisY.
  const [a, c] = axes.axisX;
  const [b, d] = [-axes.axisY[0], -axes.axisY[1]];
  const determinant = a * d - b * c || 1e-12;
  const inverse = [d, -c, -b, a].map((value) => value / determinant);
  const [ox, oy] = axes.offset;
  return {
    axisX: [inverse[0], inverse[1]],
    axisY: [-inverse[2], -inverse[3]],
    offset: [
      -(inverse[0] * ox + inverse[2] * oy),
      -(inverse[1] * ox + inverse[3] * oy),
    ],
  };
}

// How the compositor draws a mask: `placeArrangement` gives the size of an
// FX clip's arrangement on a parent surface and the axes that draw it
// there, `drawStep` draws a Target clip, masked in turn from `slot` on, and
// `drawHop` draws a picture with axes onto a surface; both bind it first.
export type MaskDrawing<T> = {
  gl: WebGLRenderingContext;
  effectChain: EffectChainRenderer;
  bind: (target: MaskSurface) => void;
  placeArrangement: (
    step: ArrangeStep<T>,
    parent: Size,
  ) => { size: Size; axes: QuadAxes };
  drawStep: (target: MaskSurface, step: LayerStep<T>, slot: number) => void;
  drawHop: (target: MaskSurface, source: TextureRegion, axes: QuadAxes) => void;
};

// Draws Mask `mask`'s Target clips in `targets` into a mask target the size
// of the masked layer's surface, from mask target `slot` on, each where it
// ends up on that surface: drawn on its own surface and carried out of
// the arrangements it is in and into the ones the masked layer is in.
// Returns null when the Target draws nothing, as when it has no active
// clip, which leaves an Additive mask nothing to show and a Subtractive one
// nothing to hide.
export function drawLayerMask<T>(
  drawing: MaskDrawing<T>,
  targets: MaskTargets<T>,
  mask: LayerMask,
  canvas: Size,
  slot = 0,
): DrawnMask | null {
  if (!targets.groups.length) {
    return null;
  }
  const { gl, effectChain } = drawing;
  const sizeOf = (path: ArrangeStep<T>[]) =>
    path.reduce(
      (parent, step) => drawing.placeArrangement(step, parent).size,
      canvas,
    );
  const begin = (size: Size, at: number) => {
    const drawn = effectChain.getMaskTarget(size.width, size.height, at);
    const { width, height } = size;
    const target = { width, height, framebuffer: drawn.framebuffer };
    drawing.bind(target);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { target, region: drawn.region };
  };
  const { maskedPath } = targets;
  const result = begin(sizeOf(maskedPath), slot);
  for (const group of targets.groups) {
    const { path } = group;
    let shared = 0;
    while (
      shared < path.length &&
      shared < maskedPath.length &&
      path[shared] === maskedPath[shared]
    ) {
      shared++;
    }
    // Out of the Target's arrangements, then into the masked layer's.
    const hops: Array<{ size: Size; axes: QuadAxes }> = [];
    for (let index = path.length - 1; index >= shared; index--) {
      const parent = sizeOf(path.slice(0, index));
      const placed = drawing.placeArrangement(path[index], parent);
      hops.push({ size: parent, axes: placed.axes });
    }
    for (let index = shared; index < maskedPath.length; index++) {
      const placed = drawing.placeArrangement(
        maskedPath[index],
        sizeOf(maskedPath.slice(0, index)),
      );
      hops.push({
        size: placed.size,
        axes: inverseArrangementAxes(placed.axes),
      });
    }
    // Two more targets carry it between surfaces; masks the Target's clips
    // draw with use those after them.
    let current = hops.length ? begin(sizeOf(path), slot + 1) : result;
    for (const step of group.steps) {
      drawing.drawStep(current.target, step, slot + 3);
    }
    hops.forEach((hop, index) => {
      const last = index === hops.length - 1;
      const next = last
        ? result
        : begin(hop.size, slot + 1 + ((index + 1) % 2));
      drawing.drawHop(next.target, current.region, hop.axes);
      current = next;
    });
  }
  gl.disable(gl.SCISSOR_TEST);
  return { region: result.region, mode: mask.mode };
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
