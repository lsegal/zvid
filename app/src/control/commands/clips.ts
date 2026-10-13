// Adding, moving, resizing and deleting clips on layers.
import { createWindowClip } from "../../app/clip-ops.ts";
import { FILL_CLIP_ACCENT, FILL_CLIP_TINT } from "../../app/constants.ts";
import { patchProjectState } from "../../app/session-project.ts";
import {
  chooseSourceSpanForWindow,
  getClipDurationQ,
} from "../../app/timeline-math.ts";
import type { ArrangementClip, ProjectState } from "../../app/types.ts";
import { getSwatch } from "../../app/util.ts";
import { addDefaultGain } from "../../default-gain.ts";
import { addFillClip, getDefaultFillColor } from "../../fill-clip.ts";
import { createFxClip } from "../../fx-clip.ts";
import { clipEffectTrackId, setEffectParameter } from "../../fx-stack.ts";
import {
  placeClipAt,
  placeClips,
  resolveClipOverlaps,
  withWindowTiming,
} from "../../range-edit.ts";
import { addTextClip } from "../../text-clip.ts";
import {
  BEATS_NOTE,
  describeClip,
  findClip,
  findLane,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import { type ControlCommand, ControlFailure } from "../types.ts";

const CLIP_KINDS = ["media", "fill", "text", "fx"] as const;

type NewClip = {
  clip: ArrangementClip;
  // Stack edits the clip comes with, such as a fill's Color.
  addEffects: (project: ProjectState) => ProjectState["effects"];
};

// A media clip: a window on a source track. It shows the track from
// `sourceStartQ`, by default the source clip's start when `sourceClipId`
// names one, else the clip's own position.
function newMediaClip(
  project: ProjectState,
  input: Record<string, unknown>,
  laneId: string,
  startQ: number,
  durationQ: number,
): NewClip {
  const { bpm } = project;
  const sourceClipId = optionalString(input, "sourceClipId");
  const sourceClip = sourceClipId
    ? project.sourceSpans.find((span) => span.id === sourceClipId)
    : undefined;
  if (sourceClipId && !sourceClip) {
    throw new ControlFailure(
      "not_found",
      `No source clip has id "${sourceClipId}". Call get_session for the source clips.`,
    );
  }
  const sourceTrackId =
    sourceClip?.sourceTrackId ?? optionalString(input, "sourceTrackId");
  if (!sourceTrackId) {
    throw new ControlFailure(
      "invalid_input",
      'A media clip needs "sourceClipId" or "sourceTrackId"; import_media returns both.',
    );
  }
  const sourceTrack = project.sourceTracks.find(
    (track) => track.id === sourceTrackId,
  );
  if (!sourceTrack) {
    throw new ControlFailure(
      "not_found",
      `No source track has id "${sourceTrackId}".`,
    );
  }
  const sourceStartQ =
    optionalNumber(input, "sourceStartBeats") ?? sourceClip?.startQ ?? startQ;
  const span =
    sourceClip ??
    chooseSourceSpanForWindow(
      project.sourceSpans,
      sourceTrack.id,
      sourceStartQ,
      durationQ,
      bpm,
    );
  if (!span) {
    throw new ControlFailure(
      "unavailable",
      `Source track "${sourceTrack.name}" has no media yet; import_media into it first.`,
    );
  }
  const window = createWindowClip(
    { id: "", laneId, startQ: sourceStartQ, durationQ },
    sourceTrack,
    span,
    project.sourceSpans,
    bpm,
  );
  // Moved to its own position, still showing the same source.
  const clip = placeClipAt(window, laneId, startQ, bpm, window.id);
  return {
    clip,
    addEffects: (current) =>
      addDefaultGain(current.effects, { clips: [clip] }, current.mediaItems),
  };
}

function newGeneratedClip(
  project: ProjectState,
  kind: "fill" | "text" | "fx",
  input: Record<string, unknown>,
  laneId: string,
  startQ: number,
  durationQ: number,
): NewClip {
  const lane = findLane(project, laneId);
  const layerAccent =
    lane.colorIndex >= 0 ? getSwatch(lane.colorIndex).accent : undefined;
  const options = {
    laneId,
    startQ,
    durationQ,
    bpm: project.bpm,
    tint: FILL_CLIP_TINT,
    accent: layerAccent ?? FILL_CLIP_ACCENT,
  };
  const effectId = crypto.randomUUID();
  if (kind === "fx") {
    return {
      clip: createFxClip({ ...options, id: `fx-${crypto.randomUUID()}` }),
      addEffects: (current) => current.effects,
    };
  }
  if (kind === "fill") {
    const color =
      optionalString(input, "color") ?? getDefaultFillColor(layerAccent);
    const { clip } = addFillClip(
      { clips: [], effects: [] },
      { ...options, id: `fill-${crypto.randomUUID()}`, color, effectId },
    );
    return {
      clip,
      addEffects: (current) =>
        addFillClip(
          { clips: [], effects: current.effects },
          { ...options, id: clip.id, color, effectId },
        ).effects,
    };
  }
  const text = optionalString(input, "text");
  const { clip } = addTextClip(
    { clips: [], effects: [] },
    { ...options, id: `text-${crypto.randomUUID()}`, effectId },
  );
  return {
    clip,
    addEffects: (current) => {
      const { effects } = addTextClip(
        { clips: [], effects: current.effects },
        { ...options, id: clip.id, effectId },
      );
      return text === undefined
        ? effects
        : setEffectParameter(effects, effectId, "Text", text);
    },
  };
}

export const clipCommands: ControlCommand[] = [
  {
    name: "add_clip",
    description: `Adds a clip to a layer, replacing whatever it covers there. kind "media" shows imported media: pass sourceClipId (a source clip from import_media or get_session) to show it from its start, or sourceTrackId with sourceStartBeats to show that source track from a position. kind "fill" is a solid color (color), "text" is a text clip (text), and "fx" is an FX clip whose own effects (add_effect with target "clip") change everything beneath it. Fill and text clips carry a Color or Text effect to configure. Returns the clip and its effects. ${BEATS_NOTE}`,
    inputSchema: objectSchema(
      {
        kind: {
          type: "string",
          description: "What the clip shows.",
          enum: CLIP_KINDS,
        },
        layerId: {
          type: "string",
          description: "The layer to put it on, from get_session.",
        },
        startBeats: {
          type: "number",
          description: "Where the clip starts on the timeline, in beats.",
          minimum: 0,
        },
        durationBeats: {
          type: "number",
          description: "How long the clip is, in beats.",
          exclusiveMinimum: 0,
        },
        sourceClipId: {
          type: "string",
          description: "Media clips: the source clip to show from its start.",
        },
        sourceTrackId: {
          type: "string",
          description: "Media clips: the source track to show.",
        },
        sourceStartBeats: {
          type: "number",
          description:
            "Media clips: the source track position the clip starts showing, in beats. Defaults to the source clip's start, or else startBeats.",
          minimum: 0,
        },
        color: {
          type: "string",
          description: 'Fill clips: a CSS color such as "#ff3366".',
        },
        text: { type: "string", description: "Text clips: the text to show." },
      },
      ["kind", "layerId", "startBeats", "durationBeats"],
    ),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const kind = requireString(input, "kind") as (typeof CLIP_KINDS)[number];
      const laneId = findLane(project, requireString(input, "layerId")).id;
      const startQ = requireNumber(input, "startBeats");
      const durationQ = requireNumber(input, "durationBeats");
      const { clip, addEffects } =
        kind === "media"
          ? newMediaClip(project, input, laneId, startQ, durationQ)
          : newGeneratedClip(project, kind, input, laneId, startQ, durationQ);
      host.commit(`Add ${kind} clip`, (current) =>
        patchProjectState(current, {
          clips: placeClips(current.clips, [clip], current.bpm),
          effects: addEffects(current),
        }),
      );
      host.selectClip(clip.id);
      const latest = host.getProject();
      return {
        clip: describeClip(findClip(latest, clip.id), latest.bpm),
        effectIds: latest.effects
          .filter((effect) => effect.trackId === clipEffectTrackId(clip.id))
          .map((effect) => ({ id: effect.id, effectName: effect.effectName })),
      };
    },
  },
  {
    name: "update_clip",
    description: `Moves a clip to another time or layer, or changes its length, replacing whatever it then covers. A moved media clip keeps showing the same part of its media. ${BEATS_NOTE}`,
    inputSchema: objectSchema(
      {
        clipId: { type: "string", description: "The clip's id." },
        layerId: { type: "string", description: "Move it to this layer." },
        startBeats: {
          type: "number",
          description: "Move its start here, in beats.",
          minimum: 0,
        },
        durationBeats: {
          type: "number",
          description: "Its new length, in beats, keeping its start.",
          exclusiveMinimum: 0,
        },
      },
      ["clipId"],
    ),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const clip = findClip(project, requireString(input, "clipId"));
      const layerId = optionalString(input, "layerId");
      const laneId = layerId ? findLane(project, layerId).id : clip.laneId;
      const startQ = optionalNumber(input, "startBeats") ?? clip.startQ;
      const durationQ =
        optionalNumber(input, "durationBeats") ??
        getClipDurationQ(clip, project.bpm);
      host.commit("Move clip", (current) => {
        const { bpm } = current;
        const existing = current.clips.find((item) => item.id === clip.id);
        if (!existing) {
          return current;
        }
        const moved = withWindowTiming(
          placeClipAt(existing, laneId, startQ, bpm, existing.id),
          startQ,
          durationQ,
          bpm,
        );
        return patchProjectState(current, {
          clips: resolveClipOverlaps(
            current.clips.map((item) => (item.id === clip.id ? moved : item)),
            moved,
            bpm,
          ),
        });
      });
      const latest = host.getProject();
      return describeClip(findClip(latest, clip.id), latest.bpm);
    },
  },
  {
    name: "delete_clip",
    description: "Deletes a clip and its own effects.",
    inputSchema: objectSchema(
      { clipId: { type: "string", description: "The clip's id." } },
      ["clipId"],
    ),
    edits: true,
    run(host, input) {
      const clip = findClip(host.getProject(), requireString(input, "clipId"));
      host.commit("Delete clip", (current) =>
        patchProjectState(current, {
          clips: current.clips.filter((item) => item.id !== clip.id),
        }),
      );
      if (host.getSelectedClipId() === clip.id) {
        host.selectClip(undefined);
      }
      return { deleted: clip.id };
    },
  },
];
