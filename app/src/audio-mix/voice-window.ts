// Where the preview mix has a voice for a clip, around the playhead, and
// where it plays around the out marker of the loop steady playback wraps
// at (see usePlayback): media, which plays ahead of the playhead with chain
// latency, wraps there just as the playhead does, and clips at the loop's
// start have voices ready for its next pass.

// A clip's element is made this long before the clip starts, so it has
// loaded by then, and released this long after it ends, or after its
// chain's tail when that is longer.
const PRELOAD_SECONDS = 1.5;
// A clip read other than forwards decodes its media and renders its span
// before it can play, so its voice is made this much earlier.
const DECODED_PRELOAD_SECONDS = 8;
const RELEASE_SECONDS = 3;

// On the timeline, in seconds.
export type PlaybackLoop = { startSeconds: number; endSeconds: number };

// Where timeline time `at`, which media plays at while the playhead is at
// `now`, falls with `loop`: past its out marker before the playhead wraps
// there, on into the next pass from its in marker.
export function loopedSeconds(
  now: number,
  at: number,
  loop: PlaybackLoop | null | undefined,
) {
  return loop && now < loop.endSeconds && at >= loop.endSeconds
    ? loop.startSeconds + (at - loop.endSeconds)
    : at;
}

// Whether a clip from `start` to `end` on the timeline, `decoded` or played
// by a media element, is near enough the playhead at `now` to have a voice:
// from shortly before it starts, including in the loop's next pass, until
// shortly after it ends, or after its chain's `tail` when that is longer.
export function nearPlayhead(
  now: number,
  start: number,
  end: number,
  decoded: boolean,
  tail: number,
  loop: PlaybackLoop | null | undefined,
) {
  const preload = decoded ? DECODED_PRELOAD_SECONDS : PRELOAD_SECONDS;
  if (now >= start - preload && now < end + Math.max(RELEASE_SECONDS, tail)) {
    return true;
  }
  if (!loop) {
    return false;
  }
  const at = loopedSeconds(now, now + preload, loop);
  return at !== now + preload && at >= start && end > loop.startSeconds;
}
