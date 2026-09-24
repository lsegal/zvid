import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  type AudioBands,
  LiveAudioBands,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import { EffectChainRenderer } from "./fx-shaders/chain.ts";
import { linkProgram } from "./fx-shaders/gl.ts";
import {
  type EffectChainStep,
  isChainEffectName,
  resolveEffectChain,
} from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";

type MediaKind = "video" | "audio";

type MediaItem = {
  id: string;
  name: string;
  kind: MediaKind;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  previewUrl: string;
};

type Lane = {
  id: string;
  name: string;
  colorIndex: number;
  fxEnabled?: boolean;
};

type ArrangementClip = {
  id: string;
  sourceTrackId: string;
  laneId: string;
  label: string;
  mediaPath: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  tint: string;
  accent: string;
};

type SessionEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: Array<{
    key: string;
    value: string;
    numericValue?: number;
  }>;
  enabled?: boolean;
};

type VisualState = {
  opacity: number;
  scale: number;
  translateX: number;
  translateY: number;
  rotationDeg: number;
  brightness: number;
  contrast: number;
  saturation: number;
  layoutAnchor: "top" | "center" | "bottom";
};

type ActiveClip = {
  clip: ArrangementClip;
  media: MediaItem;
  mediaTime: number;
  isInBounds: boolean;
  laneRank: number;
  clipProgress: number;
  visual: VisualState;
  effectChain: EffectChainStep[];
};

type FrameContext = {
  time: number;
  audio: AudioBands;
};

type CompositionPlayerProps = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  playheadQ: number;
  bpm: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
  canvasWidth: number;
  canvasHeight: number;
  playheadSeconds: number;
  masterAudio?: MediaItem;
};

export type CompositionRendererState = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  bpm: number;
  canvasWidth: number;
  canvasHeight: number;
  masterAudio?: MediaItem;
};

type CompositionPlaybackState = {
  playheadQ: number;
  playheadSeconds: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
};

export type CompositionPlayerHandle = {
  getCanvas(): HTMLCanvasElement | null;
  renderFrameAt(playheadQ: number, playheadSeconds: number): Promise<void>;
  restorePreviewSurface(
    playheadQ: number,
    playheadSeconds: number,
  ): Promise<void>;
};

type WebGlResources = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  textureMap: Map<string, WebGLTexture>;
  readyTextureIds: Set<string>;
  effectChain: EffectChainRenderer;
  maxTextureSize: number;
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

const MAX_DRIFT_SECONDS = 0.18;
const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001;
const MEDIA_SEEK_TIMEOUT_MS = 4000;
const SCRUB_AUDIO_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS = 0.1;
const GROUP_TRACK_ID = "__group_main";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

function parseNumericValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUnitValue(value: number, fallback = 1) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (Math.abs(value) > 1.5 && Math.abs(value) <= 100) {
    return value / 100;
  }

  return value;
}

function parseLayoutAnchor(
  rawValue: string | undefined,
  numericValue?: number,
) {
  const value = rawValue?.trim().toLowerCase();
  if (value) {
    if (value.includes("top")) {
      return "top" as const;
    }

    if (value.includes("bottom")) {
      return "bottom" as const;
    }

    if (value.includes("center") || value.includes("middle")) {
      return "center" as const;
    }
  }

  if (numericValue !== undefined && Number.isFinite(numericValue)) {
    if (numericValue <= 0.333) {
      return "top" as const;
    }

    if (numericValue >= 0.667) {
      return "bottom" as const;
    }

    return "center" as const;
  }

  return undefined;
}

