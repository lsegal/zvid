// The arrangement wand: rebuilds the arrangement from randomized windows on a
// quarter-bar grid, on a fresh set of at most `MAX_WAND_LAYERS` layers that
// ends at the session end.
import { ensureLayerLayouts, type SessionEffect } from "./fx-stack.ts";

export const RANDOM_SELECTION_BAR_INCREMENT = 0.25;
export const RANDOM_SELECTION_MAX_BARS = 2;
export const MAX_WAND_LAYERS = 3;

const EPSILON = 0.0001;

export type WandLane = {
  id: string;
  name: string;
  colorIndex: number;
};

export type WandSourceSpan = {
  sourceTrackId: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
};

export type WandWindow<Span> = {
  laneId: string;
  stepIndex: number;
  startQ: number;
  durationQ: number;
  sourceTrackId: string;
  sourceSpan: Span;
};

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

// Where the wand stops: the session length (Live's loop end or the last clip
// end from an import) when the session has one, otherwise the end of the
// last video source span. Audio-only spans such as frozen tracks and the
// main audio can run far past the song, so they do not count.
export function getWandEndQ(options: {
  projectDurationFrames?: number;
  fps: number;
  bpm: number;
  barLength: number;
  sourceSpans: readonly WandSourceSpan[];
  isVideoSpan: (span: WandSourceSpan) => boolean;
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

// `Layer 1` to `Layer <MAX_WAND_LAYERS>`, with ids no existing layer uses so
// nothing still keyed to an old layer attaches to them.
export function createWandLanes(existingLanes: readonly { id: string }[]) {
  const numericIds = existingLanes
    .map((lane) => Number.parseInt(lane.id, 10))
    .filter((value) => Number.isInteger(value));
  const firstId = Math.max(0, ...numericIds) + 1;
  return Array.from(
    { length: MAX_WAND_LAYERS },
    (_, index): WandLane => ({
      id: `${firstId + index}`,
      name: `Layer ${index + 1}`,
      colorIndex: -1,
    }),
  );
}

// Picks the randomized windows. Layer 1 is always filled and each layer above
// it half as often as the one below. No window starts or ends past `endQ`;
// the last one is shortened to end on it when no grid length fits.
export function planWandWindows<Span>(options: {
  lanes: readonly { id: string }[];
  sourceTrackIds: readonly string[];
  endQ: number;
  barLength: number;
  chooseSourceSpan: (
    sourceTrackId: string,
    startQ: number,
    durationQ: number,
  ) => Span | undefined;
  random: () => number;
}) {
  const { lanes, sourceTrackIds, endQ, barLength, random } = options;
  const pickRandom = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)] ?? items[0];
  const stepQ = barLength * RANDOM_SELECTION_BAR_INCREMENT;
  const durationSteps = Array.from(
    {
      length: Math.round(
        RANDOM_SELECTION_MAX_BARS / RANDOM_SELECTION_BAR_INCREMENT,
      ),
    },
    (_, index) => (index + 1) * stepQ,
  );
  const nextAvailableByLane = new Map(lanes.map((lane) => [lane.id, 0]));
  const windows: WandWindow<Span>[] = [];
  const stepCount = Math.max(1, Math.ceil(endQ / stepQ));

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    const startQ = stepIndex * stepQ;
    if (startQ >= endQ - EPSILON) {
      break;
    }

    for (const [laneIndex, lane] of lanes.entries()) {
      const nextAvailableQ = nextAvailableByLane.get(lane.id) ?? 0;
      if (startQ < nextAvailableQ - EPSILON) {
        continue;
      }

      const layerChance = laneIndex === 0 ? 1 : 0.5 ** laneIndex;
      if (random() > layerChance) {
        continue;
      }

      const fittingDurations = durationSteps.filter(
        (durationQ) => startQ + durationQ <= endQ + EPSILON,
      );
      const validDurations = fittingDurations.length
        ? fittingDurations
        : [endQ - startQ];
      const durationQ = pickRandom(validDurations);
      const candidates = sourceTrackIds.flatMap((sourceTrackId) => {
        const sourceSpan = options.chooseSourceSpan(
          sourceTrackId,
          startQ,
          durationQ,
        );
        return sourceSpan ? [{ sourceTrackId, sourceSpan }] : [];
      });
      if (!candidates.length) {
        continue;
      }

      const picked = pickRandom(candidates);
      windows.push({
        laneId: lane.id,
        stepIndex,
        startQ,
        durationQ,
        sourceTrackId: picked.sourceTrackId,
        sourceSpan: picked.sourceSpan,
      });
      nextAvailableByLane.set(lane.id, startQ + durationQ);
    }
  }

  return windows;
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
