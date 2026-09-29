// Text clips are arrangement clips with no media: each draws text in its
// layer's box, styled by the Text effect on the clip's own stack. Like fill
// clips they carry the same timing fields as media clips, so moving,
// trimming, copying, splitting and undo treat them like any other clip.

import {
  addEffect,
  clipEffectTrackId,
  type SessionEffect,
} from "./fx-stack.ts";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

export const TEXT_CLIP_KIND = "text";
export const TEXT_CLIP_LABEL = "Text";

export type TextClipKind = typeof TEXT_CLIP_KIND;

export function isTextClip(clip: object | undefined) {
  return clip !== undefined && "kind" in clip && clip.kind === TEXT_CLIP_KIND;
}

export type TextClip = {
  id: string;
  kind: TextClipKind;
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

export type TextClipOptions = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
  bpm: number;
  tint: string;
  accent: string;
};

export function createTextClip({
  id,
  laneId,
  startQ,
  durationQ,
  bpm,
  tint,
  accent,
}: TextClipOptions): TextClip {
  const durationSeconds = (Math.max(0, durationQ) * 60) / bpm;
  return {
    id,
    kind: TEXT_CLIP_KIND,
    sourceSpanId: "",
    sourceTrackId: "",
    laneId,
    label: TEXT_CLIP_LABEL,
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

export type TextProject<Clip> = {
  clips: Clip[];
  effects: SessionEffect[];
};

/**
 * Adds a text clip spanning `durationQ` quarters from `startQ` on layer
 * `laneId`, with a Text effect with its defaults ("Text" in the default
 * font, white and centred) on the clip's own stack, so the new clip shows
 * straight away.
 */
export function addTextClip<Clip>(
  project: TextProject<Clip>,
  options: TextClipOptions & { effectId: string },
): TextProject<Clip | TextClip> & { clip: TextClip } {
  const clip = createTextClip(options);
  const effects = addEffect(
    project.effects,
    clipEffectTrackId(clip.id),
    TEXT_EFFECT_NAME,
    undefined,
    options.effectId,
  );

  return { clips: [...project.clips, clip], effects, clip };
}
