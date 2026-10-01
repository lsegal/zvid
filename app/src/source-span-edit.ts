// Moving and trimming source clips (source spans), and what the arrangement
// clips that use them show afterwards.
//
// A span plays its media from `trimStartSeconds` at `startQ`. Moving it takes
// its content along; trimming either edge leaves the content in place, so a
// start trim moves `startQ` and `trimStartSeconds` together. Spans moved or
// trimmed onto others in the same source track overwrite them the way clips
// do on a layer.
import {
  chooseSourceSpanForWindow,
  getClipDurationQ,
  quartersToSeconds,
  secondsToQuarters,
  snapQuarterValue,
} from "./app/timeline-math.ts";
import type {
  ArrangementClip,
  SourceSpan,
  SourceSpanDragState,
} from "./app/types.ts";
import { warpSourceTime } from "./clip-warp.ts";
import { resolveContainerOverlaps } from "./range-edit.ts";

export type SourceSpanDragKind = SourceSpanDragState["kind"];

export type SourceSpanDragLimits = {
  bpm: number;
  fps: number;
  snapUnit: number;
  snap: boolean;
  /** The span's media length in seconds; 0 when it is not known yet. */
  mediaDurationSeconds: number;
};

/** `span` cut down to `[startQ, startQ + durationQ)`, its content in place. */
export function retimeSourceSpan(
  span: SourceSpan,
  startQ: number,
  durationQ: number,
  bpm: number,
): SourceSpan {
  return {
    ...span,
    startQ,
    durationSeconds: quartersToSeconds(durationQ, bpm),
    trimStartSeconds:
      span.trimStartSeconds + quartersToSeconds(startQ - span.startQ, bpm),
  };
}

/**
 * Places `activeSpan` and trims the spans it overlaps in its source track
 * exactly as `resolveClipOverlaps` does on a layer. Other tracks are
 * unchanged.
 */
export function resolveSourceSpanOverlaps(
  spans: SourceSpan[],
  activeSpan: SourceSpan,
  bpm: number,
) {
  return resolveContainerOverlaps(spans, activeSpan, bpm, {
    containerOf: (span) => span.sourceTrackId,
    retime: (span, startQ, durationQ) =>
      retimeSourceSpan(span, startQ, durationQ, bpm),
  });
}

/**
 * The longest `span` can play, in seconds, before its media runs out:
 * infinite while the media's length is unknown. A warped span plays its
 * media at the warp's rate, so its limit is where the warp reaches the end.
 */
