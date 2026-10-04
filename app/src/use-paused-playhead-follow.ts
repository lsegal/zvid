import { useEffect, useRef } from "react";
import type { PlayheadSignal } from "./playhead-signal";

// Calls `follow` once a frame after the playhead signal moves while paused,
// as seeks and drag-scrubbing move it. Playback follows the signal in its own
// loop instead.
export function usePausedPlayheadFollow(
  signal: PlayheadSignal,
  isPlaying: boolean,
  follow: () => void,
) {
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    let frame = 0;
    const unsubscribe = signal.subscribe(() => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        followRef.current();
      });
    });

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(frame);
    };
  }, [isPlaying, signal]);
}
