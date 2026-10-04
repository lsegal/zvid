import {
  borderClearColor,
  sceneClearColor,
} from "./composition-clear-color.ts";
import {
  bindCompositeState,
  type CompositeUniforms,
  drawQuad,
} from "./composition-draw-gl.ts";
import {
  applyFxClip,
  createFxMaskProgram,
  drawMaskedFxResult,
  type FxMaskProgram,
  placeArrangement,
} from "./composition-fx-clip.ts";
import {
  type CompositeUniformLocations,
  createMaskedComposite,
  type DrawnMask,
  drawLayerMask,
  drawMaskedQuad,
  findMaskTargets,
  locateCompositeUniforms,
  type MaskDrawing,
  type MaskedComposite,
} from "./composition-layer-mask.ts";
import {
  isSlotScissorEmpty,
  type LayerDrawStep,
  type LayerPlacement,
  type LayerVisual,
  planHiddenLayerDraws,
  planLayerDraws,
  resolveLayerPlacement,
  resolveSlotBounds,
  resolveSlotScissor,
  type SlotMotion,
  type TransitionComps,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
} from "./composition-order.ts";
import {
  COMPOSITE_FRAGMENT_SOURCE,
  COMPOSITE_VERTEX_SOURCE,
} from "./composition-shaders.ts";
import {
  beginTextureDraw,
  createSourceTextures,
  fitTextureSize,
  releaseAllTextures,
  type SourceTextures,
  uploadFillTexture,
  uploadTextTexture,
  uploadVideoTexture,
} from "./composition-textures.ts";
import {
  type Box,
  canvasBoxToFrame,
  frameBoxInCanvas,
  isIdentityChain,
  type Matrix2D,
  matrixQuadAxes,
  type QuadAxes,
  quadAxes,
  resolveVisualTextBox,
  visualTransformChain,
  visualTransformMatrix,
} from "./composition-transform.ts";
import { drawTransition } from "./composition-transition-draw.ts";
import type { FillPaint } from "./fill-paint.ts";
import { EFFECT_PASSES } from "./fx/effects/index.generated.ts";
import type { LayerMask } from "./fx/effects/mask/mask.ts";
import { TransitionRenderer } from "./fx/effects/transition/renderer.ts";
import type { TransitionSettings } from "./fx/effects/transition/transition.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";
import {
  EffectChainRenderer,
  type PreparedEffectStep,
  type TextureRegion,
  wholeTexture,
} from "./fx-shaders/chain.ts";
import { linkProgram } from "./fx-shaders/gl.ts";
import type { EffectChainStep } from "./fx-shaders/registry.ts";
import { REFERENCE_OUTPUT_SIDE } from "./fx-shaders/types.ts";
import { recordRenderFrame } from "./render-stats.ts";
import { TEXT_REFERENCE_HEIGHT, type TextStyle } from "./text-style.ts";