function resolveVisualState(
  effects: SessionEffect[],
  laneId: string,
): VisualState {
  const state: VisualState = {
    opacity: 1,
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotationDeg: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    layoutAnchor: "center",
  };

  for (const effect of effects) {
    if (effect.trackId !== laneId && effect.trackId !== GROUP_TRACK_ID) {
      continue;
    }

    // Shader-chain effects render their own passes, and a bypassed effect
    // contributes nothing.
    if (effect.enabled === false || isChainEffectName(effect.effectName)) {
      continue;
    }

    const isLayoutEffect = effect.effectName
      .trim()
      .toLowerCase()
      .includes("layout");

    for (const parameter of effect.parameters) {
      const key = parameter.key.toLowerCase();
      const rawValue = parameter.value?.trim();
      const numeric =
        parameter.numericValue ?? parseNumericValue(parameter.value);
      if (
        isLayoutEffect &&
        (key.includes("anchor") || key.includes("align") || key === "position")
      ) {
        const anchor = parseLayoutAnchor(rawValue, numeric);
        if (anchor) {
          state.layoutAnchor = anchor;
          continue;
        }
      }

      if (isLayoutEffect) {
        continue;
      }

      if (numeric === undefined) {
        continue;
      }

      if (key.includes("opacity") || key.includes("alpha") || key === "mix") {
        state.opacity = clamp(normalizeUnitValue(numeric), 0, 1);
      } else if (key.includes("scale") || key.includes("zoom")) {
        state.scale = clamp(numeric > 4 ? numeric / 100 : numeric, 0.1, 8);
      } else if (
        key === "x" ||
        key.includes("positionx") ||
        key.includes("translatex")
      ) {
        state.translateX = clamp(
          numeric > 1 || numeric < -1 ? numeric / 100 : numeric,
          -2,
          2,
        );
      } else if (
        key === "y" ||
        key.includes("positiony") ||
        key.includes("translatey")
      ) {
        state.translateY = clamp(
          numeric > 1 || numeric < -1 ? numeric / 100 : numeric,
          -2,
          2,
        );
      } else if (key.includes("rotation") || key.includes("rotate")) {
        state.rotationDeg = numeric;
      } else if (key.includes("brightness") || key.includes("exposure")) {
        state.brightness = clamp(normalizeUnitValue(numeric, 0), -1, 1);
      } else if (key.includes("contrast")) {
        state.contrast = clamp(numeric > 4 ? numeric / 100 : numeric, 0, 4);
      } else if (key.includes("saturation") || key.includes("sat")) {
        state.saturation = clamp(numeric > 4 ? numeric / 100 : numeric, 0, 4);
      }
    }
  }

  return state;
}

type FrameBounds = {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  aspect: number;
};

function resolveFrameBounds(
  index: number,
  slotCount: number,
  canvasAspect: number,
): FrameBounds {
  const normalizedSlotCount = Math.max(1, slotCount);
  const slotHeight = 2 / normalizedSlotCount;
  const halfHeight = slotHeight / 2;

  return {
    centerX: 0,
    centerY: 1 - slotHeight * (index + 0.5),
    halfWidth: 1,
    halfHeight,
    aspect: canvasAspect * normalizedSlotCount,
  };
}

