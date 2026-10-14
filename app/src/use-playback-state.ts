import { useCallback, useRef } from "react";
import type { LoopRegion } from "./app/loop-region.ts";
import { quartersToSeconds } from "./composition-clip-timing.ts";
import type { CompositionPlaybackState } from "./composition-renderer-state.ts";
import type { PlayheadSignal } from "./playhead-signal";

type PlaybackInputs = Omit<
  CompositionPlaybackState,
  "playheadQ" | "playheadSeconds" | "loop"
> & {
  bpm: number;
  loopRegion?: LoopRegion | null;
};

// Reads the playback state the preview syncs to as it is now: the live
// playhead, the latest flags, and the loop playback wraps at, in seconds.
// The reader stays the same as they change.
export function usePlaybackState(
  inputs: PlaybackInputs,
  playheadSignal: PlayheadSignal,
) {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  return useCallback((): CompositionPlaybackState => {
    const { bpm, loopRegion, ...flags } = inputsRef.current;
    const playheadQ = playheadSignal.get();
    return {
      ...flags,
      playheadQ,
      playheadSeconds: quartersToSeconds(playheadQ, bpm),
      loop:
        loopRegion && loopRegion.endQ > loopRegion.startQ
          ? {
              startSeconds: quartersToSeconds(loopRegion.startQ, bpm),
              endSeconds: quartersToSeconds(loopRegion.endQ, bpm),
            }
          : null,
    };
  }, [playheadSignal]);
}
