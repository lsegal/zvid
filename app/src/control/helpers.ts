// Reading command inputs, finding what they name, and describing the
// session's parts in the shapes commands return.
import { getClipDurationQ } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceSpan,
} from "../app/types.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  getEffectClipId,
  getEffectSourceSpanId,
  getEffectSourceTrackId,
  type SessionEffect,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx-stack.ts";
import { type ControlInput } from "./schema.ts";
import { ControlFailure } from "./types.ts";

// Timeline positions and lengths are in beats: quarter notes at the
// session's tempo, whatever its time signature.
export const BEATS_NOTE =
  "Beats are quarter notes at the session tempo (bpm); 4 beats are one bar of 4/4.";

export function optionalString(input: ControlInput, key: string) {
  return input[key] as string | undefined;
}

export function optionalNumber(input: ControlInput, key: string) {
  return input[key] as number | undefined;
}

export function optionalBoolean(input: ControlInput, key: string) {
  return input[key] as boolean | undefined;
}

export function requireString(input: ControlInput, key: string) {
  return input[key] as string;
}

export function requireNumber(input: ControlInput, key: string) {
  return input[key] as number;
}

export function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export function findLane(project: ProjectState, layerId: string): Lane {
  const lane = project.lanes.find((candidate) => candidate.id === layerId);
  if (!lane) {
    throw new ControlFailure(
      "not_found",
      `No layer has id "${layerId}". Layers: ${project.lanes.map((item) => `"${item.id}" (${item.name})`).join(", ") || "none"}.`,
    );
  }
  return lane;
}

export function findClip(
  project: ProjectState,
  clipId: string,
): ArrangementClip {
  const clip = project.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new ControlFailure(
      "not_found",
      `No clip has id "${clipId}". Call get_session for the clips.`,
    );
  }
  return clip;
}

export function findEffect(
  project: ProjectState,
  effectId: string,
): SessionEffect {
  const effect = project.effects.find((candidate) => candidate.id === effectId);
  if (!effect) {
    throw new ControlFailure(
      "not_found",
      `No effect has id "${effectId}". Call get_session for the effects.`,
    );
  }
  return effect;
}

export type ClipKind = "media" | "fill" | "text" | "fx";

export function clipKind(clip: ArrangementClip): ClipKind {
  return clip.kind ?? "media";
}

export function describeClip(clip: ArrangementClip, bpm: number) {
  return {
    id: clip.id,
    kind: clipKind(clip),
    layerId: clip.laneId,
    label: clip.label,
    startBeats: round(clip.startQ),
    durationBeats: round(getClipDurationQ(clip, bpm)),
    ...(clipKind(clip) === "media"
      ? { sourceTrackId: clip.sourceTrackId, mediaId: clip.mediaId }
      : {}),
  };
}

export function describeSourceClip(span: SourceSpan, bpm: number) {
  return {
    id: span.id,
    sourceTrackId: span.sourceTrackId,
    label: span.label,
    mediaId: span.mediaId,
    startBeats: round(span.startQ),
    durationBeats: round(getClipDurationQ(span, bpm)),
  };
}

// The stack an effect is on, named the way add_effect's `target` and
// `targetId` name it.
export type StackTarget =
  | "global"
  | "layer"
  | "clip"
  | "source-track"
  | "source-clip";

export const STACK_TARGETS: readonly StackTarget[] = [
  "global",
  "layer",
  "clip",
  "source-track",
  "source-clip",
];

export function describeStack(trackId: string): {
  target: StackTarget;
  targetId?: string;
} {
  if (trackId === GLOBAL_EFFECT_TRACK_ID) {
    return { target: "global" };
  }
  const clipId = getEffectClipId(trackId);
  if (clipId !== undefined) {
    return { target: "clip", targetId: clipId };
  }
  const sourceTrackId = getEffectSourceTrackId(trackId);
  if (sourceTrackId !== undefined) {
    return { target: "source-track", targetId: sourceTrackId };
  }
  const sourceSpanId = getEffectSourceSpanId(trackId);
  if (sourceSpanId !== undefined) {
    return { target: "source-clip", targetId: sourceSpanId };
  }
  return { target: "layer", targetId: trackId };
}

// The stack `target` and `targetId` name, checked against the session.
export function resolveStack(
  project: ProjectState,
  target: StackTarget,
  targetId: string | undefined,
) {
  if (target === "global") {
    return GLOBAL_EFFECT_TRACK_ID;
  }
  if (targetId === undefined) {
    throw new ControlFailure(
      "invalid_input",
      `"targetId" is required when "target" is "${target}".`,
    );
  }
  switch (target) {
    case "layer":
      return findLane(project, targetId).id;
    case "clip":
      return clipEffectTrackId(findClip(project, targetId).id);
    case "source-track":
      if (!project.sourceTracks.some((track) => track.id === targetId)) {
        throw new ControlFailure(
          "not_found",
          `No source track has id "${targetId}".`,
        );
      }
      return sourceTrackEffectTrackId(targetId);
    default:
      if (!project.sourceSpans.some((span) => span.id === targetId)) {
        throw new ControlFailure(
          "not_found",
          `No source clip has id "${targetId}".`,
        );
      }
      return sourceClipEffectTrackId(targetId);
  }
}

export function describeEffect(effect: SessionEffect, project: ProjectState) {
  const stack = describeStack(effect.trackId);
  const stackEffects = project.effects.filter(
    (candidate) => candidate.trackId === effect.trackId,
  );
  return {
    id: effect.id,
    effectName: effect.effectName,
    ...stack,
    index: stackEffects.indexOf(effect),
    enabled: effect.enabled !== false,
    parameters: Object.fromEntries(
      effect.parameters.map((parameter) => [
        parameter.key,
        parameter.numericValue ?? parameter.value,
      ]),
    ),
  };
}
