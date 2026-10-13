// The playhead, playback, the loop and the clip selection.
import {
  BEATS_NOTE,
  findClip,
  optionalNumber,
  optionalString,
  requireNumber,
  round,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import { type ControlCommand, ControlFailure, type ControlHost } from "../types.ts";

function transportState(host: ControlHost) {
  const loop = host.getLoop();
  return {
    playheadBeats: round(host.getPlayheadQ()),
    isPlaying: host.isPlaying(),
    loop: loop
      ? { startBeats: round(loop.startQ), endBeats: round(loop.endQ) }
      : null,
  };
}

export const transportCommands: ControlCommand[] = [
  {
    name: "set_playhead",
    description: `Moves the playhead, which the preview shows. ${BEATS_NOTE}`,
    inputSchema: objectSchema(
      {
        beats: {
          type: "number",
          description: "The new playhead position, in beats.",
          minimum: 0,
        },
      },
      ["beats"],
    ),
    run(host, input) {
      host.setPlayheadQ(requireNumber(input, "beats"));
      return transportState(host);
    },
  },
  {
    name: "play",
    description:
      "Starts playback from the playhead, or from fromBeats. Inside a loop, playback loops it.",
    inputSchema: objectSchema({
      fromBeats: {
        type: "number",
        description: "Move the playhead here first, in beats.",
        minimum: 0,
      },
    }),
    run(host, input) {
      const fromQ = optionalNumber(input, "fromBeats");
      if (fromQ !== undefined) {
        host.setPlayheadQ(fromQ);
      }
      if (!host.isPlaying() && !host.play()) {
        throw new ControlFailure(
          "unavailable",
          "There is nothing to play; add clips first.",
        );
      }
      return transportState(host);
    },
  },
  {
    name: "pause",
    description: "Stops playback, leaving the playhead where it is.",
    inputSchema: objectSchema({}),
    run(host) {
      host.pause();
      return transportState(host);
    },
  },
  {
    name: "set_loop",
    description: `Sets the loop region playback repeats, or clears it when both ends are omitted. ${BEATS_NOTE}`,
    inputSchema: objectSchema({
      startBeats: {
        type: "number",
        description: "Where the loop starts, in beats.",
        minimum: 0,
      },
      endBeats: {
        type: "number",
        description: "Where the loop ends, in beats.",
        exclusiveMinimum: 0,
      },
    }),
    run(host, input) {
      const startQ = optionalNumber(input, "startBeats");
      const endQ = optionalNumber(input, "endBeats");
      if (startQ === undefined && endQ === undefined) {
        host.setLoop(null);
        return transportState(host);
      }
      if (startQ === undefined || endQ === undefined) {
        throw new ControlFailure(
          "invalid_input",
          'Pass both "startBeats" and "endBeats", or neither to clear the loop.',
        );
      }
      if (endQ <= startQ) {
        throw new ControlFailure(
          "invalid_input",
          '"endBeats" must be after "startBeats".',
        );
      }
      host.setLoop({ startQ, endQ });
      return transportState(host);
    },
  },
  {
    name: "select_clip",
    description:
      "Selects a clip, as clicking it does, so the FX panel shows its effects; omit clipId to clear the selection.",
    inputSchema: objectSchema({
      clipId: { type: "string", description: "The clip to select." },
    }),
    run(host, input) {
      const clipId = optionalString(input, "clipId");
      host.selectClip(
        clipId === undefined ? undefined : findClip(host.getProject(), clipId).id,
      );
      return { selectedClipId: host.getSelectedClipId() ?? null };
    },
  },
];
