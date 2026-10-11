import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import { quartersToSeconds } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  ProjectState,
  SourceSpan,
} from "../app/types.ts";
import { addDefaultGain } from "../default-gain.ts";
import { addFillClip } from "../fill-clip.ts";
import { addFxClip } from "../fx-clip.ts";
import { addEffect, type SessionEffect } from "../fx-stack";
import type { MediaItem } from "../media";
import { addMediaToSourceTrack } from "../source-track-media.ts";
import { addTextClip } from "../text-clip.ts";

// Projects for FxEditor and the render helpers, built with the same
// functions App's timeline actions call.

let nextId = 0;
const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;

// A media item as the import reads it.
export function mediaItem(
  options: Partial<MediaItem> & Pick<MediaItem, "kind">,
): MediaItem {
  return {
    id: uniqueId("media"),
    name: `${options.kind}.media`,
    durationSeconds: 8,
    hasAudio: options.kind === "audio",
    hasVideo: options.kind === "video",
    color: "#334",
    accent: "#f80",
    previewUrl: "",
    availability: "available",
    ...options,
  };
}

// The project after dropping `item` on the source track area, as a new
// source track: its source clip, with a 0 dB Gain when it has sound.
export function withDroppedMedia(project: ProjectState, item: MediaItem) {
  const withItem = patchProjectState(project, {
    mediaItems: [...project.mediaItems, item],
  });
  const placement = addMediaToSourceTrack(withItem, [item], {
    kind: "new-track",
  });
  const next = patchProjectState(withItem, placement);
  const span = next.sourceSpans.find((each) => each.mediaId === item.id);
  if (!span) {
    throw new Error("The drop made no source clip");
  }
  return { project: next, span };
}

// The project after Ctrl/Cmd-clicking a source clip: the whole clip on
// layer `laneId`, with a 0 dB Gain when it has sound.
export function withClipFromSpan(
  project: ProjectState,
  span: SourceSpan,
  laneId = project.lanes[0].id,
) {
  const sourceOffsetSeconds =
    span.trimStartSeconds - quartersToSeconds(span.startQ, project.bpm);
  const clip: ArrangementClip = {
    id: span.id,
    sourceSpanId: span.id,
    sourceTrackId: span.sourceTrackId,
    laneId,
    label: span.label,
    mediaPath: span.mediaPath,
    mediaId: span.mediaId,
    startQ: span.startQ,
    durationSeconds: span.durationSeconds,
    trimStartSeconds: span.trimStartSeconds,
    sourceOffsetSeconds,
    sourceSpanOffsetSeconds: sourceOffsetSeconds,
    sourceWindowStartSeconds: span.trimStartSeconds,
    sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
    tint: span.tint,
    accent: span.accent,
  };
  return {
    project: patchProjectState(project, {
      clips: [...project.clips, clip],
      effects: addDefaultGain(
        project.effects,
        { clips: [clip] },
        project.mediaItems,
      ),
    }),
    clip,
  };
}

type ClipPlacement = { laneId?: string; startQ?: number; durationQ?: number };

function placement(project: ProjectState, options: ClipPlacement) {
  return {
    laneId: options.laneId ?? project.lanes[0].id,
    startQ: options.startQ ?? 0,
    durationQ: options.durationQ ?? 8,
    bpm: project.bpm,
    tint: "#334",
    accent: "#f80",
  };
}

// Insert Text Clip over a selection: a text clip with its Text effect.
export function withTextClip(
  project: ProjectState,
  options: ClipPlacement = {},
) {
  const added = addTextClip(project, {
    ...placement(project, options),
    id: uniqueId("text"),
    effectId: uniqueId("effect"),
  });
  return {
    project: patchProjectState(project, {
      clips: added.clips,
      effects: added.effects,
    }),
    clip: added.clip,
  };
}

// A fill over a selection: a fill clip with its Color effect.
export function withFillClip(
  project: ProjectState,
  color: string,
  options: ClipPlacement = {},
) {
  const added = addFillClip(project, {
    ...placement(project, options),
    id: uniqueId("fill"),
    color,
    effectId: uniqueId("effect"),
  });
  return {
    project: patchProjectState(project, {
      clips: added.clips,
      effects: added.effects,
    }),
    clip: added.clip,
  };
}

// Insert FX Clip over a selection: an FX clip with an empty stack.
export function withFxClip(project: ProjectState, options: ClipPlacement = {}) {
  const added = addFxClip(project, {
    ...placement(project, options),
    id: uniqueId("fx"),
  });
  return {
    project: patchProjectState(project, { clips: added.clips }),
    clip: added.clip,
  };
}

// Adds an effect with its defaults to the end of stack `trackId`, as the
// add menu does, then sets `parameters` on it.
export function withEffect(
  project: ProjectState,
  trackId: string,
  effectName: string,
  parameters: Record<string, string | number> = {},
) {
  const id = uniqueId("effect");
  const effects = addEffect(
    project.effects,
    trackId,
    effectName,
    undefined,
    id,
  ).map((effect) =>
    effect.id === id ? setValues(effect, parameters) : effect,
  );
  return { project: patchProjectState(project, { effects }), effectId: id };
}

function setValues(
  effect: SessionEffect,
  values: Record<string, string | number>,
): SessionEffect {
  return {
    ...effect,
    parameters: effect.parameters.map((parameter) =>
      parameter.key in values
        ? {
            ...parameter,
            value: String(values[parameter.key]),
            ...(typeof values[parameter.key] === "number"
              ? { numericValue: values[parameter.key] as number }
              : {}),
          }
        : parameter,
    ),
  };
}

export const EMPTY_PROJECT = INITIAL_PROJECT_STATE;
