// Moving and trimming source clips (source spans), and what the arrangement
// clips that use them show afterwards.
//
// A span plays its media from `trimStartSeconds` at `startQ`. Moving it takes
// its content along; trimming either edge leaves the content in place, so a
// start trim moves `startQ` and `trimStartSeconds` together. Spans moved or
// trimmed onto others in the same source track overwrite them the way clips
// do on a layer.
import {
  getClipDurationQ,
  getSourceTrackEndQ,
  quartersToSeconds,
  secondsToQuarters,
  snapQuarterValue,
} from "./app/timeline-math.ts";
import type {
  ArrangementClip,
  SourceSpan,
  SourceSpanDragState,
  SourceTrackDropTarget,
} from "./app/types.ts";
import { resolveContainerOverlaps } from "./range-edit.ts";

export type SourceSpanDragKind = SourceSpanDragState["kind"];

export type SourceSpanDragLimits = {
  bpm: number;
  fps: number;
  snapUnit: number;
  snap: boolean;
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
 * `origin` moved, or trimmed at one edge, by `deltaQ` quarters, snapped like
 * an arrangement clip. It never starts before 0 or plays from before its
 * media's start, and lasts at least one frame. It may run past its media's
 * end, which loops the media.
 */
export function dragSourceSpan(
  origin: SourceSpan,
  kind: SourceSpanDragKind,
  deltaQ: number,
  { bpm, fps, snapUnit, snap }: SourceSpanDragLimits,
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

  const endQ = snapQuarterValue(originEndQ + deltaQ, snapUnit, snap);
  const durationQ = Math.max(frameQ, endQ - origin.startQ);
  return { ...origin, durationSeconds: quartersToSeconds(durationQ, bpm) };
}

/**
 * Where media dropped on `target` starts: its drop position, overwriting the
 * spans it lands on. A locked existing track keeps its spans in place, so
 * there it goes after the track's last span (undefined); a new track has
 * nothing to overwrite.
 */
export function getDroppedSourceSpanStartQ(
  target: SourceTrackDropTarget,
  isExistingTrack: boolean,
  locked: boolean,
) {
  return isExistingTrack && locked ? undefined : target.startQ;
}

/**
 * Places `dropped`, new spans for one source track in drop order, back to
 * back from `startQ`, overwriting the spans they land on in that track the
 * way a moved span does, and relinks the arrangement clips to match. Without
 * `startQ` they go after the track's last span instead.
 */
export function placeDroppedSourceSpans(
  sourceSpans: SourceSpan[],
  clips: ArrangementClip[],
  dropped: SourceSpan[],
  startQ: number | undefined,
  bpm: number,
) {
  const trackId = dropped[0]?.sourceTrackId ?? "";
  let insertQ = startQ ?? getSourceTrackEndQ(sourceSpans, trackId, bpm);
  const placed = dropped.map((span) => {
    const next = { ...span, startQ: insertQ };
    insertQ += getClipDurationQ(span, bpm);
    return next;
  });

  if (startQ === undefined) {
    return { sourceSpans: [...sourceSpans, ...placed], clips };
  }

  let nextSourceSpans = sourceSpans;
  for (const span of placed) {
    nextSourceSpans = resolveSourceSpanOverlaps(
      [...nextSourceSpans, span],
      span,
      bpm,
    );
  }
  return {
    sourceSpans: nextSourceSpans,
    clips: relinkClipsToSourceSpans(clips, sourceSpans, nextSourceSpans, bpm),
  };
}

/** The media range of `span` an arrangement clip using it may show. */
function getSpanSourceWindow(span: SourceSpan) {
  return {
    sourceWindowStartSeconds: span.trimStartSeconds,
    sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
  };
}

// How far a clip's offset may differ from its span's and still count as on
// it, as when saving.
const SLIP_EPSILON_SECONDS = 1e-6;

/** Media second minus song second for what `span` plays. */
function getSpanSourceOffsetSeconds(span: SourceSpan, bpm: number) {
  return span.trimStartSeconds - quartersToSeconds(span.startQ, bpm);
}

/**
 * The span in `sourceTrackId` that covers `[startQ, startQ + durationQ)`: the
 * one its start falls in, else the one overlapping it most. Undefined when
 * no span in the track overlaps it.
 */
function findCoveringSourceSpan(
  spans: readonly SourceSpan[],
  sourceTrackId: string,
  startQ: number,
  durationQ: number,
  bpm: number,
) {
  const endQ = startQ + durationQ;
  let covering: SourceSpan | undefined;
  let coveringOverlapQ = 0;
  for (const span of spans) {
    if (span.sourceTrackId !== sourceTrackId) {
      continue;
    }
    const spanEndQ = span.startQ + getClipDurationQ(span, bpm);
    if (startQ >= span.startQ && startQ < spanEndQ) {
      return span;
    }
    const overlapQ = Math.min(endQ, spanEndQ) - Math.max(startQ, span.startQ);
    if (overlapQ > coveringOverlapQ) {
      covering = span;
      coveringOverlapQ = overlapQ;
    }
  }
  return covering;
}

/**
 * `clip` playing `span`'s media and warp at the span's offset plus
 * `slipSeconds`, or `clip` itself when that changes nothing.
 */
function pointClipAtSpan(
  clip: ArrangementClip,
  span: SourceSpan,
  slipSeconds: number,
  bpm: number,
): ArrangementClip {
  const sourceOffsetSeconds =
    getSpanSourceOffsetSeconds(span, bpm) + slipSeconds;
  const trimStartSeconds =
    quartersToSeconds(clip.startQ, bpm) + sourceOffsetSeconds;
  const window = getSpanSourceWindow(span);
  if (
    clip.sourceSpanId === span.id &&
    clip.mediaPath === span.mediaPath &&
    clip.mediaId === span.mediaId &&
    clip.warp === span.warp &&
    clip.sourceOffsetSeconds === sourceOffsetSeconds &&
    clip.trimStartSeconds === trimStartSeconds &&
    clip.sourceWindowStartSeconds === window.sourceWindowStartSeconds &&
    clip.sourceWindowEndSeconds === window.sourceWindowEndSeconds
  ) {
    return clip;
  }

  // The clip plays the span's warp, or none.
  const { warp: _warp, mediaId: _mediaId, ...rest } = clip;
  return {
    ...rest,
    sourceSpanId: span.id,
    mediaPath: span.mediaPath,
    ...(span.mediaId !== undefined ? { mediaId: span.mediaId } : {}),
    trimStartSeconds,
    sourceOffsetSeconds,
    ...window,
    ...(span.warp ? { warp: span.warp } : {}),
  };
}

/**
 * The arrangement clips once the source spans changed from `previousSpans`
 * to `spans`, each showing what its source track holds in its range now,
 * matching what reopening the saved session shows. A clip's range is where
 * on its source track the content it shows sits: its own position, shifted
 * by however far it was slipped off its span's offset.
 *
 * - A clip whose span still overlaps its range keeps that span and takes its
 *   media, offset, media range and warp, so moving, trimming, offsetting or
 *   warping the span changes what the clip shows to match.
 * - A clip whose span was removed, or no longer overlaps its range, moves to
 *   the span covering its range in the same source track, keeping its slip.
 * - A clip whose span was removed with nothing left covering its range is
 *   removed, as deleting its source track does. One whose span only moved
 *   away keeps it, showing nothing where the span no longer reaches.
 */
export function relinkClipsToSourceSpans(
  clips: ArrangementClip[],
  previousSpans: readonly SourceSpan[],
  spans: SourceSpan[],
  bpm: number,
) {
  const spansById = new Map(spans.map((span) => [span.id, span]));
  const previousSpansById = new Map(
    previousSpans.map((span) => [span.id, span]),
  );

  return clips.flatMap((clip) => {
    const span = spansById.get(clip.sourceSpanId);
    const previousSpan = previousSpansById.get(clip.sourceSpanId) ?? span;
    if (!previousSpan) {
      return [clip];
    }

    const offsetDifference =
      clip.sourceOffsetSeconds - getSpanSourceOffsetSeconds(previousSpan, bpm);
    // Rounding error alone is no slip.
    const slipSeconds =
      Math.abs(offsetDifference) < SLIP_EPSILON_SECONDS ? 0 : offsetDifference;
    const durationQ = getClipDurationQ(clip, bpm);
    const rangeStartQ = clip.startQ + secondsToQuarters(slipSeconds, bpm);
    const overlapsRange = (candidate: SourceSpan) =>
      candidate.startQ < rangeStartQ + durationQ &&
      candidate.startQ + getClipDurationQ(candidate, bpm) > rangeStartQ;

    const target =
      span && overlapsRange(span)
        ? span
        : (findCoveringSourceSpan(
            spans,
            clip.sourceTrackId,
            rangeStartQ,
            durationQ,
            bpm,
          ) ?? span);
    return target ? [pointClipAtSpan(clip, target, slipSeconds, bpm)] : [];
  });
}
