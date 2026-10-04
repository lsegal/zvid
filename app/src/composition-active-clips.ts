// Works out which clips the compositor draws at a playhead: at most one clip
// per lane under the playhead whose media is online, in lane order, with the
// source time, visual state and effect chain each one is drawn with. Fill
// and text clips have no media and are always drawable, painted by a Color
// effect or styled by a Text effect. FX clips have no media either: they draw
// nothing and instead apply their own clip stack to what is beneath them.
//
// Effects come from three stacks, resolved Global -> Layer -> Clip: the
// clip's own stack (`clip:<clipId>`), its layer's stack and the Global
// stack. A clip is rendered in this order (preview and export alike):
//
//   1. its source: the media frame, the fill's paint or the text raster;
//      content effects (Text, Color) on the clip win over the layer's;
//   2. the clip's shader-chain effects (Colorize, Pixelate, ...), in stack
//      order, on the clip's framed pixels;
//   3. the layer's shader-chain effects, in stack order, on the result;
//   4. geometry: the clip's Transform places the clip inside its layer's
//      box, and the layer's Transform then places that box (the Layout
//      anchor is the layer's own). Moves are Transforms animated over each
//      clip's progress, nested with their stack's Transform in stack order;
//   5. compositing by the Global Order, then the Global chain on the whole
//      composite.
//
// An FX clip draws nothing and takes no Order slot. Its own stack's chain
// runs on the composite of the layers beneath it (higher-numbered layers),
// within the canvas or the box its Transforms move the canvas to, before the
// layers above it are drawn. An Order on its stack arranges those layers
// inside that box first, in place of the Global Order (the nearest such FX
// clip above a layer wins); the rest of its chain then runs on the result.
//
// A Mask on the clip's or its layer's stack multiplies what the clip draws
// by the alpha its Target layer draws at each canvas pixel, or by 1 minus
// it when Subtractive (see fx/effects/mask/mask.ts).
//
// Other visual parameters (opacity and the like) read Global, then Layer,
// then Clip, so the most specific stack wins.
import type { ClipWarp } from "./clip-warp.ts";
import {
  computeActiveClipTimings,
  quartersToSeconds,
} from "./composition-clip-timing.ts";
import {
  clipStackEffects,
  type EffectIndex,
  indexEffects,
  isEffectIndex,
} from "./composition-effect-index.ts";
import {
  type CompositionOrder,
  findOrderEffect,
  isOrderEffectName,
  type OrderSlide,
  parseCompositionOrder,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import { getCompositionEndQ } from "./composition-progress.ts";
import {
  isMoveEffectName,
  isTransformEffectName,
  type LayerTransform,
  parseLayerMove,
  parseLayerTransform,
  resolveMoveTransform,
  type TransformMotion,
} from "./composition-transform.ts";
import {
  type FillPaint,
  isColorEffectName,
  resolveFillPaint,
} from "./fill-paint.ts";
import {
  findLayerMask,
  isMaskEffectName,
  type LayerMask,
} from "./fx/effects/mask/mask.ts";
import {
  type AnimationClipContext,
  reactsToAudio,
  resolveAnimatedEffects,
  withPlacedOnsets,
} from "./fx-animation.ts";
import {
  clipSessionEdges,
  resolveOrderSlide,
  type SessionEdges,
} from "./fx-animation-clip.ts";
import type { EffectAnimation } from "./fx-animation-defaults.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";
import {
  type EffectChainStep,
  isChainEffectName,
  resolveEffectChain,
} from "./fx-shaders/registry.ts";
import { clipEffectTrackId } from "./fx-stack.ts";
import {
  isTextEffectName,
  resolveTextStyle,
  type TextStyle,
} from "./text-style.ts";
import type { MeterSignature } from "./timeline-format.ts";

export type MediaKind = "video" | "audio";

export type MediaItem = {
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

export type Lane = {
  id: string;
  name: string;
  colorIndex: number;
  fxEnabled?: boolean;
};

export type ArrangementClip = {
  id: string;
  // "fill", "text" or "fx" for a media-less fill, text or FX clip; media
  // clips leave it unset.
  kind?: "fill" | "text" | "fx";
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
  // Present when the clip's source follows warp markers instead of playing
  // at 1×.
  warp?: ClipWarp;
  tint: string;
  accent: string;
  // Set when this is one piece of a layer clip (see render-clips.ts): the
  // whole clip's timing, which its animations run over.
  layerClipStartQ?: number;
  layerClipDurationSeconds?: number;
};

export type SessionEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: Array<{
    key: string;
    value: string;
    numericValue?: number;
  }>;
  enabled?: boolean;
  animation?: EffectAnimation;
};

export type VisualState = {
  opacity: number;
  scale: number;
  translateX: number;
  translateY: number;
  rotationDeg: number;
  brightness: number;
  contrast: number;
  saturation: number;
  layoutAnchor: "top" | "center" | "bottom";
  // Set only when the layer's own stack has an enabled Transform.
  transform?: LayerTransform;
  // Set only when the clip's own stack has an enabled Transform. It places
  // the clip inside the layer's transformed box.
  clipTransform?: LayerTransform;
  // Set only when the layer's (`motion`) or the clip's own (`clipMotion`)
  // stack has an enabled Move: its Moves at the clip's progress, around and
  // inside that stack's Transform.
  motion?: TransformMotion;
  clipMotion?: TransformMotion;
};

export type ActiveClip = {
  clip: ArrangementClip;
  media: MediaItem;
  // The media element this clip is drawn from. Clips that share a media at
  // the same playhead each get their own element, since one element can only
  // show one time.
  sourceKey: string;
  mediaTime: number;
  // Source seconds per song second at the playhead: 1 unless warped.
  playbackRate: number;
  isInBounds: boolean;
  laneRank: number;
  clipProgress: number;
  // The clip's ends on the session's, which Clip-mode animations skip.
  sessionEdges: SessionEdges;
  visual: VisualState;
  // The clip's chain steps, then its layer's.
  effectChain: EffectChainStep[];
  // Set for fill clips, which draw this paint instead of a media element.
  fill?: FillPaint;
  // Set for text clips, which draw this text instead of a media element.
  text?: TextStyle;
  // Set for FX clips, which draw nothing and instead run `effectChain` on
  // the composite beneath them.
  fx?: true;
  // Set for FX clips with an enabled Order, which arranges the layers
  // beneath them.
  order?: CompositionOrder;
  // Set for clips whose layer or own stack has an enabled Mask with a
  // Target: the layer whose drawn pixels show or hide this one.
  mask?: LayerMask;
};

export const GROUP_TRACK_ID = "__group_main";

// The frame rate of a session that doesn't say.
export const DEFAULT_FPS = 30;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export { quartersToSeconds };

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

// The effects with the clip's own stack moved last, so it overrides its
// layer's and the Global stack's.
function withClipStackLast(
  effects: SessionEffect[],
  clipTrackId: string | undefined,
) {
  return clipTrackId === undefined
    ? effects
    : [
        ...effects.filter((effect) => effect.trackId !== clipTrackId),
        ...effects.filter((effect) => effect.trackId === clipTrackId),
      ];
}

type TransformMotionDraft = {
  outer: LayerTransform[];
  inner: LayerTransform[];
};

export function resolveVisualState(
  effects: SessionEffect[],
  laneId: string,
  // The clip's own stack, when the state is for a clip.
  clipId?: string,
  // How far through the clip the playhead is (0..1), for its Moves.
  clipProgress = 0,
): VisualState {
  const clipTrackId =
    clipId === undefined ? undefined : clipEffectTrackId(clipId);
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
  const layerMotion: TransformMotionDraft = { outer: [], inner: [] };
  const clipMotion: TransformMotionDraft = { outer: [], inner: [] };

  for (const effect of withClipStackLast(effects, clipTrackId)) {
    if (
      effect.trackId !== laneId &&
      effect.trackId !== GROUP_TRACK_ID &&
      effect.trackId !== clipTrackId
    ) {
      continue;
    }

    // Shader-chain effects render their own passes, the Color and Text
    // effects only style fill and text clips, and a bypassed effect
    // contributes nothing.
    if (
      effect.enabled === false ||
      isChainEffectName(effect.effectName) ||
      isColorEffectName(effect.effectName) ||
      isTextEffectName(effect.effectName)
    ) {
      continue;
    }

    // Order arranges every layer at once, and Mask reads another layer's
    // pixels; the compositor reads them itself.
    if (
      isOrderEffectName(effect.effectName) ||
      isMaskEffectName(effect.effectName)
    ) {
      continue;
    }

    // Transform is per layer or clip and read by its exact keys, which the
    // name heuristics below would misread ("PositionX" as an offset, and so
    // on). The last enabled one in each stack wins.
    if (isTransformEffectName(effect.effectName)) {
      let motion: TransformMotionDraft | undefined;
      if (effect.trackId === laneId) {
        state.transform = parseLayerTransform(effect.parameters);
        motion = layerMotion;
      } else if (effect.trackId === clipTrackId) {
        state.clipTransform = parseLayerTransform(effect.parameters);
        motion = clipMotion;
      }
      // The Moves so far are outside the stack's Transform, which is this
      // one unless a later one replaces it.
      motion?.outer.push(...motion.inner.splice(0));
      continue;
    }

    // A Move is a Transform at the clip's progress, nested in stack order
    // with the stack's Transform: inside it when after it in the stack, and
    // around it when before it. Each Move in a stack applies.
    if (isMoveEffectName(effect.effectName)) {
      if (effect.trackId === GROUP_TRACK_ID) {
        continue;
      }
      const isLayer = effect.trackId === laneId;
      const hasTransform = isLayer
        ? state.transform !== undefined
        : state.clipTransform !== undefined;
      const motion = isLayer ? layerMotion : clipMotion;
      (hasTransform ? motion.inner : motion.outer).push(
        resolveMoveTransform(parseLayerMove(effect.parameters), clipProgress),
      );
      continue;
    }

    const isLayoutEffect = effect.effectName
      .trim()
      .toLowerCase()
      .includes("layout");
    // Layout is per layer: the anchor comes only from the layer's own stack.
    if (isLayoutEffect && effect.trackId !== laneId) {
      continue;
    }

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

  if (layerMotion.outer.length || layerMotion.inner.length) {
    state.motion = layerMotion;
  }
  if (clipMotion.outer.length || clipMotion.inner.length) {
    state.clipMotion = clipMotion;
  }
  return state;
}

// Whether `effect` needs the audio mix's bands. Only Reactive animations
// follow them; shader passes never read the mix (see EffectContext).
export function effectUsesAudio(effect: SessionEffect) {
  return effect.enabled !== false && reactsToAudio(effect);
}

// The analyser the preview measures the mix through: none while no effect
// reacts to it, so a session without such effects analyzes no audio.
export function liveBandsAnalyser<T>(
  effects: readonly SessionEffect[],
  analyser: T | null,
) {
  return effects.some(effectUsesAudio) ? analyser : null;
}

export function computeActiveClips(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  // The session's effects, or them indexed once per state change.
  sessionEffects: SessionEffect[] | EffectIndex<SessionEffect>,
  // The session's frame rate, which animation timings are counted in.
  fps = DEFAULT_FPS,
  // The audio mix at this frame, for effects that react to it.
  audio?: AudioBands,
  // The session's length (Live's loop end or the last clip end from an
  // import), as the wand and export use it. Without one the session ends
  // with its last clip.
  projectDurationFrames?: number,
  // The session's time signature, which synced LFO animations follow.
  signature?: MeterSignature,
): ActiveClip[] {
  const effectIndex = isEffectIndex(sessionEffects)
    ? sessionEffects
    : indexEffects(sessionEffects);
  const sessionEndSeconds =
    projectDurationFrames && projectDurationFrames > 0 && fps > 0
      ? projectDurationFrames / fps
      : quartersToSeconds(getCompositionEndQ(clips, bpm), bpm);

  // Shared by every clip, so the frame's hits are placed once.
  const frameContext = withPlacedOnsets({
    playheadQ,
    bpm,
    fps,
    audio,
    signature,
  });
  return computeActiveClipTimings(
    clips,
    mediaById,
    playheadQ,
    bpm,
    lanePriority,
  ).map<ActiveClip>((timing) => {
    const { clip } = timing;
    const animationTiming = getAnimationTiming(clip);
    const sessionEdges = clipSessionEdges(
      quartersToSeconds(animationTiming.startQ, bpm),
      animationTiming.durationSeconds,
      sessionEndSeconds,
      fps,
    );
    const clipContext = animationClipContext(
      clip,
      playheadQ,
      bpm,
      sessionEdges,
    );
    const clipProgress = clipContext.progress;
    const clipTrackId = clipEffectTrackId(clip.id);
    // The parameters the clip's stacks are drawn with for this clip and
    // frame, so a layer or Global effect animates with each clip on its own.
    // Other clips' and layers' stacks never apply to it.
    const effects = resolveAnimatedEffects(
      clipStackEffects(effectIndex, clip.laneId, clipTrackId),
      clipContext,
      frameContext,
    );
    const resolved = {
      ...timing,
      clipProgress,
      sessionEdges,
      visual: resolveVisualState(effects, clip.laneId, clip.id, clipProgress),
    };
    if (clip.kind === "fx") {
      // Only the FX clip's own stack adjusts what is beneath it, so an FX
      // clip without effects changes nothing.
      return {
        ...resolved,
        effectChain: resolveEffectChain(effects, clipTrackId),
        fx: true,
        ...withOrder(
          findAnimatedOrder(effects, clipTrackId, fps, {
            elapsedSeconds: clipContext.elapsedSeconds,
            remainingSeconds:
              clipContext.durationSeconds - clipContext.elapsedSeconds,
          }),
        ),
      };
    }

    const mask = findLayerMask(effects, clip.laneId, clipTrackId);
    return {
      ...resolved,
      effectChain: resolveClipEffectChain(effects, clip),
      ...(mask ? { mask } : {}),
      ...(clip.kind === "text"
        ? { text: resolveTextStyle(effects, clip.laneId, clipTrackId) }
        : clip.kind === "fill"
          ? { fill: resolveFillPaint(effects, clip.laneId, clipTrackId) }
          : {}),
    };
  });
}

// When `clip` starts and how long it lasts as its animations see it: a
// piece of a layer clip animates over the whole clip.
function getAnimationTiming(
  clip: Pick<
    ArrangementClip,
    | "startQ"
    | "durationSeconds"
    | "layerClipStartQ"
    | "layerClipDurationSeconds"
  >,
) {
  return {
    startQ: clip.layerClipStartQ ?? clip.startQ,
    durationSeconds: clip.layerClipDurationSeconds ?? clip.durationSeconds,
  };
}

function animationClipContext(
  clip: ArrangementClip,
  playheadQ: number,
  bpm: number,
  sessionEdges?: SessionEdges,
): AnimationClipContext {
  const { startQ, durationSeconds } = getAnimationTiming(clip);
  const elapsedSeconds = quartersToSeconds(playheadQ - startQ, bpm);
  return {
    clipId: clip.id,
    laneId: clip.laneId,
    progress:
      durationSeconds > 0 ? clamp(elapsedSeconds / durationSeconds, 0, 1) : 0,
    elapsedSeconds,
    durationSeconds,
    sessionEdges,
  };
}

// The effects whole-frame work is drawn with: the Global chain (Zoom & Pan
// among it) and the Global Order act on every layer at once, so they animate
// with the topmost active clip, the first of `activeClips`. With no active
// clip they are drawn as set.
export function resolveFrameEffects<T extends SessionEffect>(
  effects: T[],
  activeClips: readonly (Pick<ActiveClip, "clip"> &
    Partial<Pick<ActiveClip, "sessionEdges">>)[],
  playheadQ: number,
  bpm: number,
  fps = DEFAULT_FPS,
  signature?: MeterSignature,
): T[] {
  const topmost = activeClips[0];
  return topmost
    ? resolveAnimatedEffects(
        effects,
        animationClipContext(
          topmost.clip,
          playheadQ,
          bpm,
          topmost.sessionEdges,
        ),
        { playheadQ, bpm, fps, signature },
      )
    : effects;
}

// The arrangement the last enabled Order effect on the `trackId` stack
// sets, with the slides its Clip-mode animation gives the layers at `fps`,
// or undefined when the stack has none. `window` is the FX clip's the Order
// is on: its clips only slide while it is active.
export function findAnimatedOrder(
  effects: readonly SessionEffect[],
  trackId: string,
  fps = DEFAULT_FPS,
  window?: OrderSlide["window"],
): CompositionOrder | undefined {
  const effect = findOrderEffect(effects, trackId);
  if (!effect) {
    return undefined;
  }
  const order = parseCompositionOrder(effect.parameters);
  const slide = resolveOrderSlide(effect.animation, fps, window);
  return slide ? { ...order, slide } : order;
}

// The arrangement the compositor uses: the Global Order, animated, or the
// z-order overlay when there is none.
export function resolveAnimatedOrder(
  effects: readonly SessionEffect[],
  globalTrackId: string,
  fps = DEFAULT_FPS,
): CompositionOrder {
  return findAnimatedOrder(effects, globalTrackId, fps) ?? Z_ORDER_COMPOSITION;
}

function withOrder(order: CompositionOrder | undefined) {
  return order ? { order } : {};
}

// The chain a clip is drawn with: its own stack's steps first, on the clip's
// pixels, then its layer's.
export function resolveClipEffectChain(
  effects: SessionEffect[],
  clip: Pick<ArrangementClip, "id" | "laneId">,
): EffectChainStep[] {
  return [
    ...resolveEffectChain(effects, clipEffectTrackId(clip.id)),
    ...resolveEffectChain(effects, clip.laneId),
  ];
}
