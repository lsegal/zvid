// The arrangement wand fills the main layers with windows onto the source
// tracks. A window only shows footage where its source track really has a
// clip, so every window starts inside a source span on its own track and ends
// no later than that span does.

const EPSILON = 0.0001;

export interface CoverageSpan {
  sourceTrackId: string;
  startQ: number;
}

export interface RandomArrangementOptions<S extends CoverageSpan> {
  /** Main layers, bottom first. The first layer is filled without gaps. */
  laneIds: readonly string[];
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
 * Builds a random arrangement. The first layer covers every stretch where at
 * least one source has a clip; each upper layer is half as likely as the one
 * below it to start a window on each grid step.
 */
export function buildRandomArrangement<S extends CoverageSpan>(
  options: RandomArrangementOptions<S>,
): RandomArrangementWindow<S>[] {
  const {
    laneIds,
    sourceTrackIds,
    spans,
    spanEndQ,
    timelineEndQ,
    stepQ,
    durationSteps,
    random,
  } = options;
  const windows: RandomArrangementWindow<S>[] = [];

  const coveringSpans = (startQ: number) =>
    sourceTrackIds.flatMap((trackId) => {
      const span = sourceSpanCovering(spans, spanEndQ, trackId, startQ);
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

  const [baseLaneId, ...upperLaneIds] = laneIds;
  if (baseLaneId !== undefined) {
    let startQ = 0;
    while (startQ < timelineEndQ - EPSILON) {
      const candidates = coveringSpans(startQ);
      if (candidates.length) {
        // Near the end, a window shorter than every step still closes the gap.
        startQ = placeWindow(
          baseLaneId,
          startQ,
          candidates,
          durationsFrom(startQ),
        );
        continue;
      }

      // No source has footage here, so skip to where the next clip begins.
      const nextStartQ = spans.reduce(
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

      const candidates = coveringSpans(startQ);
      const validDurations = durationsFrom(startQ);
      if (!candidates.length || !validDurations.length) {
        continue;
      }
      nextAvailableQ = placeWindow(laneId, startQ, candidates, validDurations);
    }
  }

  return windows;
}