export type CompositeVisual = LayerVisual & {
  opacity: number;
  rotationDeg: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

export type CompositeLayer = {
  // `laneId` is the layer the clip is on, which an Order can exclude. With
  // `clipProgress`, `durationSeconds` times an animated Order's slides.
  clip: {
    id?: string;
    startQ: number;
    laneId?: string;
    durationSeconds?: number;
  };
  media: { id: string; width?: number; height?: number };
  // Key of the media element in `mediaRefs` this layer draws from.
  sourceKey: string;
  isInBounds: boolean;
  laneRank: number;
  clipProgress: number;
  visual: CompositeVisual;
  effectChain: EffectChainStep[];
  // Set for fill clips, which draw this paint instead of a media element.
  fill?: FillPaint;
  // Set for text clips, which draw this text instead of a media element.
  text?: TextStyle;
  // Set for FX clips, which draw nothing and instead run `effectChain` on
  // the composite beneath them.
  fx?: boolean;
  // Set for FX clips with an Order, which arranges the layers beneath them
  // inside the clip's box before `effectChain` runs.
  order?: CompositionOrder;
  // Set for clips masked by another layer's drawn pixels, or FX clips
  // whose effects apply only where it lets them.
  mask?: LayerMask;
  // Set for FX clips with a Transition, which blends from the comp of the
  // layers beneath them at their start to the one at their end.
  transition?: TransitionSettings & TransitionComps;
  // Set for clips drawn only for a Transition, held on a frame.
  held?: boolean;
};

export type FrameContext = {
  time: number;
  audio: AudioBands;
  groupClipProgress: number;
  // Set for preview frames during playback, which may draw an animating
  // text or fill clip from a nearby raster rather than a new one every
  // frame.
  preview?: boolean;
};

export type CompositeSurface = { width: number; height: number };

export type WebGlResources = SourceTextures & {
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  effectChain: EffectChainRenderer;
  transitions: TransitionRenderer;
  // A frame's FX clip chains and the layers it draws, reused each frame.
  fxSteps: Map<CompositeLayer, PreparedEffectStep[]>;
  drawnLayers: CompositeLayer[];
  // Copies an FX clip's adjusted composite back into its box, or blends it
  // there by its Mask.
  fxMask: FxMaskProgram;
  maskedFxMask: FxMaskProgram;
  uniforms: CompositeUniformLocations;
  // The layer shader for a layer a Mask masks by its Target's drawn alpha.
  masked: MaskedComposite;
};

export function ensureWebGlResources(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes,
) {
  const gl = canvas.getContext("webgl", attributes);
  if (!gl) {
    throw new Error("WebGL is unavailable on this device.");
  }

  return createWebGlResources(gl);
}

export function createWebGlResources(
  gl: WebGLRenderingContext,
): WebGlResources {
  const program = linkProgram(
    gl,
    COMPOSITE_VERTEX_SOURCE,
    COMPOSITE_FRAGMENT_SOURCE,
  );
  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) {
    throw new Error("Failed to allocate WebGL position buffer.");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const effectChain = new EffectChainRenderer(gl, positionBuffer);
  effectChain.precompile(EFFECT_PASSES);

  return {
    ...createSourceTextures(gl),
    program,
    positionBuffer,
    effectChain,
    transitions: new TransitionRenderer(gl, positionBuffer),
    fxSteps: new Map<CompositeLayer, PreparedEffectStep[]>(),
    drawnLayers: [] as CompositeLayer[],
    fxMask: createFxMaskProgram(gl),
    maskedFxMask: createFxMaskProgram(gl, true),
    uniforms: locateCompositeUniforms(gl, program),
    masked: createMaskedComposite(gl),
  };
}

export function disposeWebGlResources(resources: WebGlResources) {
  const { gl } = resources;
  resources.effectChain.dispose();
  resources.transitions.dispose();
  releaseAllTextures(resources);
  gl.deleteBuffer(resources.positionBuffer);
  gl.deleteProgram(resources.program);
  gl.deleteProgram(resources.fxMask.program);
  gl.deleteProgram(resources.maskedFxMask.program);
  gl.deleteProgram(resources.masked.program);
}

// A layer's uniforms: `axes` with its color adjustments at `opacity`, built
// as one object since it runs for every layer every frame.
function layerUniforms(
  axes: QuadAxes,
  visual: CompositeVisual,
  opacity: number,
): CompositeUniforms {
  return {
    axisX: axes.axisX,
    axisY: axes.axisY,
    offset: axes.offset,
    opacity,
    brightness: visual.brightness,
    contrast: visual.contrast,
    saturation: visual.saturation,
  };
}

// Draws the layer's source into a `size` region exactly as it would appear
// in its slot, or a text layer's box (cover, Layout anchor, scale, offset
// and rotation), so the effect chain works on what the slot shows rather
// than on the whole source. Rows are written top row first to match uploaded video textures,
// which is the orientation the effect passes and the composite shader expect.
function renderLayerFrame(
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

// A surface a stack of layers is drawn into: the canvas itself
// (`framebuffer` null) or an offscreen target the FX clips can read back.
type StackTarget = {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
  region?: TextureRegion;
};

// Draws `entry` into slot `index` of `count` of `target`, arranged by
// `order`, or where `motion` has it on its way between slots, masked by
// `mask` when given. Returns false when it was drawn from a nearby raster.
function drawLayer(
  resources: WebGlResources,
  target: StackTarget,
  order: CompositionOrder,
  mediaRefs: Map<string, HTMLMediaElement>,
  frameContext: FrameContext,
  entry: CompositeLayer,
  index: number,
  count: number,
  motion: SlotMotion | undefined,
  mask?: DrawnMask,
): boolean {
  const { gl, effectChain } = resources;
  const { width, height } = target;
  // A clip squished to nothing shows no sliver of itself.
  if (isSlotScissorEmpty(index, count, order, width, height, motion)) {
    return true;
  }
  const surface = { width, height };
  const mediaElement = mediaRefs.get(entry.sourceKey);
  let sourceWidth: number;
  let sourceHeight: number;
  let texture: TextureRegion;
  let sourceOpacity = 1; // A fill's, which its texture is drawn without.
  let settled = true;
  let textBox: { box: Box; matrix: Matrix2D } | undefined;
  if (entry.fill || entry.text) {
    // Fills and text are drawn at their slot's own size, so they cover
    // the slot exactly in any arrangement. While an animated Order moves
    // the slot, they keep the texture drawn at the size of the slot they
    // are settled in, stretched to where the slot has got to, rather than
    // being drawn again every frame.
    const sized = (at: SlotMotion | undefined) => {
      const slot = resolveSlotScissor(index, count, order, width, height, at);
      const size = {
        width: Math.max(1, slot.width),
        height: Math.max(1, slot.height),
        textBox: undefined as typeof textBox,
      };
      if (entry.text) {
        // The Transforms' scale resizes the text box, which the text is
        // laid out and drawn in at full size, rather than stretching it.
        const band = frameBoxInCanvas(
          resolveSlotBounds(index, count, order, width, height, at),
          surface,
        );
        size.textBox = resolveVisualTextBox(band, surface, entry.visual);
        size.width *= size.textBox.box.width / Math.max(1e-6, band.width);
        size.height *= size.textBox.box.height / Math.max(1e-6, band.height);
      }
      return size;
    };
    const moving = sized(motion);
    const raster = motion ? sized(undefined) : moving;
    ({ width: sourceWidth, height: sourceHeight, textBox } = moving);
    const uploaded = entry.fill
      ? uploadFillTexture(
          resources,
          entry.sourceKey,
          entry.fill,
          raster.width,
          raster.height,
          frameContext,
        )
      : uploadTextTexture(
          resources,
          entry.sourceKey,
          entry.text as TextStyle,
          raster.width,
          raster.height,
          // Text sizes are given at 1080p and scale with the output's
          // short side, in portrait as in landscape.
          Math.min(width, height) / TEXT_REFERENCE_HEIGHT,
          frameContext,
        );
    if (!uploaded) {
      return true;
    }
    texture = wholeTexture(uploaded.texture);
    settled = uploaded.settled;
    sourceOpacity = entry.fill?.opacity ?? 1;
  } else {
    if (!(mediaElement instanceof HTMLVideoElement)) {
      return true;
    }

    const uploaded = uploadVideoTexture(
      resources,
      entry.sourceKey,
      entry.media,
      mediaElement,
    );
    if (!uploaded) {
      return true;
    }
    texture = wholeTexture(uploaded);
    sourceWidth = mediaElement.videoWidth || entry.media.width || width;
    sourceHeight = mediaElement.videoHeight || entry.media.height || height;
  }

  const placement = resolveLayerPlacement({
    index,
    count: count,
    canvasWidth: width,
    canvasHeight: height,
    sourceWidth,
    sourceHeight,
    visual: entry.visual,
    order,
    frame: textBox && canvasBoxToFrame(textBox.box, surface),
    motion,
  });
  const { frame, halfExtents, translate, scissor, opacity } = placement;
  let uniforms = layerUniforms(
    quadAxes(
      [halfExtents.x, halfExtents.y],
      [translate.x, translate.y],
      (entry.visual.rotationDeg * Math.PI) / 180,
    ),
    entry.visual,
    entry.visual.opacity * sourceOpacity * opacity,
  );

  // A Transform moves the slot's content, so the layer is framed into its
  // slot first and that frame is drawn transformed: by the clip's own
  // Transform inside its layer's Transform, with their Moves.
  const transformed = !isIdentityChain(visualTransformChain(entry.visual));
  // The clip's own chain steps come first, then its layer's.
  const layerSteps = effectChain.prepare(entry.effectChain);
  if (layerSteps.length || transformed) {
    // Text is framed at its box's size, so its effects see it unstretched.
    const fitted = textBox && fitTextureSize(gl, sourceWidth, sourceHeight);
    const frameSize = fitted || scissor;
    const framed = renderLayerFrame(
      resources,
      texture,
      placement,
      entry.visual,
      frameSize,
      sourceOpacity,
    );
    texture = !layerSteps.length
      ? framed
      : (effectChain.run(
          framed,
          frameSize.width,
          frameSize.height,
          layerSteps,
          {
            time: frameContext.time,
            clipProgress: entry.clipProgress,
            resolution: [frameSize.width, frameSize.height],
            // The frame is in output pixels, unless a text box is scaled
            // down to fit a texture.
            pixelScale:
              ((fitted ? fitted.factor : 1) * Math.min(width, height)) /
              REFERENCE_OUTPUT_SIDE,
            // The framed layer is written top row first, like a layer texture.
            bottomUp: false,
          },
        ) ?? framed);
    // The framed result already holds the layer's placement, so it fills
    // its slot exactly, or the box its Transforms move the slot to. A text
    // box already holds the Transforms' scale, so it is drawn without it.
    uniforms = layerUniforms(
      transformed
        ? matrixQuadAxes(
            frame,
            textBox?.matrix ??
              visualTransformMatrix(
                frameBoxInCanvas(frame, surface),
                surface,
                entry.visual,
              ),
            surface,
          )
        : quadAxes(
            [frame.halfWidth, frame.halfHeight],
            [frame.centerX, frame.centerY],
            0,
          ),
      entry.visual,
      entry.visual.opacity * opacity,
    );
  }

  bindCompositeState(resources, target.framebuffer, width, height);
  // Every layer is cropped to its slot, transformed or not, so a Transform
  // or Move never spills into a neighboring slot or the spacing between
  // them.
  // Without an Order the slot is the whole of `target`: the canvas, or the
  // box of the FX clip arranging it.
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);
  if (mask) {
    drawMaskedQuad(gl, resources.masked, mask, width, height, (located) =>
      drawQuad(resources, texture, uniforms, located),
    );
  } else {
    drawQuad(resources, texture, uniforms);
  }
  return settled;
}

// Returns false when a preview frame drew a clip from a nearby raster.
export function drawComposition(
  resources: WebGlResources,
  surface: CompositeSurface,
  activeClips: CompositeLayer[],
  mediaRefs: Map<string, HTMLMediaElement>,
  groupChain: EffectChainStep[],
  frameContext: FrameContext,
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
): boolean {
  const startedAt = performance.now();
  const { gl, effectChain } = resources;
  const { width, height } = surface;
  beginTextureDraw(resources, mediaRefs);
  effectChain.syncSurface(width, height);
  effectChain.settlePrecompiled();
  const groupSteps = effectChain.prepare(groupChain);
  // Each FX clip's chain, when it has one; an FX clip without effects
  // changes nothing, so it is skipped unless its Order arranges the layers
  // beneath it.
  const { fxSteps, drawnLayers } = resources;
  fxSteps.clear();
  for (const entry of activeClips) {
    if (entry.fx && entry.isInBounds) {
      const steps = effectChain.prepare(entry.effectChain);
      if (steps.length) {
        fxSteps.set(entry, steps);
      }
    }
  }
  // FX clips and the Global chain read the composite back, so it is drawn
  // offscreen when either has work to do.
  const scene =
    groupSteps.length || fxSteps.size
      ? effectChain.getSceneTarget(width, height)
      : null;
  const sceneTarget: StackTarget = {
    framebuffer: scene?.framebuffer ?? null,
    width,
    height,
    region: scene ? wholeTexture(scene.texture) : undefined,
  };
  bindCompositeState(resources, sceneTarget.framebuffer, width, height);
  // The Global Order's border fills its gaps and empty cells.
  gl.clearColor(...sceneClearColor(order));
  gl.clear(gl.COLOR_BUFFER_BIT);

  // FX clips and the layers the Order excludes take no slot, and a Grid has
  // one cell per arranged layer, so arranged layers past the last cell are
  // not drawn. Clips on hidden layers are drawn only into the masks that
  // target them.
  drawnLayers.length = 0;
  for (const entry of activeClips) {
    if (
      entry.fx
        ? fxSteps.has(entry) ||
          (entry.isInBounds &&
            (entry.order !== undefined || entry.transition !== undefined))
        : entry.isInBounds &&
          (entry.fill ||
            entry.text ||
            mediaRefs.get(entry.sourceKey) instanceof HTMLVideoElement)
    ) {
      drawnLayers.push(entry);
    }
  }
  // Draws a picture onto `target` with `axes`, unadjusted.
  const drawPicture = (
    target: { framebuffer: WebGLFramebuffer | null } & CompositeSurface,
    source: TextureRegion,
    axes: QuadAxes,
  ) => {
    bindCompositeState(
      resources,
      target.framebuffer,
      target.width,
      target.height,
    );
    drawQuad(resources, source, {
      ...axes,
      opacity: 1,
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
  };
  let settled = true;
  const planned = planLayerDraws(drawnLayers, order);
  // What a Mask finds its Target among: the planned steps, and the hidden
  // layers' clips, which only masks draw, on the canvas.
  const hiddenSteps = planHiddenLayerDraws(drawnLayers);
  const maskable = hiddenSteps.length ? [...planned, ...hiddenSteps] : planned;
  // The layers whose masks are being drawn, so a cycle of masks ends.
  const masking = new Set<CompositeLayer>();
  // A layer or FX clip step's mask from mask target `slot` on: undefined
  // when it has none, or when it closes a cycle of masks, and null when its
  // Target draws nothing.
  const maskFor = (step: LayerDrawStep<CompositeLayer>, slot: number) => {
    const { mask } = step.entry;
    if (!mask || masking.has(step.entry)) {
      return undefined;
    }
    masking.add(step.entry);
    const drawn = drawLayerMask(
      maskDrawing,
      findMaskTargets(maskable, step, mask),
      mask,
      surface,
      slot,
    );
    masking.delete(step.entry);
    return drawn;
  };
  // An FX clip step's mask, drawn once what it processes is: false when
  // its Target draws nothing and it is Additive, so its effects apply
  // nowhere.
  const fxMaskFor = (step: LayerDrawStep<CompositeLayer>) => {
    const drawn = maskFor(step, 0);
    return drawn === null && step.entry.mask?.mode === "additive"
      ? false
      : (drawn ?? undefined);
  };
  // Draws a layer step on `target`, masked from mask target `slot` on.
  const drawLayerStep = (
    step: LayerDrawStep<CompositeLayer> & { type: "layer" },
    target: StackTarget,
    slot: number,
  ) => {
    const drawnMask = maskFor(step, slot);
    // With nothing drawn on its Target, an Additive mask shows nothing.
    if (drawnMask === null && step.entry.mask?.mode === "additive") {
      return;
    }
    const drawn = drawLayer(
      resources,
      target,
      // The Order, or the z-order overlay for a layer it excludes.
      step.order,
      mediaRefs,
      frameContext,
      step.entry,
      step.slot,
      step.slotCount,
      step.motion,
      drawnMask ?? undefined,
    );
    settled = drawn && settled;
  };
  const maskDrawing: MaskDrawing<CompositeLayer> = {
    gl,
    effectChain,
    bind: (target) =>
      bindCompositeState(
        resources,
        target.framebuffer,
        target.width,
        target.height,
      ),
    placeArrangement: (step, parent) =>
      placeArrangement(gl, step.entry, parent),
    drawStep: (target, step, slot) => drawLayerStep(step, target, slot),
    drawHop: (target, source, axes) => drawPicture(target, source, axes),
  };
  const drawSteps = (
    steps: LayerDrawStep<CompositeLayer>[],
    target: StackTarget,
    depth: number,
  ) => {
    for (const step of steps) {
      if (step.type === "layer") {
        drawLayerStep(step, target, 0);
      } else if (step.type === "transition") {
        drawTransition(
          resources,
          step,
          target,
          depth,
          drawSteps,
          fxSteps.get(step.entry) ?? [],
          frameContext,
          () => fxMaskFor(step),
        );
      } else if (step.type === "arrange") {
        drawArrangement(step, target, depth);
      } else if (target.region && target.framebuffer) {
        const mask = fxMaskFor(step);
        if (mask !== false) {
          applyFxClip(
            resources,
            { framebuffer: target.framebuffer, region: target.region },
            { width: target.width, height: target.height },
            step.entry,
            fxSteps.get(step.entry) ?? [],
            frameContext,
            mask,
          );
        }
      }
    }
  };

  // An FX clip with an Order draws the layers beneath it into its own box,
  // arranged by its Order over its border color, runs the rest of its
  // chain on the result and draws that into its box on `parent`. Nothing is
  // beneath it there but the background, which a translucent border shows.
  const drawArrangement = (
    step: LayerDrawStep<CompositeLayer> & { type: "arrange" },
    parent: StackTarget,
    depth: number,
  ) => {
    const { entry } = step;
    const { size, axes } = placeArrangement(gl, entry, parent);
    const target = effectChain.getArrangementTarget(
      depth,
      size.width,
      size.height,
    );
    bindCompositeState(resources, target.framebuffer, size.width, size.height);
    gl.clearColor(...borderClearColor(step.order));
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSteps(step.steps, { ...size, ...target }, depth + 1);
    gl.disable(gl.SCISSOR_TEST);

    // The FX clip's other effects run on the arranged layers, where its
    // Mask lets them.
    const arrangement = target.region;
    const mask = fxMaskFor(step);
    const steps = mask === false ? [] : (fxSteps.get(entry) ?? []);
    const arranged = steps.length
      ? (effectChain.run(arrangement, size.width, size.height, steps, {
          time: frameContext.time,
          clipProgress: entry.clipProgress,
          resolution: [size.width, size.height],
          // The arrangement framebuffer is rendered normally, so it is
          // bottom-up.
          bottomUp: true,
        }) ?? arrangement)
      : arrangement;
    if (mask && arranged !== arrangement) {
      drawPicture(parent, arrangement, axes);
      drawMaskedFxResult(resources, parent, arranged, axes, mask);
    } else {
      drawPicture(parent, arranged, axes);
    }
  };

  drawSteps(planned, sceneTarget, 0);

  gl.disable(gl.SCISSOR_TEST);
  if (scene && !groupSteps.length) {
    // Only FX clips needed the offscreen composite: show it as it is.
    bindCompositeState(resources, null, width, height);
    gl.disable(gl.BLEND);
    drawQuad(resources, wholeTexture(scene.texture), {
      // The scene is bottom-up, unlike the top-row-first layer textures the
      // composite shader expects, so it is drawn flipped.
      ...quadAxes([1, -1], [0, 0], 0),
      opacity: 1,
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
  } else if (scene) {
    effectChain.run(
      wholeTexture(scene.texture),
      width,
      height,
      groupSteps,
      {
        time: frameContext.time,
        clipProgress: frameContext.groupClipProgress,
        resolution: [width, height],
        // The scene framebuffer is rendered normally, so it is bottom-up.
        bottomUp: true,
      },
      "screen",
    );
    bindCompositeState(resources, null, width, height);
  }
  recordRenderFrame(performance.now() - startedAt);
  return settled;
}
