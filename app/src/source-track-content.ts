// What a media layer clip shows. A layer clip selects a window of time on
// its source track, not a source clip: whatever source clips (spans) the
// track holds in that window is what the clip plays, piece by piece, and
// where the track holds nothing the clip shows and plays nothing. Editing
// the source track never moves, trims, splits or deletes layer clips; it
// only changes what their windows hold.
//
// A clip's window is its own time range shifted by its track offset: song
// second `t` shows source track second `t + trackOffset`. The clip stores
// that offset as `sourceOffsetSeconds - sourceSpanOffsetSeconds`, so moving
// or splitting a layer clip, which shifts `sourceOffsetSeconds` to keep its
// content, shifts its window with it. The clip's media fields describe its
// first piece, for what reads one media per clip (its media state, Gain
// defaults, relinking); what draws or plays it goes piece by piece.
import type { ClipWarp } from "./clip-warp.ts";

// Offsets closer than this to 0 are rounding error, not a slip.
const SLIP_EPSILON_SECONDS = 1e-6;
// Pieces shorter than this, in quarters, are rounding error.
const PIECE_EPSILON_Q = 1e-9;

/** The source clip fields a layer clip's content is resolved from. */
export type TrackContentSpan = {
  id: string;
  sourceTrackId: string;
  // Only the audio mix reads spans without it.
  mediaPath?: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  warp?: ClipWarp;
};

/** The layer clip fields its window on the source track is read from. */
export type TrackContentClip = {
  kind?: string;
  sourceSpanId: string;
  sourceTrackId: string;
  mediaPath: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  sourceSpanOffsetSeconds?: number;
  warp?: ClipWarp;
};

/** A part of a layer clip that shows `span`, from `startQ` to `endQ`. */
export type SourceTrackPiece<Span extends TrackContentSpan> = {
  span: Span;
  startQ: number;
  endQ: number;
};

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

function spanEndQ(span: TrackContentSpan, bpm: number) {
  return span.startQ + secondsToQuarters(span.durationSeconds, bpm);
}

/** Media second minus song second for what `span` plays. */
export function getSpanSourceOffsetSeconds(
  span: Pick<TrackContentSpan, "startQ" | "trimStartSeconds">,
  bpm: number,
) {
  return span.trimStartSeconds - quartersToSeconds(span.startQ, bpm);
}

function withoutRoundingError(seconds: number) {
  return Math.abs(seconds) < SLIP_EPSILON_SECONDS ? 0 : seconds;
}

/**
 * Source track second minus song second for what `clip` shows. A clip that
 * predates `sourceSpanOffsetSeconds` measures its offset against the span it
 * names in `spans`, which must be the spans it was made against; without
 * that span it shows the track at its own position.
 */
export function getClipTrackOffsetSeconds(
  clip: Pick<
    TrackContentClip,
    "sourceSpanId" | "sourceOffsetSeconds" | "sourceSpanOffsetSeconds"
  >,
  spans: readonly TrackContentSpan[],
  bpm: number,
) {
  if (clip.sourceSpanOffsetSeconds !== undefined) {
    return withoutRoundingError(
      clip.sourceOffsetSeconds - clip.sourceSpanOffsetSeconds,
    );
  }
  const span = spans.find((item) => item.id === clip.sourceSpanId);
  return span
    ? withoutRoundingError(
        clip.sourceOffsetSeconds - getSpanSourceOffsetSeconds(span, bpm),
      )
    : 0;
}

/**
 * The parts of a clip from `startQ` lasting `durationSeconds` that show a
 * source clip of `sourceTrackId`, in time order, when it shows that track
 * `trackOffsetSeconds` after its own position. Where source clips overlap,
 * the one starting later is on top, as on a layer. Gaps get no piece.
 */
export function getSourceTrackPieces<Span extends TrackContentSpan>(
  {
    sourceTrackId,
    startQ,
    durationSeconds,
  }: Pick<TrackContentClip, "sourceTrackId" | "startQ" | "durationSeconds">,
  trackOffsetSeconds: number,
  spans: readonly Span[],
  bpm: number,
): SourceTrackPiece<Span>[] {
  const offsetQ = secondsToQuarters(trackOffsetSeconds, bpm);
  const endQ = startQ + secondsToQuarters(durationSeconds, bpm);
  // Each candidate in song time, as this clip shows it.
  const candidates = spans.flatMap((span, index) => {
    if (span.sourceTrackId !== sourceTrackId) {
      return [];
    }
    const fromQ = Math.max(startQ, span.startQ - offsetQ);
    const toQ = Math.min(endQ, spanEndQ(span, bpm) - offsetQ);
    return toQ - fromQ > PIECE_EPSILON_Q
      ? [{ span, index, fromQ, toQ, spanStartQ: span.startQ }]
      : [];
  });
  if (!candidates.length) {
    return [];
  }

  const edges = [
    ...new Set(candidates.flatMap(({ fromQ, toQ }) => [fromQ, toQ])),
  ].sort((left, right) => left - right);
  const pieces: SourceTrackPiece<Span>[] = [];
  for (let edge = 0; edge < edges.length - 1; edge += 1) {
    const fromQ = edges[edge];
    const toQ = edges[edge + 1];
    if (toQ - fromQ <= PIECE_EPSILON_Q) {
      continue;
    }
    const midQ = (fromQ + toQ) / 2;
    let top: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (
        candidate.fromQ <= midQ &&
        midQ < candidate.toQ &&
        (!top ||
          candidate.spanStartQ > top.spanStartQ ||
          (candidate.spanStartQ === top.spanStartQ &&
            candidate.index > top.index))
      ) {
        top = candidate;
      }
    }
    if (!top) {
      continue;
    }
    const previous = pieces[pieces.length - 1];
    if (
      previous &&
      previous.span === top.span &&
      Math.abs(previous.endQ - fromQ) <= PIECE_EPSILON_Q
    ) {
      previous.endQ = toQ;
    } else {
      pieces.push({ span: top.span, startQ: fromQ, endQ: toQ });
    }
  }
  return pieces;
}

