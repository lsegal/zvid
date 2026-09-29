// FX clips are adjustment clips: arrangement clips with no media that draw
// nothing themselves. The effects on their own clip stack apply, for the
// clip's time range and within its box, to everything composited beneath
// them. Like fill and text clips they carry the same timing fields as media
// clips, so moving, trimming, copying, splitting and undo treat them like
// any other clip.

import { getEffectDefinition } from "./fx-registry.ts";
import { clipEffectTrackId } from "./fx-stack.ts";

export const FX_CLIP_KIND = "fx";
export const FX_CLIP_LABEL = "FX";

export type FxClipKind = typeof FX_CLIP_KIND;

export function isFxClip(clip: object | undefined) {
  return clip !== undefined && "kind" in clip && clip.kind === FX_CLIP_KIND;
}

export type FxClip = {
  id: string;
  kind: FxClipKind;
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
};

export type FxClipOptions = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
  bpm: number;
  tint: string;
  accent: string;
};

export function createFxClip({
  id,
  laneId,
  startQ,
  durationQ,
  bpm,
  tint,
  accent,
}: FxClipOptions): FxClip {
  const durationSeconds = (Math.max(0, durationQ) * 60) / bpm;
  return {
    id,
    kind: FX_CLIP_KIND,
    sourceSpanId: "",
    sourceTrackId: "",
    laneId,
    label: FX_CLIP_LABEL,
    mediaPath: "",
    startQ,
    durationSeconds,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: durationSeconds,
    tint,
    accent,
  };
}

/**
 * Adds an FX clip spanning `durationQ` quarters from `startQ` on layer
 * `laneId`. It starts with an empty clip stack, so it changes nothing until
 * effects are added to it.
 */
export function addFxClip<Clip>(
  project: { clips: Clip[] },
  options: FxClipOptions,
): { clips: (Clip | FxClip)[]; clip: FxClip } {
  const clip = createFxClip(options);
  return { clips: [...project.clips, clip], clip };
}

// The timeline label of an FX clip: its effects' names in stack order, such
// as "FX · Colorize, Pixelate", or "FX (empty)" when it has none.
export function describeFxClip(
  effects: readonly { trackId: string; effectName: string }[],
  clipId: string,
) {
  const trackId = clipEffectTrackId(clipId);
  const names = effects
    .filter((effect) => effect.trackId === trackId)
    .map((effect) => getEffectDefinition(effect.effectName).displayName);
  return names.length
    ? `${FX_CLIP_LABEL} · ${names.join(", ")}`
    : `${FX_CLIP_LABEL} (empty)`;
}
