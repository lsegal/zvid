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
//      anchor is the layer's own);
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
// Other visual parameters (opacity and the like) read Global, then Layer,
// then Clip, so the most specific stack wins.
import { type ClipWarp, warpSourceTime } from "./clip-warp.ts";
import {
  type CompositionOrder,
  findCompositionOrder,
  isOrderEffectName,
} from "./composition-order.ts";
import {
  isTransformEffectName,
  type LayerTransform,
  parseLayerTransform,
} from "./composition-transform.ts";
import {
  type FillPaint,
  isColorEffectName,
  resolveFillPaint,
} from "./fill-paint.ts";
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
};

export const GROUP_TRACK_ID = "__group_main";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function quartersToSeconds(quarters: number, bpm: number) {
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

export function resolveVisualState(
  effects: SessionEffect[],
  laneId: string,
  // The clip's own stack, when the state is for a clip.
  clipId?: string,
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

    // Order arranges every layer at once; the compositor reads it itself.
    if (isOrderEffectName(effect.effectName)) {
      continue;
    }

    // Transform is per layer or clip and read by its exact keys, which the
    // name heuristics below would misread ("PositionX" as an offset, and so
    // on). The last enabled one in each stack wins.
    if (isTransformEffectName(effect.effectName)) {
      if (effect.trackId === laneId) {
        state.transform = parseLayerTransform(effect.parameters);
      } else if (effect.trackId === clipTrackId) {
        state.clipTransform = parseLayerTransform(effect.parameters);
      }
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

  return state;
}

export function computeActiveClips(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  effects: SessionEffect[],
): ActiveClip[] {
  const epsilon = 0.0001;
  const usedSourceKeys = new Set<string>();

  // Offline or still-restoring media has nothing to draw, so its clip is
  // skipped and takes no band. It never hides the clips on other lanes.
  const drawable = clips
    .filter((clip) => {
      const clipEndQ = clip.startQ + (clip.durationSeconds * bpm) / 60;
      return (
        playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon
      );
    })
    .map((clip) => ({
      clip,
      media: isGeneratedClip(clip)
        ? createGeneratedMedia(clip)
        : clip.mediaId
          ? mediaById.get(clip.mediaId)
          : undefined,
    }))
    .filter((entry): entry is { clip: ArrangementClip; media: MediaItem } =>
      Boolean(isGeneratedClip(entry.clip) || entry.media?.previewUrl),
    );

  // A lane shows one clip at a time. Where clips on a lane overlap, the one
  // that starts latest is on top, as in Ableton; on a tie the later clip in
  // the arrangement wins.
  const topClipByLane = new Map<string, (typeof drawable)[number]>();
  for (const entry of drawable) {
    const current = topClipByLane.get(entry.clip.laneId);
    if (!current || entry.clip.startQ >= current.clip.startQ) {
      topClipByLane.set(entry.clip.laneId, entry);
    }
  }

  return [...topClipByLane.values()]
    .sort(
      (left, right) =>
        (lanePriority.get(left.clip.laneId) ?? Number.MAX_SAFE_INTEGER) -
        (lanePriority.get(right.clip.laneId) ?? Number.MAX_SAFE_INTEGER),
    )
    .map<ActiveClip>(({ clip, media }) => {
      const clipElapsedSeconds = quartersToSeconds(
        playheadQ - clip.startQ,
        bpm,
      );
      const laneRank = lanePriority.get(clip.laneId) ?? -1;
      const clipProgress =
        clip.durationSeconds > 0
          ? clamp(clipElapsedSeconds / clip.durationSeconds, 0, 1)
          : 0;
      if (clip.kind === "fx") {
        // Only the FX clip's own stack adjusts what is beneath it, so an FX
        // clip without effects changes nothing.
        return {
          clip,
          media,
          sourceKey: media.id,
          mediaTime: 0,
          playbackRate: 1,
          isInBounds: true,
          laneRank,
          clipProgress,
          visual: resolveVisualState(effects, clip.laneId, clip.id),
          effectChain: resolveEffectChain(effects, clipEffectTrackId(clip.id)),
          fx: true,
          ...withOrder(
            findCompositionOrder(effects, clipEffectTrackId(clip.id)),
          ),
        };
      }

      if (isGeneratedClip(clip)) {
        return {
          clip,
          media,
          sourceKey: media.id,
          mediaTime: 0,
          playbackRate: 1,
          isInBounds: true,
          laneRank,
          clipProgress,
          visual: resolveVisualState(effects, clip.laneId, clip.id),
          effectChain: resolveClipEffectChain(effects, clip),
          ...(clip.kind === "text"
            ? {
                text: resolveTextStyle(
                  effects,
                  clip.laneId,
                  clipEffectTrackId(clip.id),
                ),
              }
            : {
                fill: resolveFillPaint(
                  effects,
                  clip.laneId,
                  clipEffectTrackId(clip.id),
                ),
              }),
        };
      }

      // The source window is in linear source time; the media's own bounds
      // apply to the warped time the media is actually drawn at.
      const linearTime =
        quartersToSeconds(playheadQ, bpm) + clip.sourceOffsetSeconds;
      const { seconds: mediaTime, rate: playbackRate } = clip.warp
        ? warpSourceTime(clip.warp, linearTime, bpm)
        : { seconds: linearTime, rate: 1 };
      return {
        clip,
        media,
        sourceKey: claimSourceKey(usedSourceKeys, media.id, clip),
        mediaTime,
        playbackRate,
        isInBounds:
          linearTime >= clip.sourceWindowStartSeconds &&
          linearTime < clip.sourceWindowEndSeconds - epsilon &&
          (media.durationSeconds > 0
            ? mediaTime >= 0 && mediaTime < media.durationSeconds - epsilon
            : mediaTime >= 0),
        laneRank,
        clipProgress,
        visual: resolveVisualState(effects, clip.laneId, clip.id),
        effectChain: resolveClipEffectChain(effects, clip),
      };
    });
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

// Fill and text clips draw what their layer's effects describe rather than
// a media file, and FX clips adjust what is beneath them.
function isGeneratedClip(clip: ArrangementClip) {
  return clip.kind === "fill" || clip.kind === "text" || clip.kind === "fx";
}

// Stands in for the media of a fill, text or FX clip, which has none. Its id
// doubles as the clip's source key, and the compositor never makes a media
// element for it.
function createGeneratedMedia(clip: ArrangementClip): MediaItem {
  return {
    id: `${clip.kind}:${clip.id}`,
    name: clip.label,
    kind: "video",
    durationSeconds: clip.durationSeconds,
    hasAudio: false,
    hasVideo: true,
    previewUrl: "",
  };
}

// The first clip using a media draws from the media's own element. Further
// clips on it get one element per lane, so a lane keeps reusing the same
// extra element from clip to clip.
function claimSourceKey(
  usedSourceKeys: Set<string>,
  mediaId: string,
  clip: ArrangementClip,
) {
  const candidates = [
    mediaId,
    `${mediaId}@${clip.laneId}`,
    `${mediaId}@${clip.laneId}/${clip.id}`,
  ];
  const sourceKey =
    candidates.find((candidate) => !usedSourceKeys.has(candidate)) ??
    candidates[candidates.length - 1];
  usedSourceKeys.add(sourceKey);
  return sourceKey;
}