/**
 * The parts of media layer clip `clip` that show a source clip, in time
 * order. Fill, text and FX clips show no source track.
 */
export function getClipSourcePieces<Span extends TrackContentSpan>(
  clip: TrackContentClip,
  spans: readonly Span[],
  bpm: number,
) {
  return clip.kind
    ? []
    : getSourceTrackPieces(
        clip,
        getClipTrackOffsetSeconds(clip, spans, bpm),
        spans,
        bpm,
      );
}

// `clip`, from `startQ` lasting `durationSeconds`, playing `span`'s media,
// offset and warp the way `span` plays them `trackOffsetSeconds` later.
function showSpan<Clip extends TrackContentClip>(
  clip: Clip,
  span: TrackContentSpan,
  trackOffsetSeconds: number,
  startQ: number,
  durationSeconds: number,
  bpm: number,
): Clip {
  const spanOffsetSeconds = getSpanSourceOffsetSeconds(span, bpm);
  const sourceOffsetSeconds = trackOffsetSeconds + spanOffsetSeconds;
  // The clip plays the span's media and warp, or none.
  const { warp: _warp, mediaId: _mediaId, ...rest } = clip;
  return {
    ...rest,
    sourceSpanId: span.id,
    mediaPath: span.mediaPath ?? clip.mediaPath,
    ...(span.mediaId !== undefined ? { mediaId: span.mediaId } : {}),
    startQ,
    durationSeconds,
    trimStartSeconds: quartersToSeconds(startQ, bpm) + sourceOffsetSeconds,
    sourceOffsetSeconds,
    sourceSpanOffsetSeconds: spanOffsetSeconds,
    sourceWindowStartSeconds: span.trimStartSeconds,
    sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
    ...(span.warp ? { warp: span.warp } : {}),
  } as Clip;
}

/**
 * Media layer clip `clip` cut into one clip per piece of its source track
 * window, each the part of `clip` that shows one source clip, playing that
 * source clip's media there, with `clip`'s id. A window over nothing gives
 * none. Fill, text and FX clips are themselves.
 */
export function getClipPieceClips<Clip extends TrackContentClip>(
  clip: Clip,
  spans: readonly TrackContentSpan[],
  bpm: number,
): Clip[] {
  if (clip.kind) {
    return [clip];
  }
  const trackOffsetSeconds = getClipTrackOffsetSeconds(clip, spans, bpm);
  return getSourceTrackPieces(clip, trackOffsetSeconds, spans, bpm).map(
    (piece) =>
      showSpan(
        clip,
        piece.span,
        trackOffsetSeconds,
        piece.startQ,
        quartersToSeconds(piece.endQ - piece.startQ, bpm),
        bpm,
      ),
  );
}

const nearlyEqual = (left: number, right: number) =>
  Math.abs(left - right) < SLIP_EPSILON_SECONDS;

// Whether `next` describes the same content as `clip`, so `clip` can stay.
function showsSameSpan(clip: TrackContentClip, next: TrackContentClip) {
  return (
    clip.sourceSpanId === next.sourceSpanId &&
    clip.mediaPath === next.mediaPath &&
    clip.mediaId === next.mediaId &&
    clip.warp === next.warp &&
    clip.sourceSpanOffsetSeconds !== undefined &&
    next.sourceSpanOffsetSeconds !== undefined &&
    nearlyEqual(clip.sourceSpanOffsetSeconds, next.sourceSpanOffsetSeconds) &&
    nearlyEqual(clip.sourceOffsetSeconds, next.sourceOffsetSeconds) &&
    nearlyEqual(clip.trimStartSeconds, next.trimStartSeconds) &&
    nearlyEqual(clip.sourceWindowStartSeconds, next.sourceWindowStartSeconds) &&
    nearlyEqual(clip.sourceWindowEndSeconds, next.sourceWindowEndSeconds)
  );
}

/**
 * The layer clips once the source clips changed from `previousSpans` to
 * `spans`. Each clip keeps its place, length and window on its source
 * track, whatever happened to the source clips it showed; only its media
 * fields follow, to describe the first source clip now in its window. A
 * clip whose window holds nothing keeps them, but shows nothing. Clips are
 * never removed.
 */
export function syncClipsToSourceSpans<Clip extends TrackContentClip>(
  clips: Clip[],
  previousSpans: readonly TrackContentSpan[],
  spans: readonly TrackContentSpan[],
  bpm: number,
): Clip[] {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.kind) {
      return clip;
    }
    const trackOffsetSeconds = getClipTrackOffsetSeconds(
      clip,
      previousSpans,
      bpm,
    );
    const [first] = getSourceTrackPieces(clip, trackOffsetSeconds, spans, bpm);
    if (!first) {
      if (clip.sourceSpanOffsetSeconds !== undefined) {
        return clip;
      }
      // Keep the window the clip showed against the spans it was made with.
      changed = true;
      return {
        ...clip,
        sourceSpanOffsetSeconds: clip.sourceOffsetSeconds - trackOffsetSeconds,
      };
    }
    const synced = showSpan(
      clip,
      first.span,
      trackOffsetSeconds,
      clip.startQ,
      clip.durationSeconds,
      bpm,
    );
    if (showsSameSpan(clip, synced)) {
      return clip;
    }
    changed = true;
    return synced;
  });
  return changed ? next : clips;
}
