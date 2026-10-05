import { useCallback, useState } from "react";
import type { LoopRegion } from "../app/loop-region.ts";
import type { PlaybackSelection } from "../app/playback-selection.ts";

// The playback selection dragged out in the ruler's loop strip, and the loop
// region L locks it into, which playback loops between. View state only for
// now: neither is saved with the session.
export function useLoopRegion() {
  const [playbackSelection, setPlaybackSelection] =
    useState<PlaybackSelection | null>(null);
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);

  // Turns the playback selection into the loop region, clearing it.
  const lockPlaybackSelection = useCallback(() => {
    if (!playbackSelection) {
      return;
    }

    setLoopRegion({ ...playbackSelection });
    setPlaybackSelection(null);
  }, [playbackSelection]);

  return {
    playbackSelection,
    setPlaybackSelection,
    loopRegion,
    setLoopRegion,
    lockPlaybackSelection,
  };
}
