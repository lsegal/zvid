// Maps a clip's playback position through its warp markers, so a warped
// clip's video follows its audio the way Live plays it.
//
// A clip's source position is first worked out linearly, as the playhead's
// song time plus the clip's source offset. A warped clip then turns the
// seconds since its warp anchor into song beats, the song beats into clip
// content beats, and the content beats into source seconds through its warp
// markers. Unwarped clips, and clips warped in a straight line at the song
// tempo, carry no warp and play their source at 1×.

export type ClipWarpMarker = {
  /** Position in the clip content, in beats. */
  beatTime: number;
  /** Position in the source, in seconds. */
  secTime: number;
};

export type ClipWarp = {
  /** At least two markers, in strictly increasing beat order. */
  markers: ClipWarpMarker[];
  /** Content beat that plays at `anchorSeconds`. */
  contentStartBeat: number;
  /** Linear source position, in seconds, where `contentStartBeat` plays. */
  anchorSeconds: number;
};

export type WarpedSourceTime = {
  /** Source position in seconds. */
  seconds: number;
  /** Source seconds per song second at that position. */
  rate: number;
};

// A warp whose source speed differs from 1× by less than this is played as
// unwarped.
const LINEAR_RATE_TOLERANCE = 1e-4;

// Markers usable for a warp map: finite, sorted by beat, and without a second
// marker on the same beat, which would make an infinite slope.
function normalizeMarkers(markers: readonly ClipWarpMarker[]) {
  return markers
    .filter(
      (marker) =>
        Number.isFinite(marker.beatTime) && Number.isFinite(marker.secTime),
    )
    .map(({ beatTime, secTime }) => ({ beatTime, secTime }))
    .toSorted((a, b) => a.beatTime - b.beatTime)
    .filter(
      (marker, index, all) =>
        index === 0 || marker.beatTime > all[index - 1].beatTime,
    );
}

// Segment [index, index + 1] containing `value`, clamped to the first and last
// segments so values outside the markers extrapolate, as Live does.
function segmentIndex(
  markers: readonly ClipWarpMarker[],
  value: number,
  of: (marker: ClipWarpMarker) => number,
) {
  let index = 0;
  while (index + 2 < markers.length && of(markers[index + 1]) <= value) {
    index++;
  }
  return index;
}

function beatToSeconds(markers: readonly ClipWarpMarker[], beat: number) {
  const index = segmentIndex(markers, beat, (marker) => marker.beatTime);
  const start = markers[index];
  const end = markers[index + 1];
  const slope = (end.secTime - start.secTime) / (end.beatTime - start.beatTime);
  return { seconds: start.secTime + (beat - start.beatTime) * slope, slope };
}

function secondsToBeat(markers: readonly ClipWarpMarker[], seconds: number) {
  const index = segmentIndex(markers, seconds, (marker) => marker.secTime);
  const start = markers[index];
  const end = markers[index + 1];
  return (
    start.beatTime +
    ((seconds - start.secTime) * (end.beatTime - start.beatTime)) /
      (end.secTime - start.secTime)
  );
}

/**
 * The warp for a session clip, or `undefined` when it plays its source
 * linearly at the song tempo.
 *
 * `sampleStartSeconds` is where the clip's content starts in its warp
 * markers' seconds, `(clipStart + frameOffset) / fps` in a session. It is
 * the source position without any capture offset, so the imported-video
 * sentinel (`captureOffset: -1`), whose markers map beats straight to video
 * seconds, needs no special case here. `anchorSeconds` is the linear source
 * position the clip starts at, with its capture offset applied.
 */
export function createClipWarp(
  warpMarkers: readonly ClipWarpMarker[] | undefined,
  sampleStartSeconds: number,
  anchorSeconds: number,
  bpm: number,
): ClipWarp | undefined {
  const markers = normalizeMarkers(warpMarkers ?? []);
  if (markers.length < 2 || !(bpm > 0)) {
    return undefined;
  }

  // Source seconds per song beat at the song tempo.
  const songSlope = 60 / bpm;
  const isSongTempoLine = markers.slice(1).every((marker, index) => {
    const previous = markers[index];
    const slope =
      (marker.secTime - previous.secTime) /
      (marker.beatTime - previous.beatTime);
    return Math.abs(slope / songSlope - 1) < LINEAR_RATE_TOLERANCE;
  });
  // Seconds must keep increasing with beats for the map to be invertible.
  const isIncreasing = markers
    .slice(1)
    .every((marker, index) => marker.secTime > markers[index].secTime);
  if (isSongTempoLine || !isIncreasing) {
    return undefined;
  }

  return {
    markers,
    contentStartBeat: secondsToBeat(markers, sampleStartSeconds),
    anchorSeconds,
  };
}

/**
 * The source position, in seconds, of a warp's content start: the sample
 * start `createClipWarp` was given.
 */
export function warpSampleStartSeconds(warp: ClipWarp) {
  return beatToSeconds(warp.markers, warp.contentStartBeat).seconds;
}

/**
 * The source position a warped clip plays at `linearSeconds`, the position it
 * would play at 1× (song time plus the clip's source offset).
 */
export function warpSourceTime(
  warp: ClipWarp,
  linearSeconds: number,
  bpm: number,
): WarpedSourceTime {
  const beatsPerSecond = bpm / 60;
  const origin = beatToSeconds(warp.markers, warp.contentStartBeat).seconds;
  const beat =
    warp.contentStartBeat +
    (linearSeconds - warp.anchorSeconds) * beatsPerSecond;
  const { seconds, slope } = beatToSeconds(warp.markers, beat);
  return {
    seconds: warp.anchorSeconds + seconds - origin,
    rate: slope * beatsPerSecond,
  };
}

/**
 * Source position `seconds` in media `mediaDurationSeconds` long, wrapped
 * back to the media's start once it passes the end, so a clip that runs
 * longer than its media loops it. A warped clip loops in warped source time.
 * Positions before the end, and any while the media's length is not known
 * (0), are unchanged.
 */
export function loopMediaTime(seconds: number, mediaDurationSeconds: number) {
  return mediaDurationSeconds > 0 && seconds >= mediaDurationSeconds
    ? seconds % mediaDurationSeconds
    : seconds;
}
