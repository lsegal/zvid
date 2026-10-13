// Reading the session, starting a new one, its settings, and undo/redo.
import { BPM_MAX, BPM_MIN } from "../../app/constants.ts";
import { patchProjectState } from "../../app/session-project.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  applySessionSettings,
  FRAME_RATES,
  hasSessionSettingsErrors,
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
  sessionSettingsFromProject,
  VIDEO_CODECS,
  type VideoCodecChoice,
  validateSessionSettings,
} from "../../session-settings.ts";
import {
  BEATS_NOTE,
  describeClip,
  describeEffect,
  describeSourceClip,
  optionalBoolean,
  optionalNumber,
  optionalString,
  round,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import {
  type ControlCommand,
  ControlFailure,
  type ControlHost,
} from "../types.ts";

export function describeSession(host: ControlHost) {
  const project = host.getProject();
  const { bpm } = project;
  const loop = host.getLoop();
  const settings = sessionSettingsFromProject(project);
  return {
    name: project.sessionName,
    bpm,
    fps: round(project.fps),
    canvasWidth: project.canvasWidth,
    canvasHeight: project.canvasHeight,
    videoCodec: settings.encoding.videoCodec,
    timeSignature: project.signatureId,
    playheadBeats: round(host.getPlayheadQ()),
    isPlaying: host.isPlaying(),
    loop: loop
      ? { startBeats: round(loop.startQ), endBeats: round(loop.endQ) }
      : null,
    selectedClipId: host.getSelectedClipId() ?? null,
    undo: host.canUndo() ?? null,
    redo: host.canRedo() ?? null,
    // Top to bottom: higher layers draw over lower ones.
    layers: project.lanes.map((lane, index) => ({
      id: lane.id,
      name: lane.name,
      index,
      hidden: lane.hidden === true,
      fxEnabled: lane.fxEnabled !== false,
    })),
    clips: project.clips.map((clip) => describeClip(clip, bpm)),
    sourceTracks: project.sourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      hidden: track.hidden === true,
    })),
    sourceClips: project.sourceSpans.map((span) =>
      describeSourceClip(span, bpm),
    ),
    media: project.mediaItems.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      durationSeconds: round(item.durationSeconds),
      hasVideo: item.hasVideo,
      hasAudio: item.hasAudio,
      ...(item.width && item.height
        ? { width: item.width, height: item.height }
        : {}),
    })),
    effects: project.effects.map((effect) => describeEffect(effect, project)),
  };
}

export const sessionCommands: ControlCommand[] = [
  {
    name: "get_session",
    description: `Returns the whole session: settings, playhead, loop, selection, layers (top to bottom), clips, source tracks and their source clips, imported media, and every effect with its stack and parameter values. Call it first and after edits to read ids. ${BEATS_NOTE}`,
    inputSchema: objectSchema({}),
    run: (host) => describeSession(host),
  },
  {
    name: "new_session",
    description:
      "Replaces the session with a blank one: the default layers and settings, no media and no undo history. Fails when the session has unsaved changes unless discardUnsavedChanges is true.",
    inputSchema: objectSchema({
      discardUnsavedChanges: {
        type: "boolean",
        description: "Start over even if the current session was never saved.",
      },
    }),
    edits: true,
    run(host, input) {
      const blocker = host.newSessionBlocker();
      if (blocker) {
        throw new ControlFailure("unavailable", blocker);
      }
      if (
        host.hasUnsavedChanges() &&
        optionalBoolean(input, "discardUnsavedChanges") !== true
      ) {
        throw new ControlFailure(
          "unavailable",
          "The session has unsaved changes. Pass discardUnsavedChanges: true to discard them.",
        );
      }
      host.newSession();
      return describeSession(host);
    },
  },
  {
    name: "update_session",
    description: `Changes the session's name, tempo, frame rate, canvas size or export video codec. Clips keep their start positions in beats when the tempo changes. Frame rates: ${FRAME_RATES.map((rate) => rate.label).join(", ")}.`,
    inputSchema: objectSchema({
      name: { type: "string", description: "The session name.", minLength: 1 },
      bpm: {
        type: "number",
        description: `Tempo in beats per minute, ${BPM_MIN}–${BPM_MAX}.`,
        minimum: BPM_MIN,
        maximum: BPM_MAX,
      },
      fps: {
        type: "number",
        description: "Frame rate in frames per second.",
        exclusiveMinimum: 0,
      },
      canvasWidth: {
        type: "integer",
        description: `Canvas width in pixels, even, ${MIN_CANVAS_DIMENSION}–${MAX_CANVAS_DIMENSION}.`,
      },
      canvasHeight: {
        type: "integer",
        description: `Canvas height in pixels, even, ${MIN_CANVAS_DIMENSION}–${MAX_CANVAS_DIMENSION}.`,
      },
      videoCodec: {
        type: "string",
        description: "The export video codec; auto picks the best supported.",
        enum: VIDEO_CODECS.map((codec) => codec.value),
      },
    }),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const current = sessionSettingsFromProject(project);
      const videoCodec = optionalString(input, "videoCodec") as
        | VideoCodecChoice
        | undefined;
      const settings = {
        canvasWidth:
          optionalNumber(input, "canvasWidth") ?? current.canvasWidth,
        canvasHeight:
          optionalNumber(input, "canvasHeight") ?? current.canvasHeight,
        fps: optionalNumber(input, "fps") ?? current.fps,
        encoding: videoCodec
          ? { ...current.encoding, videoCodec }
          : current.encoding,
      };
      const errors = validateSessionSettings(settings);
      if (hasSessionSettingsErrors(errors)) {
        throw new ControlFailure(
          "invalid_input",
          Object.entries(errors)
            .map(([field, message]) => `${field}: ${message}`)
            .join(" "),
        );
      }
      const name = optionalString(input, "name")?.trim();
      const bpm = optionalNumber(input, "bpm");
      host.commit("Update session settings", (latest: ProjectState) =>
        patchProjectState(applySessionSettings(latest, settings), {
          ...(name ? { sessionName: name } : {}),
          ...(bpm !== undefined ? { bpm } : {}),
        }),
      );
      return describeSession(host);
    },
  },
  {
    name: "undo",
    description: "Undoes the last edit, as Edit → Undo does.",
    inputSchema: objectSchema({}),
    edits: true,
    run(host) {
      const label = host.canUndo();
      if (!label) {
        throw new ControlFailure("unavailable", "There is nothing to undo.");
      }
      host.undo();
      return { undid: label };
    },
  },
  {
    name: "redo",
    description: "Redoes the last undone edit, as Edit → Redo does.",
    inputSchema: objectSchema({}),
    edits: true,
    run(host) {
      const label = host.canRedo();
      if (!label) {
        throw new ControlFailure("unavailable", "There is nothing to redo.");
      }
      host.redo();
      return { redid: label };
    },
  },
];
