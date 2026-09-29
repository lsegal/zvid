// Fill clips are arrangement clips with no media: each draws a rectangle
// over its layer's band, painted by the Color effect on that layer. They
// carry the same timing fields as media clips, so moving, trimming, copying,
// splitting and undo treat them like any other clip.

import {
  COLOR_EFFECT_NAME,
  formatCssColor,
  isColorEffectName,
  NEUTRAL_FILL_COLOR,
  parseCssColor,
} from "./fill-paint.ts";
import { addEffect, type SessionEffect } from "./fx-stack.ts";

export const FILL_CLIP_KIND = "fill";
export const FILL_CLIP_LABEL = "Fill";

export type FillClipKind = typeof FILL_CLIP_KIND;

export function isFillClip(clip: object | undefined) {
  return clip !== undefined && "kind" in clip && clip.kind === FILL_CLIP_KIND;
}

export type FillClip = {
  id: string;
  kind: FillClipKind;
  sourceSpanId: string;
  sourceTrackId: string;
  laneId: string;
  label: string;
  mediaPath: string;
  mediaId?: undefined;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  tint: string;
  accent: string;
  selected?: boolean;
};

export type FillClipOptions = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
  bpm: number;
  tint: string;
  accent: string;
};

export function createFillClip({
  id,
  laneId,
  startQ,
  durationQ,
  bpm,
  tint,
  accent,
}: FillClipOptions): FillClip {
  const durationSeconds = (Math.max(0, durationQ) * 60) / bpm;
  return {
    id,
    kind: FILL_CLIP_KIND,
    sourceSpanId: "",
    sourceTrackId: "",
    laneId,
    label: FILL_CLIP_LABEL,
    mediaPath: "",
    startQ,
    durationSeconds,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: durationSeconds,
    tint,
    accent,
    selected: true,
  };
}

// The Color effect's starting colour for a layer: its accent when it has
// one, otherwise neutral grey.
export function getDefaultFillColor(layerAccent: string | undefined) {
  const color = parseCssColor(layerAccent);
  return color ? formatCssColor(color) : NEUTRAL_FILL_COLOR;
}

export type FillProject<Clip> = {
  clips: Clip[];
  effects: SessionEffect[];
};

/**
 * Adds a fill clip spanning `durationQ` quarters from `startQ` on layer
 * `laneId`. The layer gets a Color effect in Solid mode with `color` when it
 * has none yet, so the new clip is visible straight away.
 */
export function addFillClip<Clip>(
  project: FillProject<Clip>,
  options: FillClipOptions & { color: string; effectId: string },
): FillProject<Clip | FillClip> & { clip: FillClip } {
  const clip = createFillClip(options);
  const hasColorEffect = project.effects.some(
    (effect) =>
      effect.trackId === options.laneId && isColorEffectName(effect.effectName),
  );
  let effects = project.effects;
  if (!hasColorEffect) {
    effects = addEffect(
      effects,
      options.laneId,
      COLOR_EFFECT_NAME,
      undefined,
      options.effectId,
    ).map((effect) =>
      effect.id === options.effectId
        ? {
            ...effect,
            parameters: effect.parameters.map((parameter) =>
              parameter.key === "Color"
                ? { ...parameter, value: options.color }
                : parameter,
            ),
          }
        : effect,
    );
  }

  return { clips: [...project.clips, clip], effects, clip };
}
