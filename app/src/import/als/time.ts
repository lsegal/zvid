// Beat→time engine for Ableton Live Set (.als) import. These are pure
// functions over plain objects, so they don't depend on the ALS parser:
//
// - a tempo map turns arrangement beats into seconds (and back), following
//   the master tempo automation,
// - a warp map turns clip-content beats into sample seconds (and back),
// - loop unrolling turns one arrangement clip into the contiguous segments
//   it plays,
// - frame helpers turn beats into video frames.

export type TempoPoint = {
  /** Arrangement position in beats. */
  beat: number;
  bpm: number;
};

export type TempoMap = {
  beatsToSeconds(beats: number): number;
  secondsToBeats(seconds: number): number;
};

/**
 * Builds an arrangement beats ↔ seconds map from master tempo automation.
 *
 * Between two points Live ramps linearly in BPM over beats, so the time spent
 * is the integral of 60/bpm(b) db: a log for a ramp, a linear term when the
 * tempo is constant. Before the first point and after the last, that point's
 * tempo holds. Beat 0 is always at 0 seconds, even when the first point sits
 * far before it (Live stores constant tempo as one point at beat -63072000).
 *
 * Points with a non-finite beat or a non-positive BPM are ignored. Without any
 * usable point the map runs at `fallbackBpm`.
 */
export function createTempoMap(
  points: readonly TempoPoint[],
  fallbackBpm: number,
): TempoMap {
  const sorted = points
    .filter((point) => Number.isFinite(point.beat) && point.bpm > 0)
    .toSorted((a, b) => a.beat - b.beat);
  if (sorted.length === 0) {
    if (!(fallbackBpm > 0)) {
      throw new RangeError(`Invalid fallback tempo: ${fallbackBpm} BPM`);
    }
    sorted.push({ beat: 0, bpm: fallbackBpm });
  }

  // Seconds spent going `delta` beats from a point at `bpm` with `rate` BPM
  // per beat, and its inverse. log1p/expm1 keep near-constant ramps precise.
  const secondsAcross = (bpm: number, rate: number, delta: number) =>
    rate === 0
      ? (60 * delta) / bpm
      : (60 / rate) * Math.log1p((rate * delta) / bpm);
  const beatsAcross = (bpm: number, rate: number, seconds: number) =>
    rate === 0
      ? (seconds * bpm) / 60
      : (bpm * Math.expm1((rate * seconds) / 60)) / rate;

  // One region before the first point, then one starting at each point, with
  // `rate` BPM per beat until the next. Each region measures time from an
  // anchor inside it: its first point, or beat 0 for the region containing
  // it, so a far-away first point doesn't cost precision near beat 0.
  const regions = [
    {
      startBeat: Number.NEGATIVE_INFINITY,
      startSeconds: Number.NEGATIVE_INFINITY,
      anchorBeat: sorted[0].beat,
      anchorBpm: sorted[0].bpm,
      anchorSeconds: 0,
      rate: 0,
    },
    ...sorted.map((point, index) => {
      const next = sorted[index + 1];
      const length = next ? next.beat - point.beat : 0;
      return {
        startBeat: point.beat,
        startSeconds: 0,
        anchorBeat: point.beat,
        anchorBpm: point.bpm,
        anchorSeconds: 0,
        rate: length > 0 ? (next.bpm - point.bpm) / length : 0,
      };
    }),
  ];
  type Region = (typeof regions)[number];

  const secondsIn = (region: Region, beat: number) =>
    region.anchorSeconds +
    secondsAcross(region.anchorBpm, region.rate, beat - region.anchorBeat);

  // Last region starting at or before `beat`.
  const regionOfBeat = (beat: number) => {
    let index = 0;
    while (index + 1 < regions.length && regions[index + 1].startBeat <= beat) {
      index++;
    }
    return regions[index];
  };

  // Anchor the region containing beat 0 there, then accumulate outward.
  const origin = regionOfBeat(0);
  const originIndex = regions.indexOf(origin);
  origin.anchorBpm -= origin.rate * origin.anchorBeat;
  origin.anchorBeat = 0;
  for (let index = originIndex + 1; index < regions.length; index++) {
    regions[index].anchorSeconds = secondsIn(
      regions[index - 1],
      regions[index].anchorBeat,
    );
  }
  for (let index = originIndex - 1; index >= 0; index--) {
    const region = regions[index];
    const end = regions[index + 1].startBeat;
    region.anchorSeconds =
      secondsIn(regions[index + 1], end) -
      secondsAcross(region.anchorBpm, region.rate, end - region.anchorBeat);
  }
  for (const region of regions.slice(1)) {
    region.startSeconds = secondsIn(region, region.startBeat);
  }

  return {
    beatsToSeconds: (beat) => secondsIn(regionOfBeat(beat), beat),
    secondsToBeats(seconds) {
      let index = 0;
      while (
        index + 1 < regions.length &&
        regions[index + 1].startSeconds <= seconds
      ) {
        index++;
      }
      const region = regions[index];
      return (
        region.anchorBeat +
        beatsAcross(region.anchorBpm, region.rate, seconds - region.anchorSeconds)
      );
    },
  };
}

