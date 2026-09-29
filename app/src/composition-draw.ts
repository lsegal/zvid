import {
  type LayerPlacement,
  type LayerVisual,
  orderStackedLayers,
  resolveLayerPlacement,
} from "./composition-layout.ts";
import { type FillPaint, rasterizeFillPaint } from "./fill-paint.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";
import { EffectChainRenderer } from "./fx-shaders/chain.ts";
import { linkProgram } from "./fx-shaders/gl.ts";
import type { EffectChainStep } from "./fx-shaders/registry.ts";

export type CompositeVisual = LayerVisual & {
  opacity: number;
  rotationDeg: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

export type CompositeLayer = {
  clip: { startQ: number };
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
};

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
  // What each fill texture was last drawn with, so it is only redrawn when
  // its paint or size changes.
  fillTextureKeys: Map<string, string>;
  effectChain: EffectChainRenderer;
  uniforms: {
    position: number;
    texture: WebGLUniformLocation | null;
    coverScale: WebGLUniformLocation | null;
    userScale: WebGLUniformLocation | null;
    translate: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    brightness: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
  };
};

type CompositeUniforms = {
  coverScale: [number, number];
  translate: [number, number];
  rotation: number;
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

  uniform vec2 uCoverScale;
  uniform float uUserScale;
  uniform vec2 uTranslate;
  uniform float uRotation;

  void main() {
    vec2 position = aPosition * uCoverScale * uUserScale;
    float s = sin(uRotation);
    float c = cos(uRotation);
    position = mat2(c, -s, s, c) * position;
    position += uTranslate;
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = aPosition * 0.5 + 0.5;
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

  return {
    gl,
    program,
    positionBuffer,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    fillTextureKeys: new Map<string, string>(),
    effectChain: new EffectChainRenderer(gl, positionBuffer),
    uniforms: {
      position: gl.getAttribLocation(program, "aPosition"),
      texture: gl.getUniformLocation(program, "uTexture"),
      coverScale: gl.getUniformLocation(program, "uCoverScale"),
      userScale: gl.getUniformLocation(program, "uUserScale"),
      translate: gl.getUniformLocation(program, "uTranslate"),
      rotation: gl.getUniformLocation(program, "uRotation"),
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
  resources.fillTextureKeys.clear();
  gl.deleteBuffer(resources.positionBuffer);
  gl.deleteProgram(resources.program);
}

// Restores everything the composite draw depends on. The effect chain and
// render-target setup rebind the program, array buffer, attribute pointer,
// blending, viewport and texture unit, so this runs before every draw
// instead of relying on state left over from initialisation. Scissoring is
// left off; each layer draw scissors to its own band.
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
  gl.uniform2f(uniforms.coverScale, ...values.coverScale);
  gl.uniform1f(uniforms.userScale, 1);
  gl.uniform2f(uniforms.translate, ...values.translate);
  gl.uniform1f(uniforms.rotation, values.rotation);
  gl.uniform1f(uniforms.opacity, values.opacity);
  gl.uniform1f(uniforms.brightness, values.brightness);
  gl.uniform1f(uniforms.contrast, values.contrast);
  gl.uniform1f(uniforms.saturation, values.saturation);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function colorUniforms(visual: CompositeVisual) {
  return {
    opacity: visual.opacity,
    brightness: visual.brightness,
    contrast: visual.contrast,
    saturation: visual.saturation,
  };
}

// Draws the layer's source into a band-sized target exactly as it would
// appear in its band (cover, Layout anchor, scale, offset and rotation), so
// the effect chain works on what the band shows rather than on the whole
// source. Rows are written top row first to match uploaded video textures,
// which is the orientation the effect passes and the composite shader expect.
function renderLayerFrame(
  resources: WebGlResources,
  texture: WebGLTexture,
  placement: LayerPlacement,
  visual: CompositeVisual,
) {
  const { gl, effectChain } = resources;
  const { frame, halfExtents, translate, scissor } = placement;
  const target = effectChain.getLayerTarget(scissor.width, scissor.height);
  bindCompositeState(
    resources,
    target.framebuffer,
    scissor.width,
    scissor.height,
  );
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawQuad(resources, texture, {
    coverScale: [
      halfExtents.x / frame.halfWidth,
      -halfExtents.y / frame.halfHeight,
    ],
    translate: [
      (translate.x - frame.centerX) / frame.halfWidth,
      -(translate.y - frame.centerY) / frame.halfHeight,
    ],
    rotation: (-visual.rotationDeg * Math.PI) / 180,
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
  if (resources.fillTextureKeys.get(sourceKey) !== key) {
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
    resources.fillTextureKeys.set(sourceKey, key);
  }
  return texture;
}

export function drawComposition(
  resources: WebGlResources,
  surface: CompositeSurface,
  activeClips: CompositeLayer[],
  mediaRefs: Map<string, HTMLMediaElement>,
  groupChain: EffectChainStep[],
  frameContext: FrameContext,
) {
  const { gl, effectChain } = resources;
  const { width, height } = surface;
  effectChain.syncSurface(width, height);
  const groupSteps = effectChain.prepare(groupChain);
  const scene = groupSteps.length
    ? effectChain.getSceneTarget(width, height)
    : null;
  const compositeFramebuffer = scene?.framebuffer ?? null;
  bindCompositeState(resources, compositeFramebuffer, width, height);
  gl.clearColor(0.07, 0.08, 0.11, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const stackedClips = orderStackedLayers(
    activeClips.filter(
      (entry) =>
        entry.isInBounds &&
        (entry.fill ||
          mediaRefs.get(entry.sourceKey) instanceof HTMLVideoElement),
    ),
  );

  for (const [index, entry] of stackedClips.entries()) {
    const mediaElement = mediaRefs.get(entry.sourceKey);
    let sourceWidth: number;
    let sourceHeight: number;
    let texture: WebGLTexture;
    if (entry.fill) {
      // A fill is drawn at its band's own aspect, so it covers the band
      // exactly.
      sourceWidth = width;
      sourceHeight = height / stackedClips.length;
      texture = uploadFillTexture(
        resources,
        entry.sourceKey,
        entry.fill,
        sourceWidth,
        sourceHeight,
      );
    } else {
      if (!(mediaElement instanceof HTMLVideoElement)) {
        continue;
      }

      const uploaded = uploadVideoTexture(resources, entry, mediaElement);
      if (!uploaded) {
        continue;
      }
      texture = uploaded;
      sourceWidth = mediaElement.videoWidth || entry.media.width || width;
      sourceHeight = mediaElement.videoHeight || entry.media.height || height;
    }

    const placement = resolveLayerPlacement({
      index,
      count: stackedClips.length,
      canvasWidth: width,
      canvasHeight: height,
      sourceWidth,
      sourceHeight,
      visual: entry.visual,
    });
    const { frame, halfExtents, translate, scissor } = placement;
    let uniforms: CompositeUniforms = {
      coverScale: [halfExtents.x, halfExtents.y],
      translate: [translate.x, translate.y],
      rotation: (entry.visual.rotationDeg * Math.PI) / 180,
      ...colorUniforms(entry.visual),
    };

    const layerSteps = effectChain.prepare(entry.effectChain);
    if (layerSteps.length) {
      const framed = renderLayerFrame(
        resources,
        texture,
        placement,
        entry.visual,
      );
      texture =
        effectChain.run(framed, scissor.width, scissor.height, layerSteps, {
          time: frameContext.time,
          clipProgress: entry.clipProgress,
          resolution: [scissor.width, scissor.height],
          audioLow: frameContext.audio.low,
          audioHigh: frameContext.audio.high,
          impulseLow: frameContext.audio.impulseLow,
          impulseHigh: frameContext.audio.impulseHigh,
          // The framed layer is written top row first, like a layer texture.
          bottomUp: false,
        }) ?? framed;
      // The framed result already holds the layer's placement, so it fills
      // its band exactly.
      uniforms = {
        coverScale: [frame.halfWidth, frame.halfHeight],
        translate: [frame.centerX, frame.centerY],
        rotation: 0,
        ...colorUniforms(entry.visual),
      };
    }

    bindCompositeState(resources, compositeFramebuffer, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);
    drawQuad(resources, texture, uniforms);
  }

  gl.disable(gl.SCISSOR_TEST);
  if (scene) {
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
