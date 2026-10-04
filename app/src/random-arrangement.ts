// The arrangement wand fills the main layers with windows onto the source
// tracks. A window only shows footage where its source track really has a
// clip, so every window starts inside a source span on its own track and ends
// no later than that span does. Video layers only take video spans; audio-only
// spans go on a separate audio layer.

const EPSILON = 0.0001;

export interface CoverageSpan {
  sourceTrackId: string;
  startQ: number;
}

export interface RandomArrangementOptions<S extends CoverageSpan> {
  /** Video layers, bottom first. The first layer is filled without gaps. */
  laneIds: readonly string[];
  /**
   * The layer audio-only spans go on. It is filled without gaps wherever an
   * audio-only span has sound, or holds one uncut window when a single span
   * covers the whole timeline.
   */
  audioLaneId?: string;
  /** Whether a span has sound but no picture. Defaults to none. */
  isAudioOnly?: (span: S) => boolean;
  sourceTrackIds: readonly string[];
  spans: readonly S[];
  spanEndQ: (span: S) => number;
  timelineEndQ: number;
  /** The grid upper layers start their windows on. */
  stepQ: number;
  /** The window lengths to choose from, before clamping to the span. */
  durationSteps: readonly number[];
  /** Returns a number in [0, 1). */
  random: () => number;
}

export interface RandomArrangementWindow<S extends CoverageSpan> {
  laneId: string;
  startQ: number;
  durationQ: number;
  span: S;
}

/**
 * Returns the span on `sourceTrackId` whose `[startQ, endQ)` contains
 * `startQ`, or `undefined` when that track has no clip there.
 */
export function sourceSpanCovering<S extends CoverageSpan>(
  spans: readonly S[],
  spanEndQ: (span: S) => number,
  sourceTrackId: string,
  startQ: number,
) {
  return spans.find(
    (span) =>
      span.sourceTrackId === sourceTrackId &&
      startQ >= span.startQ - EPSILON &&
      startQ < spanEndQ(span) - EPSILON,
  );
}

/**
 * Whether `sourceTrackId` has a clip anywhere in `[startQ, endQ)`, so a
 * window on it over that range shows at least some footage.
 */
export function sourceTrackHasFootage<S extends CoverageSpan>(
  spans: readonly S[],
  spanEndQ: (span: S) => number,
  sourceTrackId: string,
  startQ: number,
  endQ: number,
) {
  return spans.some(
    (span) =>
      span.sourceTrackId === sourceTrackId &&
      span.startQ < endQ - EPSILON &&
      spanEndQ(span) > startQ + EPSILON,
  );
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/**
 * Builds a random arrangement. The first video layer covers every stretch
 * where at least one video source has a clip; each upper layer is half as
 * likely as the one below it to start a window on each grid step. The audio
 * layer is filled like the first layer from the audio-only sources.
 */
export function buildRandomArrangement<S extends CoverageSpan>(
  options: RandomArrangementOptions<S>,
): RandomArrangementWindow<S>[] {
  const {
    laneIds,
    audioLaneId,
    isAudioOnly = () => false,
    sourceTrackIds,
    spans,
    spanEndQ,
    timelineEndQ,
    stepQ,
    durationSteps,
    random,
  } = options;
  const windows: RandomArrangementWindow<S>[] = [];

  const videoSpans = spans.filter((span) => !isAudioOnly(span));
  const audioSpans = spans.filter(isAudioOnly);

  const coveringSpans = (candidates: readonly S[], startQ: number) =>
    sourceTrackIds.flatMap((trackId) => {
      const span = sourceSpanCovering(candidates, spanEndQ, trackId, startQ);
      return span ? [span] : [];
    });

  const placeWindow = (
    laneId: string,
    startQ: number,
    candidates: readonly S[],
    validDurations: readonly number[],
  ) => {
    const chosenQ = validDurations.length
      ? pick(validDurations, random)
      : timelineEndQ - startQ;
    const span = pick(candidates, random);
    const durationQ = Math.min(
      chosenQ,
      spanEndQ(span) - startQ,
      timelineEndQ - startQ,
    );
    windows.push({ laneId, startQ, durationQ, span });
    return startQ + durationQ;
  };

  const durationsFrom = (startQ: number) =>
    durationSteps.filter(
      (durationQ) => startQ + durationQ <= timelineEndQ + EPSILON,
    );

  // Covers every stretch where one of `candidates` has a clip.
  const fillLane = (laneId: string, candidates: readonly S[]) => {
    let startQ = 0;
    while (startQ < timelineEndQ - EPSILON) {
      const covering = coveringSpans(candidates, startQ);
      if (covering.length) {
        // Near the end, a window shorter than every step still closes the gap.
        startQ = placeWindow(laneId, startQ, covering, durationsFrom(startQ));
        continue;
      }

      // No source has footage here, so skip to where the next clip begins.
      const nextStartQ = candidates.reduce(
        (nearest, span) =>
          span.startQ > startQ + EPSILON && span.startQ < nearest
            ? span.startQ
            : nearest,
        Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(nextStartQ)) {
        break;
      }
      startQ = nextStartQ;
    }
  };

  const [baseLaneId, ...upperLaneIds] = laneIds;
  if (baseLaneId !== undefined) {
    fillLane(baseLaneId, videoSpans);
  }

  const stepCount = Math.max(1, Math.ceil(timelineEndQ / stepQ));
  for (const [upperIndex, laneId] of upperLaneIds.entries()) {
    const layerChance = 0.5 ** (upperIndex + 1);
    let nextAvailableQ = 0;
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const startQ = stepIndex * stepQ;
      if (startQ >= timelineEndQ - EPSILON) {
        break;
      }
      if (startQ < nextAvailableQ - EPSILON) {
        continue;
      }
      if (random() > layerChance) {
        continue;
      }

      const candidates = coveringSpans(videoSpans, startQ);
      const validDurations = durationsFrom(startQ);
      if (!candidates.length || !validDurations.length) {
        continue;
      }
      nextAvailableQ = placeWindow(laneId, startQ, candidates, validDurations);
    }
  }

  if (audioLaneId !== undefined) {
    // One audio clip that runs the whole timeline is used without cuts.
    const fullLengthSpan = sourceTrackIds
      .map((trackId) => sourceSpanCovering(audioSpans, spanEndQ, trackId, 0))
      .find(
        (span) =>
          span !== undefined && spanEndQ(span) >= timelineEndQ - EPSILON,
      );
    if (fullLengthSpan && timelineEndQ > EPSILON) {
      windows.push({
        laneId: audioLaneId,
        startQ: 0,
        durationQ: timelineEndQ,
        span: fullLengthSpan,
      });
    } else {
      fillLane(audioLaneId, audioSpans);
    }
  }

  return windows;
}
