// Maps pixels across a waveform canvas to the source seconds they draw, so
// the Audio lane and audio-only clips share one renderer. A clip's range
// starts at its in-point and plays its source at 1×, or through its warp
// markers when warped, and draws nothing outside its source window, where
// the player is silent. Past its media's end it loops the media, as the
// player does.
import { quartersToSeconds } from "./app/timeline-math.ts";
import { type ClipWarp, loopMediaTime, warpSourceTime } from "./clip-warp.ts";

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
  // The media's length, which the played seconds loop past: 0 or unset
  // while it is not known.
  mediaDurationSeconds?: number;
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
  mediaDurationSeconds = 0,
): WaveformSourceRange {
  return {
    startSeconds:
      quartersToSeconds(clip.startQ, bpm) + clip.sourceOffsetSeconds,
    secondsPerPx: 60 / (bpm * quarterPx),
    windowStartSeconds: clip.sourceWindowStartSeconds,
    windowEndSeconds: clip.sourceWindowEndSeconds,
    warp: clip.warp,
    bpm,
    mediaDurationSeconds,
  };
}

// A source clip plays its media from its in-point for its whole duration.
export function getSourceSpanWaveformRange(
  span: { trimStartSeconds: number; durationSeconds: number; warp?: ClipWarp },
  bpm: number,
  quarterPx: number,
  mediaDurationSeconds = 0,
): WaveformSourceRange {
  return {
    startSeconds: span.trimStartSeconds,
    secondsPerPx: 60 / (bpm * quarterPx),
    windowStartSeconds: span.trimStartSeconds,
    windowEndSeconds: span.trimStartSeconds + Math.max(0, span.durationSeconds),
    warp: span.warp,
    bpm,
    mediaDurationSeconds,
  };
}

// The source seconds drawn between two pixels, in increasing order and
// before looping, or null when the span lies outside the window, before the
// source start or the range is unusable.
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

// The media seconds source span `[start, end]` plays once looped into media
// `mediaDurationSeconds` long: itself before the media's end, or while the
// length is not known; otherwise one piece, or two when it crosses the point
// where the media loops back to its start, or the whole media when it is
// longer.
export function loopWaveformSourceSpan(
  [start, end]: [number, number],
  mediaDurationSeconds: number,
): [number, number][] {
  if (!(mediaDurationSeconds > 0) || end <= mediaDurationSeconds) {
    return [[start, end]];
  }
  if (end - start >= mediaDurationSeconds) {
    return [[0, mediaDurationSeconds]];
  }

  const loopedStart = loopMediaTime(start, mediaDurationSeconds);
  const loopedEnd = loopedStart + (end - start);
  return loopedEnd <= mediaDurationSeconds
    ? [[loopedStart, loopedEnd]]
    : [
        [loopedStart, mediaDurationSeconds],
        [0, loopedEnd - mediaDurationSeconds],
      ];
}

// Loop points closer together than this many pixels are left unmarked, as
// they would only smear the clip.
const MIN_LOOP_MARKER_SPACING_PX = 4;

// The pixels, between `startPx` and `endPx`, where the range's media loops
// back to its start: where its played seconds cross a whole number of media
// lengths. None while the media's length is not known, or when they would
// sit closer together than a few pixels.
export function getMediaLoopMarkersPx(
  range: WaveformSourceRange,
  startPx: number,
  endPx: number,
): number[] {
  const duration = range.mediaDurationSeconds ?? 0;
  if (
    !(duration > 0) ||
    !(range.secondsPerPx > 0) ||
    !Number.isFinite(range.secondsPerPx)
  ) {
    return [];
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
    return [];
  }

  const warp = range.warp && range.bpm && range.bpm > 0 ? range.warp : null;
  const played = (linear: number) =>
    warp ? warpSourceTime(warp, linear, range.bpm as number).seconds : linear;
  const firstLoop = Math.max(1, Math.floor(played(linearStart) / duration) + 1);
  const lastLoop = Math.ceil(played(linearEnd) / duration) - 1;
  if (lastLoop < firstLoop) {
    return [];
  }
  const widthPx = endPx - startPx;
  if ((lastLoop - firstLoop + 1) * MIN_LOOP_MARKER_SPACING_PX > widthPx) {
    return [];
  }

  const markers: number[] = [];
  for (let loop = firstLoop; loop <= lastLoop; loop += 1) {
    const target = loop * duration;
    let linear = target;
    if (warp) {
      // Played seconds increase with linear seconds, so bisect for the
      // linear second that plays `target`.
      let low = linearStart;
      let high = linearEnd;
      for (let step = 0; step < 50; step += 1) {
        const middle = (low + high) / 2;
        if (played(middle) < target) {
          low = middle;
        } else {
          high = middle;
        }
      }
      linear = high;
    }
    markers.push((linear - range.startSeconds) / range.secondsPerPx);
  }
  return markers;
}