export type WarpMarker = {
  /** Position in the sample, in seconds. */
  secTime: number;
  /** Position in the clip content, in beats. */
  beatTime: number;
};

export type WarpMap = {
  beatToSampleSec(beat: number): number;
  sampleSecToBeat(seconds: number): number;
};

/**
 * Builds a clip-content beats ↔ sample seconds map.
 *
 * A warped clip maps piecewise-linearly through its warp markers, extending
 * the first segment's slope before the first marker and the last segment's
 * slope past the last one. Live often stores just two markers a fraction of a
 * beat apart, so extrapolation covers nearly the whole clip.
 *
 * An unwarped clip plays the sample at native speed and Live stores its
 * content positions in sample seconds, so its map is the identity. How many
 * arrangement beats it covers depends on the tempo map; see `unrollClipLoop`.
 */
export function createWarpMap(
  markers: readonly WarpMarker[],
  isWarped: boolean,
): WarpMap {
  if (!isWarped) {
    return {
      beatToSampleSec: (beat) => beat,
      sampleSecToBeat: (seconds) => seconds,
    };
  }

  // Drop markers that share a beat with the previous one; they would make a
  // zero-length segment with an infinite slope.
  const sorted = markers
    .filter((marker) => Number.isFinite(marker.beatTime) && Number.isFinite(marker.secTime))
    .toSorted((a, b) => a.beatTime - b.beatTime)
    .filter((marker, index, all) => index === 0 || marker.beatTime > all[index - 1].beatTime);
  if (sorted.length < 2) {
    throw new RangeError("A warped clip needs at least two warp markers");
  }

  const last = sorted.length - 1;
  const interpolate = (
    value: number,
    from: (marker: WarpMarker) => number,
    to: (marker: WarpMarker) => number,
  ) => {
    // Segment [index, index + 1] containing `value`, clamped to the first and
    // last segments so values outside the markers extrapolate.
    let index = 0;
    while (index + 1 < last && from(sorted[index + 1]) <= value) {
      index++;
    }
    const start = sorted[index];
    const end = sorted[index + 1];
    const ratio = (value - from(start)) / (from(end) - from(start));
    return to(start) + ratio * (to(end) - to(start));
  };
  const beatOf = (marker: WarpMarker) => marker.beatTime;
  const secOf = (marker: WarpMarker) => marker.secTime;

  return {
    beatToSampleSec: (beat) => interpolate(beat, beatOf, secOf),
    sampleSecToBeat: (seconds) => interpolate(seconds, secOf, beatOf),
  };
}

export type ArrangementClip = {
  /** Arrangement span of the clip, in beats. */
  currentStart: number;
  currentEnd: number;
  loopOn: boolean;
  /** Clip-content positions: beats when warped, sample seconds when not. */
  loopStart: number;
  loopEnd: number;
  startRelative: number;
  hiddenLoopStart: number;
  hiddenLoopEnd: number;
};