function applyFrameScissor(
  gl: WebGLRenderingContext,
  canvas: HTMLCanvasElement,
  frame: FrameBounds,
) {
  const minX = clamp(
    Math.floor(((frame.centerX - frame.halfWidth + 1) * canvas.width) / 2),
    0,
    canvas.width,
  );
  const maxX = clamp(
    Math.ceil(((frame.centerX + frame.halfWidth + 1) * canvas.width) / 2),
    0,
    canvas.width,
  );
  const minY = clamp(
    Math.floor(((frame.centerY - frame.halfHeight + 1) * canvas.height) / 2),
    0,
    canvas.height,
  );
  const maxY = clamp(
    Math.ceil(((frame.centerY + frame.halfHeight + 1) * canvas.height) / 2),
    0,
    canvas.height,
  );

  gl.scissor(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
}

function computeActiveClips(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  effects: SessionEffect[],
) {
  const epsilon = 0.0001;
  const activeTimelineClips = clips.filter((clip) => {
    const clipEndQ = clip.startQ + (clip.durationSeconds * bpm) / 60;
    return playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon;
  });
  const highestBlockingLaneRank = activeTimelineClips.reduce(
    (maximum, clip) => {
      const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
      if (media?.previewUrl) {
        return maximum;
      }

      return Math.max(maximum, lanePriority.get(clip.laneId) ?? -1);
    },
    -1,
  );

  return activeTimelineClips
    .map((clip) => ({
      clip,
      media: clip.mediaId ? mediaById.get(clip.mediaId) : undefined,
    }))
    .filter((entry): entry is { clip: ArrangementClip; media: MediaItem } => {
      if (!entry.media?.previewUrl) {
        return false;
      }

      const laneRank = lanePriority.get(entry.clip.laneId) ?? -1;
      if (laneRank <= highestBlockingLaneRank) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const laneDelta =
        (lanePriority.get(left.clip.laneId) ?? Number.MAX_SAFE_INTEGER) -
        (lanePriority.get(right.clip.laneId) ?? Number.MAX_SAFE_INTEGER);
      if (laneDelta !== 0) {
        return laneDelta;
      }

      return left.clip.startQ - right.clip.startQ;
    })
    .map<ActiveClip>(({ clip, media }) => {
      const mediaTime =
        quartersToSeconds(playheadQ, bpm) + clip.sourceOffsetSeconds;
      const clipElapsedSeconds = quartersToSeconds(
        playheadQ - clip.startQ,
        bpm,
      );
      return {
        clip,
        media,
        mediaTime,
        isInBounds:
          mediaTime >= clip.sourceWindowStartSeconds &&
          mediaTime < clip.sourceWindowEndSeconds - epsilon &&
          (media.durationSeconds > 0
            ? mediaTime >= 0 && mediaTime < media.durationSeconds - epsilon
            : mediaTime >= 0),
        laneRank: lanePriority.get(clip.laneId) ?? -1,
        clipProgress:
          clip.durationSeconds > 0
            ? clamp(clipElapsedSeconds / clip.durationSeconds, 0, 1)
            : 0,
        visual: resolveVisualState(effects, clip.laneId),
        effectChain: resolveEffectChain(effects, clip.laneId),
      };
    });
}

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

function ensureWebGlResources(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl) {
    throw new Error("WebGL is unavailable on this device.");
  }

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

  const position = gl.getAttribLocation(program, "aPosition");
  const uniforms = {
    position,
    texture: gl.getUniformLocation(program, "uTexture"),
    coverScale: gl.getUniformLocation(program, "uCoverScale"),
    userScale: gl.getUniformLocation(program, "uUserScale"),
    translate: gl.getUniformLocation(program, "uTranslate"),
    rotation: gl.getUniformLocation(program, "uRotation"),
    opacity: gl.getUniformLocation(program, "uOpacity"),
    brightness: gl.getUniformLocation(program, "uBrightness"),
    contrast: gl.getUniformLocation(program, "uContrast"),
    saturation: gl.getUniformLocation(program, "uSaturation"),
  };

  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
  gl.useProgram(program);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    gl,
    program,
    positionBuffer,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    effectChain: new EffectChainRenderer(gl, positionBuffer),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    uniforms,
  } satisfies WebGlResources;
}

function getOrCreateTexture(resources: WebGlResources, id: string) {
  const existing = resources.textureMap.get(id);
  if (existing) {
    return existing;
  }

  const texture = resources.gl.createTexture();
  if (!texture) {
    throw new Error("Failed to allocate WebGL texture.");
  }

  resources.gl.bindTexture(resources.gl.TEXTURE_2D, texture);
  resources.gl.texParameteri(
    resources.gl.TEXTURE_2D,
    resources.gl.TEXTURE_WRAP_S,
    resources.gl.CLAMP_TO_EDGE,
  );
  resources.gl.texParameteri(
    resources.gl.TEXTURE_2D,
    resources.gl.TEXTURE_WRAP_T,
    resources.gl.CLAMP_TO_EDGE,
  );
  resources.gl.texParameteri(
    resources.gl.TEXTURE_2D,
    resources.gl.TEXTURE_MIN_FILTER,
    resources.gl.LINEAR,
  );
  resources.gl.texParameteri(
    resources.gl.TEXTURE_2D,
    resources.gl.TEXTURE_MAG_FILTER,
    resources.gl.LINEAR,
  );
  resources.textureMap.set(id, texture);
  return texture;
}

function disposeWebGlResources(resources: WebGlResources) {
  const { gl } = resources;
  resources.effectChain.dispose();
  for (const texture of resources.textureMap.values()) {
    gl.deleteTexture(texture);
  }
  resources.textureMap.clear();
  resources.readyTextureIds.clear();
  gl.deleteBuffer(resources.positionBuffer);
  gl.deleteProgram(resources.program);
}

function bindCompositeState(
  resources: WebGlResources,
  canvas: HTMLCanvasElement,
  framebuffer: WebGLFramebuffer | null,
) {
  const { gl } = resources;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, canvas.width, canvas.height);
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
  gl.useProgram(resources.program);
  gl.enable(gl.BLEND);
}

