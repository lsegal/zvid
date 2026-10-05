import type { LoopRegion } from "./loop-region.ts";

function isLoop(loop: LoopRegion | null | undefined): loop is LoopRegion {
  return Boolean(loop && loop.endQ > loop.startQ);
}

/**
 * Where Play at `playheadQ` starts with `loop`: from the playhead before the
 * out marker, so playback runs on into the loop, and from the in marker at or
 * past it.
 */
export function loopPlaybackStartQ(
  playheadQ: number,
  loop: LoopRegion | null | undefined,
) {
  return isLoop(loop) && playheadQ >= loop.endQ ? loop.startQ : playheadQ;
}

/**
 * Whether playback at `playheadQ` is headed for `loop`'s out marker, and so
 * wraps there rather than stopping.
 */
export function isBeforeLoopEnd(
  playheadQ: number,
  loop: LoopRegion | null | undefined,
): loop is LoopRegion {
  return isLoop(loop) && playheadQ < loop.endQ;
}

/**
 * Where playback moving from `previousQ` to `nextQ` continues with `loop`:
 * crossing the out marker, back past the in marker by as far as it overshot;
 * otherwise undefined. Playback already past the out marker, as when the loop
 * is drawn or moved behind the playhead, plays on.
 */
export function wrapLoopPlaybackQ(
  previousQ: number,
  nextQ: number,
  loop: LoopRegion | null | undefined,
) {
  if (!isBeforeLoopEnd(previousQ, loop) || nextQ < loop.endQ) {
    return undefined;
  }
  const lengthQ = loop.endQ - loop.startQ;
  return loop.startQ + ((nextQ - loop.endQ) % lengthQ);
}