export type ClipSegment = {
  arrStartBeat: number;
  arrEndBeat: number;
  /**
   * Clip-content position playing at `arrStartBeat`: beats when warped,
   * sample seconds when not.
   */
  contentStartBeat: number;
};

export type UnrolledClip = {
  segments: ClipSegment[];
  hiddenLoopStart: number;
  hiddenLoopEnd: number;
};

export type UnrollOptions = {
  /**
   * Required for unwarped clips, whose content advances in seconds rather
   * than beats. Defaults to true.
   */
  isWarped?: boolean;
  tempoMap?: TempoMap;
};

// Content left over after float error, below which no segment is emitted.
const EPSILON = 1e-9;

/**
 * Unrolls one arrangement clip into the contiguous segments it plays, in
 * order.
 *
 * Without looping, the content starts at `loopStart` (the start marker) and
 * runs straight through to `currentEnd`. With looping, playback starts at
 * `loopStart + startRelative`, runs to `loopEnd`, then wraps to `loopStart`
 * and repeats until `currentEnd`, with one segment per pass.
 *
 * A warped clip's content advances one beat per arrangement beat. An unwarped
 * clip's content advances one second per arrangement second, measured with
 * `options.tempoMap`.
 */
export function unrollClipLoop(
  clip: ArrangementClip,
  options: UnrollOptions = {},
): UnrolledClip {
  const { isWarped = true, tempoMap } = options;
  if (!isWarped && !tempoMap) {
    throw new TypeError("Unrolling an unwarped clip needs a tempo map");
  }

  // Content elapsed since `currentStart`, and the arrangement beat at which a
  // given amount of content has elapsed.
  let contentLength = clip.currentEnd - clip.currentStart;
  let arrBeatAt = (elapsed: number) => clip.currentStart + elapsed;
  if (!isWarped && tempoMap) {
    const startSeconds = tempoMap.beatsToSeconds(clip.currentStart);
    contentLength = tempoMap.beatsToSeconds(clip.currentEnd) - startSeconds;
    arrBeatAt = (elapsed) => tempoMap.secondsToBeats(startSeconds + elapsed);
  }

  const segments: ClipSegment[] = [];
  const loopLength = clip.loopEnd - clip.loopStart;
  if (!clip.loopOn || !(loopLength > 0)) {
    if (contentLength > EPSILON) {
      segments.push({
        arrStartBeat: clip.currentStart,
        arrEndBeat: clip.currentEnd,
        contentStartBeat: clip.loopStart,
      });
    }
  } else {
    // Wrap a start position outside the loop back into it.
    const offset = clip.startRelative % loopLength;
    let position = clip.loopStart + (offset < 0 ? offset + loopLength : offset);
    let elapsed = 0;
    while (contentLength - elapsed > EPSILON) {
      let passEnd = elapsed + clip.loopEnd - position;
      if (contentLength - passEnd <= EPSILON) {
        passEnd = contentLength;
      }
      segments.push({
        arrStartBeat: segments.length === 0 ? clip.currentStart : arrBeatAt(elapsed),
        arrEndBeat: passEnd === contentLength ? clip.currentEnd : arrBeatAt(passEnd),
        contentStartBeat: position,
      });
      elapsed = passEnd;
      position = clip.loopStart;
    }
  }

  return {
    segments,
    hiddenLoopStart: clip.hiddenLoopStart,
    hiddenLoopEnd: clip.hiddenLoopEnd,
  };
}

/** Converts seconds to a frame index, rounding to the nearest frame. */
export function secondsToFrames(seconds: number, fps: number) {
  return Math.round(seconds * fps);
}

/**
 * Converts an arrangement position in beats to a frame index.
 *
 * Rounds to the nearest frame with `Math.round`, so exact halves round up
 * (toward +∞). This matches the frame values the Layers app wrote to `.lvp`
 * files, e.g. 22.25 beats at 126.404495 BPM and 30 fps is 316.84 → 317.
 */
export function beatsToFrames(beats: number, tempoMap: TempoMap, fps: number) {
  return secondsToFrames(tempoMap.beatsToSeconds(beats), fps);
}