// Effects run at the layer's native size, reduced to what covering the whole
// canvas needs, so large sources don't pay for pixels that are never shown.
function resolveEffectSurface(
  resources: WebGlResources,
  canvas: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
) {
  const coverScale = Math.min(
    1,
    Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight),
  );
  const width = Math.round(sourceWidth * coverScale);
  const height = Math.round(sourceHeight * coverScale);
  const fit = Math.min(
    1,
    resources.maxTextureSize / Math.max(width, height, 1),
  );
  return {
    width: Math.max(1, Math.floor(width * fit)),
    height: Math.max(1, Math.floor(height * fit)),
  };
}

function drawComposition(
  resources: WebGlResources,
  canvas: HTMLCanvasElement,
  activeClips: ActiveClip[],
  mediaRefs: Map<string, HTMLMediaElement>,
  groupChain: EffectChainStep[],
  frameContext: FrameContext,
) {
  const { gl, uniforms, effectChain } = resources;
  effectChain.syncSurface(canvas.width, canvas.height);
  const groupSteps = effectChain.prepare(groupChain);
  const scene = groupSteps.length
    ? effectChain.getSceneTarget(canvas.width, canvas.height)
    : null;
  const compositeFramebuffer = scene?.framebuffer ?? null;
  bindCompositeState(resources, canvas, compositeFramebuffer);
  gl.clearColor(0.07, 0.08, 0.11, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);

  const canvasAspect = canvas.width / Math.max(1, canvas.height);
  const stackedClips = [...activeClips]
    .filter(
      (entry) =>
        entry.isInBounds &&
        mediaRefs.get(entry.media.id) instanceof HTMLVideoElement,
    )
    .sort((left, right) => {
      if (right.laneRank !== left.laneRank) {
        return right.laneRank - left.laneRank;
      }

      return left.clip.startQ - right.clip.startQ;
    });

  for (const [index, entry] of stackedClips.entries()) {
    const mediaElement = mediaRefs.get(entry.media.id);
    if (!(mediaElement instanceof HTMLVideoElement)) {
      continue;
    }

    let texture = getOrCreateTexture(resources, entry.media.id);
    const hasDecodedFrame =
      mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      (mediaElement.videoWidth > 0 || Boolean(entry.media.width)) &&
      (mediaElement.videoHeight > 0 || Boolean(entry.media.height));

    if (hasDecodedFrame) {
      resources.readyTextureIds.add(entry.media.id);
    } else if (!resources.readyTextureIds.has(entry.media.id)) {
      continue;
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

    const videoWidth =
      mediaElement.videoWidth || entry.media.width || canvas.width;
    const videoHeight =
      mediaElement.videoHeight || entry.media.height || canvas.height;
    const videoAspect = videoWidth / Math.max(1, videoHeight);
    const frame = resolveFrameBounds(index, stackedClips.length, canvasAspect);
    const coverHalfExtents =
      videoAspect > frame.aspect
        ? {
            x:
              (frame.halfHeight * videoAspect) / Math.max(canvasAspect, 0.0001),
            y: frame.halfHeight,
          }
        : {
            x: frame.halfWidth,
            y: (frame.halfWidth * canvasAspect) / Math.max(videoAspect, 0.0001),
          };
    const layoutScale = Math.max(1, entry.visual.scale);
    const scaledHalfExtents = {
      x: coverHalfExtents.x * layoutScale,
      y: coverHalfExtents.y * layoutScale,
    };
    const anchorOffsetY =
      entry.visual.layoutAnchor === "top"
        ? frame.halfHeight - scaledHalfExtents.y
        : entry.visual.layoutAnchor === "bottom"
          ? scaledHalfExtents.y - frame.halfHeight
          : 0;
    const layerSteps = effectChain.prepare(entry.effectChain);
    if (layerSteps.length) {
      const surface = resolveEffectSurface(
        resources,
        canvas,
        videoWidth,
        videoHeight,
      );
      texture =
        effectChain.run(texture, surface.width, surface.height, layerSteps, {
          time: frameContext.time,
          clipProgress: entry.clipProgress,
          resolution: [surface.width, surface.height],
          audioLow: frameContext.audio.low,
          audioHigh: frameContext.audio.high,
        }) ?? texture;
      bindCompositeState(resources, canvas, compositeFramebuffer);
      gl.enable(gl.SCISSOR_TEST);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    const translateX =
      frame.centerX + entry.visual.translateX * frame.halfWidth;
    const translateY =
      frame.centerY +
      anchorOffsetY +
      entry.visual.translateY * frame.halfHeight;

    applyFrameScissor(gl, canvas, frame);
    gl.uniform1i(uniforms.texture, 0);
    gl.uniform2f(uniforms.coverScale, scaledHalfExtents.x, scaledHalfExtents.y);
    gl.uniform1f(uniforms.userScale, 1);
    gl.uniform2f(uniforms.translate, translateX, translateY);
    gl.uniform1f(uniforms.rotation, (entry.visual.rotationDeg * Math.PI) / 180);
    gl.uniform1f(uniforms.opacity, entry.visual.opacity);
    gl.uniform1f(uniforms.brightness, entry.visual.brightness);
    gl.uniform1f(uniforms.contrast, entry.visual.contrast);
    gl.uniform1f(uniforms.saturation, entry.visual.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  gl.disable(gl.SCISSOR_TEST);
  if (scene) {
    effectChain.run(
      scene.texture,
      canvas.width,
      canvas.height,
      groupSteps,
      {
        time: frameContext.time,
        clipProgress: 0,
        resolution: [canvas.width, canvas.height],
        audioLow: frameContext.audio.low,
        audioHigh: frameContext.audio.high,
      },
      "screen",
    );
    bindCompositeState(resources, canvas, null);
  }
}

function syncCanvasSurface(
  canvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  pixelRatio: number,
) {
  const nextWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
}

function seekMediaElement(element: HTMLMediaElement, targetSeconds: number) {
  const clampedTarget = Math.max(0, targetSeconds);
  const drift = Math.abs(element.currentTime - clampedTarget);
  if (drift <= MEDIA_SEEK_TOLERANCE_SECONDS) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", settle);
      element.removeEventListener("error", settle);
      element.removeEventListener("loadeddata", settle);
      resolve();
    };

    timeoutId = window.setTimeout(settle, MEDIA_SEEK_TIMEOUT_MS);
    element.addEventListener("seeked", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
    element.addEventListener("loadeddata", settle, { once: true });

    try {
      element.pause();
      element.currentTime = clampedTarget;
    } catch {
      settle();
    }
  });
}

// "live" reads the master audio element as it plays (preview). "offline"
// decodes the master audio and measures it at each rendered frame (export).
export type AudioAnalysisMode = "live" | "offline";

export class CompositionRenderer {
  readonly canvas: HTMLCanvasElement;

  private resources: WebGlResources | null = null;
  private mediaRefs = new Map<string, HTMLMediaElement>();
  private masterAudioElement: HTMLAudioElement | null = null;
  private removeVideoFrameReadyListeners: Array<() => void> = [];
  private videoFrameReadyListener: (() => void) | null = null;
  private state: CompositionRendererState;
  private activeClips: ActiveClip[] = [];
  private readonly audioAnalysis: AudioAnalysisMode;
  private liveAudioBands: LiveAudioBands | null = null;
  private offlineAudioBands: {
    url: string;
    bands: Promise<OfflineAudioBands | null>;
  } | null = null;

  constructor(
    state: CompositionRendererState,
    options: {
      canvas?: HTMLCanvasElement;
      audioAnalysis?: AudioAnalysisMode;
    } = {},
  ) {
    this.canvas = options.canvas ?? document.createElement("canvas");
    this.audioAnalysis = options.audioAnalysis ?? "live";
    this.state = state;
    this.update(state);
  }

  update(state: CompositionRendererState) {
    this.state = state;
    this.syncMediaElements();
  }

  destroy() {
    this.clearVideoFrameReadyListeners();
    this.liveAudioBands?.dispose();
    this.liveAudioBands = null;
    this.offlineAudioBands = null;
    if (this.resources) {
      disposeWebGlResources(this.resources);
      this.resources = null;
    }

    for (const element of this.mediaRefs.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.mediaRefs.clear();

    if (this.masterAudioElement) {
      this.masterAudioElement.pause();
      this.masterAudioElement.removeAttribute("src");
      this.masterAudioElement.load();
      this.masterAudioElement = null;
    }
  }

  renderPreviewFrame(playheadQ: number, pixelRatio: number) {
    this.ensureResources();
    this.activeClips = this.computeActiveClips(playheadQ);
    this.draw(this.activeClips, pixelRatio, {
      time: quartersToSeconds(playheadQ, this.state.bpm),
      audio:
        this.liveAudioBands?.sample(performance.now()) ?? SILENT_AUDIO_BANDS,
    });
  }

  async renderFrameAt(
    playheadQ: number,
    playheadSeconds: number,
    pixelRatio = 1,
  ) {
    this.ensureResources();
    syncCanvasSurface(
      this.canvas,
      this.state.canvasWidth,
      this.state.canvasHeight,
      pixelRatio,
    );

    const nextActiveClips = this.computeActiveClips(playheadQ);
    const pendingSeeks = new Map<string, Promise<void>>();

    for (const entry of nextActiveClips) {
      if (!entry.isInBounds) {
        continue;
      }

      const mediaElement = this.mediaRefs.get(entry.media.id);
      if (!(mediaElement instanceof HTMLVideoElement)) {
        continue;
      }

      pendingSeeks.set(
        entry.media.id,
        seekMediaElement(mediaElement, entry.mediaTime),
      );
    }

    if (pendingSeeks.size) {
      await Promise.all(pendingSeeks.values());
    }

    const audio = await this.sampleAudioBandsAt(playheadSeconds);

    if (this.masterAudioElement && this.state.masterAudio?.previewUrl) {
      this.masterAudioElement.pause();
      this.masterAudioElement.currentTime = playheadSeconds;
    }

    this.activeClips = nextActiveClips;
    this.draw(nextActiveClips, pixelRatio, { time: playheadSeconds, audio });
  }

  syncPlayback(playback: CompositionPlaybackState) {
    const isContinuousScrubAudio =
      playback.isAudibleScrubbing && playback.isContinuousScrubbing;
    const activeClipByMediaId = new Map(
      this.computeActiveClips(playback.playheadQ).map((entry) => [
        entry.media.id,
        entry,
      ]),
    );

    for (const item of this.state.mediaItems) {
      const element = this.mediaRefs.get(item.id);
      if (!element) {
        continue;
      }

      const activeEntry = activeClipByMediaId.get(item.id);
      if (!activeEntry?.isInBounds) {
        if (!element.paused) {
          element.pause();
        }
        continue;
      }

      const drift = Math.abs(element.currentTime - activeEntry.mediaTime);
      const needsSeek =
        isContinuousScrubAudio && item.kind !== "video"
          ? drift > CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS
          : !playback.isPlaying ||
            playback.isScrubbing ||
            drift > MAX_DRIFT_SECONDS;
      if (needsSeek) {
        element.currentTime = activeEntry.mediaTime;
      }

      const shouldPlay =
        item.kind === "video"
          ? playback.isPlaying
          : playback.isPlaying || playback.isAudibleScrubbing;
      if (shouldPlay) {
        element.play().catch(() => {});
      } else if (!element.paused) {
        element.pause();
      }
    }

    const audio = this.masterAudioElement;
    if (!audio || !this.state.masterAudio?.previewUrl) {
      return;
    }

    const shouldPlay = playback.isPlaying || playback.isAudibleScrubbing;
    if (shouldPlay) {
      this.liveAudioBands?.resume();
    }
    const driftTolerance = isContinuousScrubAudio
      ? CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS
      : playback.isAudibleScrubbing
        ? SCRUB_AUDIO_DRIFT_SECONDS
        : MAX_DRIFT_SECONDS;
    const drift = Math.abs(audio.currentTime - playback.playheadSeconds);
    if (!shouldPlay || drift > driftTolerance) {
      audio.currentTime = playback.playheadSeconds;
    }

    if (shouldPlay) {
      audio.play().catch(() => {});
    } else if (!audio.paused) {
      audio.pause();
    }
  }

  addVideoFrameReadyListeners(scheduleDraw: () => void) {
    this.videoFrameReadyListener = scheduleDraw;
    this.refreshVideoFrameReadyListeners();

    return () => {
      if (this.videoFrameReadyListener === scheduleDraw) {
        this.videoFrameReadyListener = null;
        this.clearVideoFrameReadyListeners();
      }
    };
  }

  private ensureResources() {
    if (!this.resources) {
      this.resources = ensureWebGlResources(this.canvas);
    }
  }

  private computeActiveClips(playheadQ: number) {
    const mediaById = new Map(
      this.state.mediaItems.map((item) => [item.id, item]),
    );
    const lanePriority = new Map(
      this.state.lanes.map((lane, index) => [lane.id, index]),
    );

    return computeActiveClips(
      this.state.clips,
      mediaById,
      playheadQ,
      this.state.bpm,
      lanePriority,
      this.renderedEffects(),
    );
  }

  // Effects on layers whose FX switch is off are left out, apart from their
  // Layout anchoring.
  private renderedEffects() {
    return getRenderedEffects(this.state.effects, this.state.lanes);
  }

  private usesAudioBands() {
    return this.renderedEffects().some(
      (effect) =>
        effect.enabled !== false && isChainEffectName(effect.effectName),
    );
  }

  private async sampleAudioBandsAt(playheadSeconds: number) {
    if (this.audioAnalysis === "live") {
      return (
        this.liveAudioBands?.sample(performance.now()) ?? SILENT_AUDIO_BANDS
      );
    }

    const url = this.state.masterAudio?.previewUrl;
    if (!url || !this.usesAudioBands()) {
      return SILENT_AUDIO_BANDS;
    }

    if (this.offlineAudioBands?.url !== url) {
      this.offlineAudioBands = {
        url,
        bands: OfflineAudioBands.decode(url).catch((error) => {
          console.warn("Export renders effects without audio bands.", error);
          return null;
        }),
      };
    }

    const bands = await this.offlineAudioBands.bands;
    return bands?.at(playheadSeconds) ?? SILENT_AUDIO_BANDS;
  }

  private syncLiveAudioBands() {
    if (this.audioAnalysis !== "live") {
      return;
    }

    if (this.masterAudioElement && this.usesAudioBands()) {
      this.liveAudioBands ??= new LiveAudioBands();
    }
    // Once routed through Web Audio the element must stay attached, or it
    // would go silent, so the analyser follows the element even after the
    // effects that needed it are removed.
    this.liveAudioBands?.attach(this.masterAudioElement);
  }

  private draw(
    activeClips: ActiveClip[],
    pixelRatio: number,
    frameContext: FrameContext,
  ) {
    this.ensureResources();
    syncCanvasSurface(
      this.canvas,
      this.state.canvasWidth,
      this.state.canvasHeight,
      pixelRatio,
    );
    drawComposition(
      this.resources as WebGlResources,
      this.canvas,
      activeClips,
      this.mediaRefs,
      resolveEffectChain(this.state.effects, GROUP_TRACK_ID),
      frameContext,
    );
  }

  private syncMediaElements() {
    const activeIds = new Set(this.state.mediaItems.map((item) => item.id));
    for (const [id, element] of this.mediaRefs) {
      if (!activeIds.has(id)) {
        element.pause();
        element.removeAttribute("src");
        element.load();
        this.mediaRefs.delete(id);
      }
    }

    for (const item of this.state.mediaItems) {
      let element = this.mediaRefs.get(item.id);
      if (!element) {
        element =
          item.kind === "video"
            ? document.createElement("video")
            : document.createElement("audio");
        element.crossOrigin = "anonymous";
        element.preload = "auto";
        if (element instanceof HTMLVideoElement) {
          element.muted = true;
          element.playsInline = true;
        }
        this.mediaRefs.set(item.id, element);
      }

      if (element.getAttribute("src") !== item.previewUrl) {
        element.src = item.previewUrl;
      }
    }

    if (this.state.masterAudio?.previewUrl) {
      if (!this.masterAudioElement) {
        this.masterAudioElement = document.createElement("audio");
        this.masterAudioElement.crossOrigin = "anonymous";
        this.masterAudioElement.preload = "auto";
      }
      if (
        this.masterAudioElement.getAttribute("src") !==
        this.state.masterAudio.previewUrl
      ) {
        this.masterAudioElement.src = this.state.masterAudio.previewUrl;
      }
    } else if (this.masterAudioElement) {
      this.masterAudioElement.pause();
      this.masterAudioElement.removeAttribute("src");
      this.masterAudioElement.load();
      this.masterAudioElement = null;
    }

    this.syncLiveAudioBands();
    this.refreshVideoFrameReadyListeners();
  }

  private refreshVideoFrameReadyListeners() {
    const scheduleDraw = this.videoFrameReadyListener;
    this.clearVideoFrameReadyListeners();
    if (!scheduleDraw) {
      return;
    }

    for (const element of this.mediaRefs.values()) {
      if (!(element instanceof HTMLVideoElement)) {
        continue;
      }

      const handleFrameReady = () => scheduleDraw();
      element.addEventListener("seeked", handleFrameReady);
      element.addEventListener("loadeddata", handleFrameReady);
      this.removeVideoFrameReadyListeners.push(() => {
        element.removeEventListener("seeked", handleFrameReady);
        element.removeEventListener("loadeddata", handleFrameReady);
      });
    }
  }

  private clearVideoFrameReadyListeners() {
    for (const removeListener of this.removeVideoFrameReadyListeners) {
      removeListener();
    }
    this.removeVideoFrameReadyListeners = [];
  }
}

export const CompositionPlayer = forwardRef<
  CompositionPlayerHandle,
  CompositionPlayerProps
>(function CompositionPlayer(
  {
    mediaItems,
    clips,
    lanes,
    effects,
    playheadQ,
    bpm,
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
    canvasWidth,
    canvasHeight,
    playheadSeconds,
    masterAudio,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CompositionRenderer | null>(null);
  const playbackFrameRef = useRef<number>(0);
  const renderRequestRef = useRef<number>(0);
  const rendererState = useMemo(
    () => ({
      mediaItems,
      clips,
      lanes,
      effects,
      bpm,
      canvasWidth,
      canvasHeight,
      masterAudio,
    }),
    [
      bpm,
      canvasHeight,
      canvasWidth,
      clips,
      effects,
      lanes,
      masterAudio,
      mediaItems,
    ],
  );
  const rendererStateRef = useRef(rendererState);
  rendererStateRef.current = rendererState;

  const drawCurrentFrame = useCallback(
    (pixelRatio: number) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      renderer.renderPreviewFrame(playheadQ, pixelRatio);
    },
    [playheadQ],
  );

  const scheduleDraw = useCallback(
    (pixelRatio = window.devicePixelRatio || 1) => {
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current);
      }

      renderRequestRef.current = window.requestAnimationFrame(() => {
        renderRequestRef.current = 0;
        drawCurrentFrame(pixelRatio);
      });
    },
    [drawCurrentFrame],
  );
  const scheduleDrawRef = useRef(scheduleDraw);
  scheduleDrawRef.current = scheduleDraw;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const renderFrameAt = useCallback(
    async (
      nextPlayheadQ: number,
      nextPlayheadSeconds: number,
      pixelRatio: number,
    ) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) {
        return;
      }

      await renderer.renderFrameAt(
        nextPlayheadQ,
        nextPlayheadSeconds,
        pixelRatio,
      );
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
      renderFrameAt: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(nextPlayheadQ, nextPlayheadSeconds, 1),
      restorePreviewSurface: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(
          nextPlayheadQ,
          nextPlayheadSeconds,
          window.devicePixelRatio || 1,
        ),
    }),
    [renderFrameAt],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    rendererRef.current = new CompositionRenderer(rendererStateRef.current, {
      canvas,
    });

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current);
      }
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(rendererState);
    // A paused preview only redraws on request, so edits such as effect or
    // layer FX bypasses would otherwise not show until the playhead moves.
    if (!isPlayingRef.current) {
      scheduleDrawRef.current();
    }
  }, [rendererState]);

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    scheduleDraw();
  }, [isPlaying, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendererRef.current) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;

    const render = () => {
      if (!canvasRef.current || !rendererRef.current) {
        return;
      }

      drawCurrentFrame(pixelRatio);
      if (isPlaying) {
        playbackFrameRef.current = window.requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }
    };
  }, [drawCurrentFrame, isPlaying]);

  useEffect(() => {
    return rendererRef.current?.addVideoFrameReadyListeners(scheduleDraw);
  }, [scheduleDraw]);

  useEffect(() => {
    rendererRef.current?.syncPlayback({
      playheadQ,
      playheadSeconds,
      isPlaying,
      isScrubbing,
      isAudibleScrubbing,
      isContinuousScrubbing,
    });
  }, [
    isAudibleScrubbing,
    isContinuousScrubbing,
    isPlaying,
    isScrubbing,
    playheadQ,
    playheadSeconds,
  ]);

  return (
    <div className="composition-player">
      <canvas className="composition-player__canvas" ref={canvasRef} />
    </div>
  );
});