export function getSourceSpanMaxSeconds(
  span: Pick<SourceSpan, "trimStartSeconds" | "warp">,
  mediaDurationSeconds: number,
  bpm: number,
) {
  if (!(mediaDurationSeconds > 0)) {
    return Number.POSITIVE_INFINITY;
  }

  const { warp } = span;
  if (!warp) {
    return Math.max(0, mediaDurationSeconds - span.trimStartSeconds);
  }

  const mediaTimeAfter = (seconds: number) =>
    warpSourceTime(warp, span.trimStartSeconds + seconds, bpm).seconds;
  if (mediaTimeAfter(0) >= mediaDurationSeconds) {
    return 0;
  }

  let low = 0;
  let high = mediaDurationSeconds;
  while (mediaTimeAfter(high) < mediaDurationSeconds) {
    high *= 2;
    if (high > 1e7) {
      return Number.POSITIVE_INFINITY;
    }
  }
  // The warp map increases, so bisect for where it reaches the end.
  for (let step = 0; step < 50; step += 1) {
    const middle = (low + high) / 2;
    if (mediaTimeAfter(middle) <= mediaDurationSeconds) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * `origin` moved, or trimmed at one edge, by `deltaQ` quarters, snapped like
 * an arrangement clip. It never starts before 0, never plays from before its
 * media's start or past its end, and lasts at least one frame.
 */
export function dragSourceSpan(
  origin: SourceSpan,
  kind: SourceSpanDragKind,
  deltaQ: number,
  { bpm, fps, snapUnit, snap, mediaDurationSeconds }: SourceSpanDragLimits,
): SourceSpan {
  const frameQ = secondsToQuarters(1 / fps, bpm);
  const originEndQ = origin.startQ + getClipDurationQ(origin, bpm);

  if (kind === "move") {
    return {
      ...origin,
      startQ: Math.max(
        0,
        snapQuarterValue(origin.startQ + deltaQ, snapUnit, snap),
      ),
    };
  }

  if (kind === "resize-start") {
    const latestQ = originEndQ - frameQ;
    // Where the span would play its media from 0.
    const mediaStartQ =
      origin.startQ - secondsToQuarters(origin.trimStartSeconds, bpm);
    const earliestQ = Math.min(latestQ, Math.max(0, mediaStartQ));
    const startQ = Math.min(
      latestQ,
      Math.max(
        earliestQ,
        snapQuarterValue(origin.startQ + deltaQ, snapUnit, snap),
      ),
    );
    return retimeSourceSpan(origin, startQ, originEndQ - startQ, bpm);
  }

  const maxDurationQ = Math.max(
    frameQ,
    secondsToQuarters(
      getSourceSpanMaxSeconds(origin, mediaDurationSeconds, bpm),
      bpm,
    ),
  );
  const endQ = snapQuarterValue(originEndQ + deltaQ, snapUnit, snap);
  const durationQ = Math.min(
    maxDurationQ,
    Math.max(frameQ, endQ - origin.startQ),
  );
  return { ...origin, durationSeconds: quartersToSeconds(durationQ, bpm) };
}

/** The media range of `span` an arrangement clip using it may show. */
function getSpanSourceWindow(span: SourceSpan) {
  return {
    sourceWindowStartSeconds: span.trimStartSeconds,
    sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
  };
}

/**
 * The arrangement clips once the source spans changed from `previousSpans`
 * to `spans`, matching what reopening the saved session shows:
 *
 * - A clip whose span is still there keeps pointing at it and keeps its own
 *   timing and source offset, so moving a span changes nothing it shows. It
 *   takes the span's new media range, so trimming the span trims what the
 *   clip can show to match.
 * - A clip whose span was removed by an overlap becomes a window on the span
 *   `chooseSourceSpanForWindow` picks for its position in the same source
 *   track, playing that span's media at that span's offset.
 */
export function relinkClipsToSourceSpans(
  clips: ArrangementClip[],
  previousSpans: readonly SourceSpan[],
  spans: SourceSpan[],
  bpm: number,
) {
  const spansById = new Map(spans.map((span) => [span.id, span]));
  const removedSpanIds = new Set(
    previousSpans
      .filter((span) => !spansById.has(span.id))
      .map((span) => span.id),
  );

  return clips.map((clip) => {
    const span = spansById.get(clip.sourceSpanId);
    if (span) {
      const window = getSpanSourceWindow(span);
      return clip.sourceWindowStartSeconds ===
        window.sourceWindowStartSeconds &&
        clip.sourceWindowEndSeconds === window.sourceWindowEndSeconds
        ? clip
        : { ...clip, ...window };
    }

    if (!removedSpanIds.has(clip.sourceSpanId)) {
      return clip;
    }

    const replacement = chooseSourceSpanForWindow(
      spans,
      clip.sourceTrackId,
      clip.startQ,
      getClipDurationQ(clip, bpm),
      bpm,
    );
    if (!replacement) {
      return clip;
    }

    const sourceOffsetSeconds =
      replacement.trimStartSeconds - quartersToSeconds(replacement.startQ, bpm);
    // The clip plays the replacement span's warp, or none.
    const { warp: _warp, ...unwarped } = clip;
    return {
      ...unwarped,
      sourceSpanId: replacement.id,
      mediaPath: replacement.mediaPath,
      mediaId: replacement.mediaId,
      trimStartSeconds:
        quartersToSeconds(clip.startQ, bpm) + sourceOffsetSeconds,
      sourceOffsetSeconds,
      ...getSpanSourceWindow(replacement),
      ...(replacement.warp ? { warp: replacement.warp } : {}),
    };
  });
}
