// Draws an FX clip's Transition (a "transition" step, see
// composition-layout.ts): each comp is drawn whole into its own target,
// over what the canvas shows where nothing is drawn, the type blends them,
// the clip's other effects run on the blend, where its Mask lets them, and
// the result is drawn over the target the step is in.
import { sceneClearColor } from "./composition-clear-color.ts";
import type {
  CompositeLayer,
  FrameContext,
  WebGlResources,
} from "./composition-draw.ts";
import { bindCompositeState, drawQuad } from "./composition-draw-gl.ts";
import { drawMaskedFxResult } from "./composition-fx-clip.ts";
import type { DrawnMask } from "./composition-layer-mask.ts";
import type { LayerDrawStep } from "./composition-layout.ts";
import { quadAxes } from "./composition-transform.ts";
import type { PreparedEffectStep, TextureRegion } from "./fx-shaders/chain.ts";

// The pooled surface a Transition at nesting `depth` draws comp `index` 0
// or 1, or its blend (2), into. They come from the arrangement pools under
// keys below 0, which no arrangement's depth uses.
function compTarget(
  resources: WebGlResources,
  depth: number,
  index: number,
  width: number,
  height: number,
) {
  return resources.effectChain.getArrangementTarget(
    -1 - (depth * 3 + index),
    width,
    height,
  );
}

// A surface a stack of layers is drawn into (see composition-draw.ts).
type StackTarget = {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
  region?: TextureRegion;
};

export function drawTransition(
  resources: WebGlResources,
  step: LayerDrawStep<CompositeLayer> & { type: "transition" },
  parent: StackTarget,
  depth: number,
  drawSteps: (
    steps: LayerDrawStep<CompositeLayer>[],
    target: StackTarget,
    depth: number,
  ) => void,
  fxSteps: PreparedEffectStep[],
  frameContext: FrameContext,
  // The clip's Mask, drawn once the blend is: false when its effects apply
  // nowhere.
  drawMask: () => DrawnMask | false | undefined,
) {
  const { gl, effectChain } = resources;
  const { entry } = step;
  const settings = entry.transition;
  if (!settings) {
    return;
  }

  const { width, height } = parent;
  const [a, b] = [step.outgoing, step.incoming].map((steps, index) => {
    const target = compTarget(resources, depth, index, width, height);
    bindCompositeState(resources, target.framebuffer, width, height);
    // An empty comp is the canvas with nothing on it: a Transition from or
    // to nothing blends from or to that.
    gl.clearColor(...sceneClearColor(step.order));
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSteps(steps, { width, height, ...target }, depth + 1);
    gl.disable(gl.SCISSOR_TEST);
    return target.region;
  });
  const blend = compTarget(resources, depth, 2, width, height);
  resources.transitions.draw(blend.framebuffer, width, height, a, b, settings);

  // The FX clip's other effects run on the blend.
  const mask = drawMask();
  const blended =
    fxSteps.length && mask !== false
      ? (effectChain.run(blend.region, width, height, fxSteps, {
          time: frameContext.time,
          clipProgress: entry.clipProgress,
          resolution: [width, height],
          // The blend is rendered normally, so it is bottom-up.
          bottomUp: true,
        }) ?? blend.region)
      : blend.region;
  bindCompositeState(resources, parent.framebuffer, width, height);
  // The blend is premultiplied, and transparent where a type moved both
  // comps away.
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  // The blend is bottom-up, unlike the top-row-first layer textures the
  // composite shader expects, so it is drawn flipped.
  const axes = quadAxes([1, -1], [0, 0], 0);
  const masked = mask && blended !== blend.region;
  drawQuad(resources, masked ? blend.region : blended, {
    ...axes,
    opacity: 1,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  });
  if (masked) {
    drawMaskedFxResult(resources, parent, blended, axes, mask, true);
  }
}
