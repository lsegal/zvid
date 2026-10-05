import type { LoopRegion } from "./loop-region.ts";

export type SkipDirection = "back" | "forward";

export type SkipTarget = { targetQ: number; label: string };

// How close the playhead must be to a marker to count as at it.
const SKIP_EPSILON = 0.0001;

/**
 * Where the transport's outer skip buttons jump from `playheadQ`: back to the
 * loop's in marker from inside the loop, to its out marker from past it, and
 * to the timeline start otherwise; forward to the loop's out marker from
 * inside the loop, to its in marker from before it, and to `endQ`, where
 * playback stops, otherwise. `label` names the destination.
 */
export function skipTarget(
  direction: SkipDirection,
  playheadQ: number,
  loop: LoopRegion | null | undefined,
  endQ: number,
): SkipTarget {
  const timelineStart = { targetQ: 0, label: "Jump to timeline start" };
  const timelineEnd = { targetQ: endQ, label: "Jump to timeline end" };
  if (!loop || loop.endQ <= loop.startQ) {
    return direction === "back" ? timelineStart : timelineEnd;
  }

  const loopStart = { targetQ: loop.startQ, label: "Jump to loop start" };
  const loopEnd = { targetQ: loop.endQ, label: "Jump to loop end" };
  const afterStart = playheadQ > loop.startQ + SKIP_EPSILON;
  const beforeEnd = playheadQ < loop.endQ - SKIP_EPSILON;
  if (direction === "back") {
    if (playheadQ > loop.endQ + SKIP_EPSILON) {
      return loopEnd;
    }
    return afterStart ? loopStart : timelineStart;
  }
  if (playheadQ < loop.startQ - SKIP_EPSILON) {
    return loopStart;
  }
  return beforeEnd ? loopEnd : timelineEnd;
}

export type PlayFromLoopStartActions = {
  isPlaying: boolean;
  // Plain Play: starts playback, or pauses it while playing.
  togglePlayback: () => void;
  jumpPlayheadTo: (targetQ: number) => void;
  startPlayback: (fromQ: number) => void;
};

/**
 * Ctrl/Cmd+Play: moves the playhead to the loop's in marker and plays from
 * there, restarting playback that is already running rather than pausing it.
 * Without a loop it is plain Play.
 */
export function playFromLoopStart(
  loop: LoopRegion | null | undefined,
  { isPlaying, togglePlayback, jumpPlayheadTo, startPlayback }: PlayFromLoopStartActions,
) {
  if (!loop || loop.endQ <= loop.startQ) {
    togglePlayback();
    return;
  }

  // Playback already running restarts from the new playhead by itself.
  jumpPlayheadTo(loop.startQ);
  if (!isPlaying) {
    startPlayback(loop.startQ);
  }
}
