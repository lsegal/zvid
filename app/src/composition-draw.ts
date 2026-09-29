import {
  type LayerDrawStep,
  type LayerPlacement,
  type LayerVisual,
  planLayerDraws,
  resolveCanvasBounds,
  resolveLayerPlacement,
  resolveSlotBounds,
  resolveSlotScissor,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
} from "./composition-order.ts";
import {
  type Box,
  canvasBoxToFrame,
  frameBoxInCanvas,
  isIdentityTransform,
  type Matrix2D,
  matrixQuadAxes,
  nestedTransformMatrix,
  type QuadAxes,
  resolveClipTextBox,
} from "./composition-transform.ts";
import { type FillPaint, rasterizeFillPaint } from "./fill-paint.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";
import {
  EffectChainRenderer,
  type PreparedEffectStep,
  type RenderTarget,
} from "./fx-shaders/chain.ts";
import { linkProgram, POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";
import type { EffectChainStep } from "./fx-shaders/registry.ts";
import { isFontFaceReady, resolveFontFace } from "./text-fonts.ts";
import { createTextCanvas, drawText } from "./text-render.ts";
import { TEXT_REFERENCE_HEIGHT, type TextStyle } from "./text-style.ts";

export type CompositeVisual = LayerVisual & {
  opacity: number;
  rotationDeg: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

export type CompositeLayer = {
  // `laneId` is the layer the clip is on, which an Order can exclude.
  clip: { startQ: number; laneId?: string };
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
};

// What the composite shows where no layer is drawn.
const BACKGROUND_COLOR = [0.07, 0.08, 0.11, 1] as const;

// Fill textures are drawn at most this many pixels on a side; the linear
// filter smooths gradients when the band is larger.
const MAX_FILL_TEXTURE_SIZE = 512;

export type FrameContext = {
  time: number;
  audio: AudioBands;
  groupClipProgress: number;
};

export type CompositeSurface = { width: number; height: number };

export type WebGlResources = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  textureMap: Map<string, WebGLTexture>;
  readyTextureIds: Set<string>;
  // What each fill or text texture was last drawn with, so it is only
  // redrawn when its paint, text or size changes.
  generatedTextureKeys: Map<string, string>;
  effectChain: EffectChainRenderer;
  // Copies an FX clip's adjusted composite back into its box.
  fxMask: {
    program: WebGLProgram;
    texture: WebGLUniformLocation | null;
    axisX: WebGLUniformLocation | null;
    axisY: WebGLUniformLocation | null;
    offset: WebGLUniformLocation | null;
  };
  uniforms: {
    position: number;
    texture: WebGLUniformLocation | null;
    axisX: WebGLUniformLocation | null;
    axisY: WebGLUniformLocation | null;
    offset: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    brightness: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
  };
};

type CompositeUniforms = QuadAxes & {
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

const COMPOSITE_FRAGMENT_SOURCE = `
  precision mediump float;

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;

  void main() {
    vec4 color = texture2D(uTexture, vec2(vUv.x, 1.0 - vUv.y));
    color.rgb += uBrightness;
    color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luma), color.rgb, uSaturation);
    color.a *= uOpacity;
    gl_FragColor = color;
  }
`;

const COMPOSITE_VERTEX_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  uniform vec2 uAxisX;
  uniform vec2 uAxisY;
  uniform vec2 uOffset;

  void main() {
    vec2 position = aPosition.x * uAxisX + aPosition.y * uAxisY + uOffset;
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = aPosition * 0.5 + 0.5;
  }
`;

// Draws a quad over an FX clip's box that samples the texture at the same
// place on the canvas, so the adjusted composite replaces the original only
// inside the box, however the box is turned.
const FX_MASK_VERTEX_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  uniform vec2 uAxisX;
  uniform vec2 uAxisY;
  uniform vec2 uOffset;

  void main() {
    vec2 position = aPosition.x * uAxisX + aPosition.y * uAxisY + uOffset;
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = position * 0.5 + 0.5;
  }
`;

const FX_MASK_FRAGMENT_SOURCE = `
  precision mediump float;

  varying vec2 vUv;
  uniform sampler2D uTexture;

  void main() {
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

export function ensureWebGlResources(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
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

  const fxMaskProgram = linkProgram(
    gl,
    FX_MASK_VERTEX_SOURCE,
    FX_MASK_FRAGMENT_SOURCE,
  );

  return {
    gl,
    program,
    positionBuffer,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    generatedTextureKeys: new Map<string, string>(),
    effectChain: new EffectChainRenderer(gl, positionBuffer),
    fxMask: {
      program: fxMaskProgram,
      texture: gl.getUniformLocation(fxMaskProgram, "uTexture"),
      axisX: gl.getUniformLocation(fxMaskProgram, "uAxisX"),
      axisY: gl.getUniformLocation(fxMaskProgram, "uAxisY"),
      offset: gl.getUniformLocation(fxMaskProgram, "uOffset"),
    },
    uniforms: {
      position: gl.getAttribLocation(program, "aPosition"),
      texture: gl.getUniformLocation(program, "uTexture"),
      axisX: gl.getUniformLocation(program, "uAxisX"),
      axisY: gl.getUniformLocation(program, "uAxisY"),
      offset: gl.getUniformLocation(program, "uOffset"),
      opacity: gl.getUniformLocation(program, "uOpacity"),
      brightness: gl.getUniformLocation(program, "uBrightness"),
      contrast: gl.getUniformLocation(program, "uContrast"),
      saturation: gl.getUniformLocation(program, "uSaturation"),
    },
  };
}

function getOrCreateTexture(resources: WebGlResources, id: string) {
  const existing = resources.textureMap.get(id);
  if (existing) {
    return existing;
  }

  const { gl } = resources;
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("Failed to allocate WebGL texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  resources.textureMap.set(id, texture);
  return texture;
}

export function disposeWebGlResources(resources: WebGlResources) {
  const { gl } = resources;
  resources.effectChain.dispose();
  for (const texture of resources.textureMap.values()) {
    gl.deleteTexture(texture);
  }
  resources.textureMap.clear();
  resources.readyTextureIds.clear();
  resources.generatedTextureKeys.clear();
  gl.deleteBuffer(resources.positionBuffer);
  gl.deleteProgram(resources.program);
  gl.deleteProgram(resources.fxMask.program);
}

// Restores everything the composite draw depends on. The effect chain and
// render-target setup rebind the program, array buffer, attribute pointer,
// blending, viewport and texture unit, so this runs before every draw
// instead of relying on state left over from initialisation. Scissoring is
// left off; each layer draw scissors to its own slot.
function bindCompositeState(
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
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.SCISSOR_TEST);
  gl.activeTexture(gl.TEXTURE0);
}

function drawQuad(
  resources: WebGlResources,
  texture: WebGLTexture,
  values: CompositeUniforms,
) {
  const { gl, uniforms } = resources;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniforms.texture, 0);
  gl.uniform2f(uniforms.axisX, ...values.axisX);
  gl.uniform2f(uniforms.axisY, ...values.axisY);
  gl.uniform2f(uniforms.offset, ...values.offset);
  gl.uniform1f(uniforms.opacity, values.opacity);
  gl.uniform1f(uniforms.brightness, values.brightness);
  gl.uniform1f(uniforms.contrast, values.contrast);
  gl.uniform1f(uniforms.saturation, values.saturation);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Quad axes for a quad scaled by `scale`, turned clockwise by `radians` in
// clip space and centred on `translate`.
function quadAxes(
  scale: [number, number],
  translate: [number, number],
  radians: number,
): QuadAxes {
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  return {
    axisX: [c * scale[0], -s * scale[0]],
    axisY: [s * scale[1], c * scale[1]],
    offset: translate,
  };
}

function colorUniforms(visual: CompositeVisual) {
  return {
    opacity: visual.opacity,
    brightness: visual.brightness,
    contrast: visual.contrast,
    saturation: visual.saturation,
  };
}

// Draws the layer's source into a `size` target exactly as it would appear
// in its slot, or a text layer's box (cover, Layout anchor, scale, offset
// and rotation), so the effect chain works on what the slot shows rather
// than on the whole source. Rows are written top row first to match uploaded video textures,
// which is the orientation the effect passes and the composite shader expect.
function renderLayerFrame(
  resources: WebGlResources,
  texture: WebGLTexture,
  placement: LayerPlacement,
  visual: CompositeVisual,
  size: { width: number; height: number },
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
    opacity: 1,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  });
  return target.texture;
}

// Uploads the media element's current frame into the layer's texture.
// Returns undefined when the element has never had a frame to show.
function uploadVideoTexture(
  resources: WebGlResources,
  entry: CompositeLayer,
  mediaElement: HTMLVideoElement,
) {
  const { gl } = resources;
  const texture = getOrCreateTexture(resources, entry.sourceKey);
  const hasDecodedFrame =
    mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    (mediaElement.videoWidth > 0 || Boolean(entry.media.width)) &&
    (mediaElement.videoHeight > 0 || Boolean(entry.media.height));

  if (hasDecodedFrame) {
    resources.readyTextureIds.add(entry.sourceKey);
  } else if (!resources.readyTextureIds.has(entry.sourceKey)) {
    return undefined;
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (hasDecodedFrame) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      mediaElement,
    );
  }
  return texture;
}

// Draws a fill's paint into its texture, top row first like an uploaded
// video frame, when the paint or the band size changed since last time.
function uploadFillTexture(
  resources: WebGlResources,
  sourceKey: string,
  fill: FillPaint,
  bandWidth: number,
  bandHeight: number,
) {
  const { gl } = resources;
  const texture = getOrCreateTexture(resources, sourceKey);
  const scale = Math.min(
    1,
    MAX_FILL_TEXTURE_SIZE / Math.max(bandWidth, bandHeight, 1),
  );
  const textureWidth = Math.max(1, Math.round(bandWidth * scale));
  const textureHeight = Math.max(1, Math.round(bandHeight * scale));
  const key = `${textureWidth}x${textureHeight}:${JSON.stringify(fill)}`;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (resources.generatedTextureKeys.get(sourceKey) !== key) {
    const raster = rasterizeFillPaint(fill, textureWidth, textureHeight);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      raster.width,
      raster.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      raster.pixels,
    );
    resources.generatedTextureKeys.set(sourceKey, key);
  }
  return texture;
}

// A texture size for a `width` × `height` box: whole pixels, shrunk by
// `factor` to fit the largest texture the context allows.
function fitTextureSize(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
) {
  const maxSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
  const factor = Math.min(1, maxSize / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.min(maxSize, Math.round(width * factor))),
    height: Math.max(1, Math.min(maxSize, Math.round(height * factor))),
    factor,
  };
}

// Draws a text clip into its texture at the full size of its box, so it
// stays sharp, when its text, style, face or the box changed since last
// time. Until its face has loaded, the previous texture is kept, or nothing
// is drawn, so the text never shows in a fallback font.
function uploadTextTexture(
  resources: WebGlResources,
  sourceKey: string,
  text: TextStyle,
  boxWidth: number,
  boxHeight: number,
  boxScale: number,
) {
  const { gl } = resources;
  const face = resolveFontFace(text.font, text.weight, text.italic);
  // A box too large for a texture is drawn smaller, laid out the same.
  const { width, height, factor } = fitTextureSize(gl, boxWidth, boxHeight);
  const scale = boxScale * factor;
  const key = `${width}x${height}@${scale}:${JSON.stringify(face)}:${JSON.stringify(text)}`;
  const drawn = resources.generatedTextureKeys.get(sourceKey);
  if (drawn !== key && !isFontFaceReady(face)) {
    return drawn === undefined
      ? undefined
      : getOrCreateTexture(resources, sourceKey);
  }

  const texture = getOrCreateTexture(resources, sourceKey);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (drawn !== key) {
    const canvas = createTextCanvas(width, height);
    if (!canvas || !drawText(canvas, text, face, width, height, scale)) {
      return undefined;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas as TexImageSource,
    );
    resources.generatedTextureKeys.set(sourceKey, key);
  }
  return texture;
}

// Runs an FX clip's chain on the composite drawn so far, `scene`, and writes
// the result back over the clip's box: the whole canvas, or where the
// layer's and the clip's Transforms move it.
function applyFxClip(
  resources: WebGlResources,
  scene: RenderTarget,
  surface: CompositeSurface,
  entry: CompositeLayer,
  steps: PreparedEffectStep[],
  frameContext: FrameContext,
) {
  const { gl, effectChain, fxMask } = resources;
  const { width, height } = surface;
  const adjusted = effectChain.run(scene.texture, width, height, steps, {
    time: frameContext.time,
    clipProgress: entry.clipProgress,
    resolution: [width, height],
    audioLow: frameContext.audio.low,
    audioHigh: frameContext.audio.high,
    impulseLow: frameContext.audio.impulseLow,
    impulseHigh: frameContext.audio.impulseHigh,
    // The scene framebuffer is rendered normally, so it is bottom-up.
    bottomUp: true,
  });
  if (!adjusted || adjusted === scene.texture) {
    return;
  }

  const frame = resolveCanvasBounds(width, height);
  const axes: QuadAxes =
    isIdentityTransform(entry.visual.transform) &&
    isIdentityTransform(entry.visual.clipTransform)
      ? { axisX: [1, 0], axisY: [0, 1], offset: [0, 0] }
      : matrixQuadAxes(
          frame,
          nestedTransformMatrix(
            frameBoxInCanvas(frame, surface),
            surface,
            entry.visual.transform,
            entry.visual.clipTransform,
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
  gl.bindTexture(gl.TEXTURE_2D, adjusted);
  gl.uniform1i(fxMask.texture, 0);
  gl.uniform2f(fxMask.axisX, ...axes.axisX);
  gl.uniform2f(fxMask.axisY, ...axes.axisY);
  gl.uniform2f(fxMask.offset, ...axes.offset);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// A surface a stack of layers is drawn into: the canvas itself
// (`framebuffer` null) or an offscreen target the FX clips can read back.
type StackTarget = {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
  texture?: WebGLTexture;
};

// Draws `entry` into slot `index` of `count` of `target`, arranged by
// `order`.
function drawLayer(
  resources: WebGlResources,
  target: StackTarget,
  order: CompositionOrder,
  mediaRefs: Map<string, HTMLMediaElement>,
  frameContext: FrameContext,
  entry: CompositeLayer,
  index: number,
  count: number,
) {
  const { gl, effectChain } = resources;
  const { width, height } = target;
  const surface = { width, height };
  const mediaElement = mediaRefs.get(entry.sourceKey);
  let sourceWidth: number;
  let sourceHeight: number;
  let texture: WebGLTexture;
  let textBox: { box: Box; matrix: Matrix2D } | undefined;
  if (entry.fill || entry.text) {
    // Fills and text are drawn at their slot's own size, so they cover
    // the slot exactly in any arrangement.
    const slot = resolveSlotScissor(index, count, order, width, height);
    sourceWidth = Math.max(1, slot.width);
    sourceHeight = Math.max(1, slot.height);
    if (entry.text) {
      // The Transforms' scale resizes the text box, which the text is laid
      // out and drawn in at full size, rather than stretching the text.
      const band = frameBoxInCanvas(
        resolveSlotBounds(index, count, order, width, height),
        surface,
      );
      textBox = resolveClipTextBox(
        band,
        surface,
        entry.visual.transform,
        entry.visual.clipTransform,
      );
      sourceWidth *= textBox.box.width / Math.max(1e-6, band.width);
      sourceHeight *= textBox.box.height / Math.max(1e-6, band.height);
    }
    if (entry.fill) {
      texture = uploadFillTexture(
        resources,
        entry.sourceKey,
        entry.fill,
        sourceWidth,
        sourceHeight,
      );
    } else {
      const uploaded = uploadTextTexture(
        resources,
        entry.sourceKey,
        entry.text as TextStyle,
        sourceWidth,
        sourceHeight,
        // Text sizes are given at 1080p and scale with the output's
        // short side, in portrait as in landscape.
        Math.min(width, height) / TEXT_REFERENCE_HEIGHT,
      );
      if (!uploaded) {
        return;
      }
      texture = uploaded;
    }
  } else {
    if (!(mediaElement instanceof HTMLVideoElement)) {
      return;
    }

    const uploaded = uploadVideoTexture(resources, entry, mediaElement);
    if (!uploaded) {
      return;
    }
    texture = uploaded;
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
  });
  const { frame, halfExtents, translate, scissor } = placement;
  let uniforms: CompositeUniforms = {
    ...quadAxes(
      [halfExtents.x, halfExtents.y],
      [translate.x, translate.y],
      (entry.visual.rotationDeg * Math.PI) / 180,
    ),
    ...colorUniforms(entry.visual),
  };

  // A Transform moves the slot's content, so the layer is framed into its
  // slot first and that frame is drawn transformed: by the clip's own
  // Transform inside its layer's Transform.
  const transformed =
    !isIdentityTransform(entry.visual.transform) ||
    !isIdentityTransform(entry.visual.clipTransform);
  // The clip's own chain steps come first, then its layer's.
  const layerSteps = effectChain.prepare(entry.effectChain);
  if (layerSteps.length || transformed) {
    // Text is framed at its box's size, so its effects see it unstretched.
    const frameSize = textBox
      ? fitTextureSize(gl, sourceWidth, sourceHeight)
      : scissor;
    const framed = renderLayerFrame(
      resources,
      texture,
      placement,
      entry.visual,
      frameSize,
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
            audioLow: frameContext.audio.low,
            audioHigh: frameContext.audio.high,
            impulseLow: frameContext.audio.impulseLow,
            impulseHigh: frameContext.audio.impulseHigh,
            // The framed layer is written top row first, like a layer texture.
            bottomUp: false,
          },
        ) ?? framed);
    // The framed result already holds the layer's placement, so it fills
    // its slot exactly, or the box its Transforms move the slot to. A text
    // box already holds the Transforms' scale, so it is drawn without it.
    uniforms = {
      ...(transformed
        ? matrixQuadAxes(
            frame,
            textBox?.matrix ??
              nestedTransformMatrix(
                frameBoxInCanvas(frame, surface),
                surface,
                entry.visual.transform,
                entry.visual.clipTransform,
              ),
            surface,
          )
        : quadAxes(
            [frame.halfWidth, frame.halfHeight],
            [frame.centerX, frame.centerY],
            0,
          )),
      ...colorUniforms(entry.visual),
    };
  }

  bindCompositeState(resources, target.framebuffer, width, height);
  // A transformed layer can leave its slot; only the canvas clips it.
  if (!transformed) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);
  }
  drawQuad(resources, texture, uniforms);
}

export function drawComposition(
  resources: WebGlResources,
  surface: CompositeSurface,
  activeClips: CompositeLayer[],
  mediaRefs: Map<string, HTMLMediaElement>,
  groupChain: EffectChainStep[],
  frameContext: FrameContext,
  order: CompositionOrder = DEFAULT_COMPOSITION_ORDER,
) {
  const { gl, effectChain } = resources;
  const { width, height } = surface;
  effectChain.syncSurface(width, height);
  const groupSteps = effectChain.prepare(groupChain);
  // Each FX clip's chain, when it has one; an FX clip without effects
  // changes nothing, so it is skipped unless its Order arranges the layers
  // beneath it.
  const fxSteps = new Map<CompositeLayer, PreparedEffectStep[]>();
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
  const sceneTarget: StackTarget = scene ?? {
    framebuffer: null,
    width,
    height,
  };
  bindCompositeState(resources, sceneTarget.framebuffer, width, height);
  gl.clearColor(...BACKGROUND_COLOR);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const drawSteps = (
    steps: LayerDrawStep<CompositeLayer>[],
    target: StackTarget,
    depth: number,
  ) => {
    for (const step of steps) {
      if (step.type === "layer") {
        drawLayer(
          resources,
          target,
          // The Order, or the z-order overlay for a layer it excludes.
          step.order,
          mediaRefs,
          frameContext,
          step.entry,
          step.slot,
          step.slotCount,
        );
      } else if (step.type === "arrange") {
        drawArrangement(step, target, depth);
      } else if (target.texture && target.framebuffer) {
        applyFxClip(
          resources,
          {
            ...target,
            texture: target.texture,
            framebuffer: target.framebuffer,
          },
          { width: target.width, height: target.height },
          step.entry,
          fxSteps.get(step.entry) ?? [],
          frameContext,
        );
      }
    }
  };

  // An FX clip with an Order draws the layers beneath it into its own box,
  // arranged by its Order, runs the rest of its chain on the result and
  // writes that into its box on `parent`. Nothing is beneath it there but
  // the background, which the arrangement is drawn over.
  const drawArrangement = (
    step: LayerDrawStep<CompositeLayer> & { type: "arrange" },
    parent: StackTarget,
    depth: number,
  ) => {
    const { entry } = step;
    const parentSurface = { width: parent.width, height: parent.height };
    // The box takes the Transforms' scale, so the layers are arranged in a
    // smaller or larger box rather than squeezed or stretched.
    const placed = resolveClipTextBox(
      { x: 0, y: 0, width: parent.width, height: parent.height },
      parentSurface,
      entry.visual.transform,
      entry.visual.clipTransform,
    );
    const size = fitTextureSize(gl, placed.box.width, placed.box.height);
    const target = effectChain.getArrangementTarget(
      depth,
      size.width,
      size.height,
    );
    bindCompositeState(resources, target.framebuffer, size.width, size.height);
    gl.clearColor(...BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSteps(step.steps, target, depth + 1);
    gl.disable(gl.SCISSOR_TEST);

    // The FX clip's other effects run on the arranged layers.
    const steps = fxSteps.get(entry) ?? [];
    const arranged = steps.length
      ? (effectChain.run(target.texture, size.width, size.height, steps, {
          time: frameContext.time,
          clipProgress: entry.clipProgress,
          resolution: [size.width, size.height],
          audioLow: frameContext.audio.low,
          audioHigh: frameContext.audio.high,
          impulseLow: frameContext.audio.impulseLow,
          impulseHigh: frameContext.audio.impulseHigh,
          // The arrangement framebuffer is rendered normally, so it is
          // bottom-up.
          bottomUp: true,
        }) ?? target.texture)
      : target.texture;
    const axes = matrixQuadAxes(
      canvasBoxToFrame(placed.box, parentSurface),
      placed.matrix,
      parentSurface,
    );
    bindCompositeState(
      resources,
      parent.framebuffer,
      parent.width,
      parent.height,
    );
    gl.disable(gl.BLEND);
    drawQuad(resources, arranged, {
      // The arrangement is bottom-up, unlike the top-row-first layer
      // textures the composite shader expects, so it is drawn flipped.
      axisX: axes.axisX,
      axisY: [-axes.axisY[0], -axes.axisY[1]],
      offset: axes.offset,
      opacity: 1,
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
  };

  // FX clips and the layers the Order excludes take no slot, and a Grid has
  // one cell per arranged layer, so arranged layers past the last cell are
  // not drawn.
  drawSteps(
    planLayerDraws(
      activeClips.filter((entry) =>
        entry.fx
          ? fxSteps.has(entry) ||
            (entry.isInBounds && entry.order !== undefined)
          : entry.isInBounds &&
            (entry.fill ||
              entry.text ||
              mediaRefs.get(entry.sourceKey) instanceof HTMLVideoElement),
      ),
      order,
    ),
    sceneTarget,
    0,
  );

  gl.disable(gl.SCISSOR_TEST);
  if (scene && !groupSteps.length) {
    // Only FX clips needed the offscreen composite: show it as it is.
    bindCompositeState(resources, null, width, height);
    gl.disable(gl.BLEND);
    drawQuad(resources, scene.texture, {
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
      scene.texture,
      width,
      height,
      groupSteps,
      {
        time: frameContext.time,
        clipProgress: frameContext.groupClipProgress,
        resolution: [width, height],
        audioLow: frameContext.audio.low,
        audioHigh: frameContext.audio.high,
        impulseLow: frameContext.audio.impulseLow,
        impulseHigh: frameContext.audio.impulseHigh,
        // The scene framebuffer is rendered normally, so it is bottom-up.
        bottomUp: true,
      },
      "screen",
    );
    bindCompositeState(resources, null, width, height);
  }
}
