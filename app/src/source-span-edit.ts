// Moving and trimming source clips (source spans). Arrangement clips show a
// window of their source track, so these edits only change what those
// windows hold (see source-track-content.ts).
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
import { syncClipsToSourceSpans } from "./source-track-content.ts";

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
 * way a moved span does, with the arrangement clips synced to match. Without
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
    const nextSourceSpans = [...sourceSpans, ...placed];
    return {
      sourceSpans: nextSourceSpans,
      clips: syncClipsToSourceSpans(clips, sourceSpans, nextSourceSpans, bpm),
    };
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
    clips: syncClipsToSourceSpans(clips, sourceSpans, nextSourceSpans, bpm),
  };
}
