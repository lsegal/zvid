import { useState } from "react";
import type { PlaybackSelection } from "../app/playback-selection.ts";

// The playback selection dragged out in the ruler's loop strip. View state
// only for now: it doesn't loop playback and isn't saved with the session.
export function useLoopRegion() {
  const [playbackSelection, setPlaybackSelection] =
    useState<PlaybackSelection | null>(null);

  return { playbackSelection, setPlaybackSelection };
}
