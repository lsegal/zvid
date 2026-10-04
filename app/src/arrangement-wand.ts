// The arrangement wand's layers and extent: it rebuilds the arrangement on a
// fresh set of layers named `Layer 1` onward, plus an `Audio` layer after
// them, and stops at the session end.
// `random-arrangement.ts` picks the windows themselves.
import { ensureLayerLayouts, type SessionEffect } from "./fx-stack.ts";

export type WandLane = {
  id: string;
  name: string;
  colorIndex: number;
};

export type WandSourceSpan = {
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
};

export const WAND_AUDIO_LANE_NAME = "Audio";

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

// Where the wand stops: the session length (Live's loop end or the last clip
// end from an import) when the session has one, otherwise the end of the
// last video source span. Audio-only spans, such as frozen tracks or an old
// session's main audio, can run far past the song, so they do not count.
export function getWandEndQ<Span extends WandSourceSpan>(options: {
  projectDurationFrames?: number;
  fps: number;
  bpm: number;
  barLength: number;
  sourceSpans: readonly Span[];
  isVideoSpan: (span: Span) => boolean;
}) {
  const { projectDurationFrames, fps, bpm, barLength, sourceSpans } = options;
  if (projectDurationFrames && projectDurationFrames > 0 && fps > 0) {
    return secondsToQuarters(projectDurationFrames / fps, bpm);
  }

  const videoSpans = sourceSpans.filter(options.isVideoSpan);
  const spans = videoSpans.length ? videoSpans : sourceSpans;
  const spanEndQ = spans.reduce(
    (maximum, span) =>
      Math.max(
        maximum,
        span.startQ + secondsToQuarters(span.durationSeconds, bpm),
      ),
    0,
  );
  return Math.max(barLength, spanEndQ);
}

// `Layer 1` to `Layer <count>` for video, then an `Audio` layer that does not
// count toward `count`, with ids no existing layer uses so nothing still
// keyed to an old layer attaches to them.
export function createWandLanes(
  existingLanes: readonly { id: string }[],
  count: number,
) {
  const numericIds = existingLanes
    .map((lane) => Number.parseInt(lane.id, 10))
    .filter((value) => Number.isInteger(value));
  const firstId = Math.max(0, ...numericIds) + 1;
  const videoLanes = Array.from(
    { length: count },
    (_, index): WandLane => ({
      id: `${firstId + index}`,
      name: `Layer ${index + 1}`,
      colorIndex: -1,
    }),
  );
  const audioLane: WandLane = {
    id: `${firstId + count}`,
    name: WAND_AUDIO_LANE_NAME,
    colorIndex: -1,
  };
  return { videoLanes, audioLane, lanes: [...videoLanes, audioLane] };
}

// Swaps the wand's layers and windows into the project: the old layers, their
// clips and their layer effects go, and each new layer gets its own Layout.
export function applyWandArrangement<
  State extends {
    lanes: { id: string }[];
    clips: unknown[];
    effects: SessionEffect[];
  },
>(current: State, wandLanes: State["lanes"], wandClips: State["clips"]): State {
  const oldLaneIds = new Set(current.lanes.map((lane) => lane.id));
  return {
    ...current,
    lanes: wandLanes,
    clips: wandClips,
    effects: ensureLayerLayouts(
      current.effects.filter((effect) => !oldLaneIds.has(effect.trackId)),
      wandLanes.map((lane) => lane.id),
    ),
  };
}
