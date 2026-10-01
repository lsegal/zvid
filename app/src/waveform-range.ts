// Maps pixels across a waveform canvas to the source seconds they draw, so
// the Audio lane and audio-only clips share one renderer. A clip's range
// starts at its in-point and plays its source at 1×, or through its warp
// markers when warped, and draws nothing outside its source window, where
// the player is silent.
import { quartersToSeconds } from "./app/timeline-math.ts";
import { type ClipWarp, warpSourceTime } from "./clip-warp.ts";

export type WaveformSourceRange = {
  // Linear source seconds at pixel 0, and per CSS pixel.
  startSeconds: number;
  secondsPerPx: number;
  // Linear source seconds outside this window draw nothing.
  windowStartSeconds?: number;
  windowEndSeconds?: number;
  // Maps linear source seconds to the seconds actually played, with the
  // song tempo it needs.
  warp?: ClipWarp;
  bpm?: number;
};

// The part of a clip inside the visible timeline, in pixels from the clip's
// left edge, or null when none of it is visible.
export function getVisibleClipSlice(
  clipLeftPx: number,
  clipWidthPx: number,
  visibleStartPx: number,
  visibleWidthPx: number,
) {
  const startPx = Math.max(0, visibleStartPx - clipLeftPx);
  const endPx = Math.min(
    clipWidthPx,
    visibleStartPx + visibleWidthPx - clipLeftPx,
  );
  return endPx > startPx ? { startPx, widthPx: endPx - startPx } : null;
}

// An arrangement clip plays the song time at its left edge plus its source
// offset, as the player does, then on at the song's rate.
export function getClipWaveformRange(
  clip: {
    startQ: number;
    sourceOffsetSeconds: number;
    sourceWindowStartSeconds: number;
    sourceWindowEndSeconds: number;
    warp?: ClipWarp;
  },
  bpm: number,
  quarterPx: number,
): WaveformSourceRange {
  return {
    startSeconds: quartersToSeconds(clip.startQ, bpm) + clip.sourceOffsetSeconds,
    secondsPerPx: 60 / (bpm * quarterPx),
    windowStartSeconds: clip.sourceWindowStartSeconds,
    windowEndSeconds: clip.sourceWindowEndSeconds,
    warp: clip.warp,
    bpm,
  };
}

// A source clip plays its media from its in-point for its whole duration.
export function getSourceSpanWaveformRange(
  span: { trimStartSeconds: number; durationSeconds: number; warp?: ClipWarp },
  bpm: number,
  quarterPx: number,
): WaveformSourceRange {
  return {
    startSeconds: span.trimStartSeconds,
    secondsPerPx: 60 / (bpm * quarterPx),
    windowStartSeconds: span.trimStartSeconds,
    windowEndSeconds: span.trimStartSeconds + Math.max(0, span.durationSeconds),
    warp: span.warp,
    bpm,
  };
}

// The source seconds drawn between two pixels, in increasing order, or null
// when the span lies outside the window, before the source start or the
// range is unusable.
export function getWaveformSourceSpan(
  range: WaveformSourceRange,
  startPx: number,
  endPx: number,
): [number, number] | null {
  if (!(range.secondsPerPx > 0) || !Number.isFinite(range.secondsPerPx)) {
    return null;
  }

  const linearStart = Math.max(
    range.startSeconds + startPx * range.secondsPerPx,
    range.windowStartSeconds ?? Number.NEGATIVE_INFINITY,
  );
  const linearEnd = Math.min(
    range.startSeconds + endPx * range.secondsPerPx,
    range.windowEndSeconds ?? Number.POSITIVE_INFINITY,
  );
  if (!(linearEnd > linearStart)) {
    return null;
  }

  const warp = range.warp && range.bpm && range.bpm > 0 ? range.warp : null;
  const a = warp
    ? warpSourceTime(warp, linearStart, range.bpm as number).seconds
    : linearStart;
  const b = warp
    ? warpSourceTime(warp, linearEnd, range.bpm as number).seconds
    : linearEnd;
  const start = Math.max(0, Math.min(a, b));
  const end = Math.max(a, b);
  return end > start ? [start, end] : null;
}
