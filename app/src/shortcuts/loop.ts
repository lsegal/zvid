// The loop region in the ruler's loop strip.
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

// L locks the playback selection into the loop region.
export const lockLoopShortcut: Shortcut = {
  id: "loop.lock",
  keys: ["L"],
  when: (context, event) =>
    canEditTimeline(context, event) && context.playbackSelection !== null,
  run: ({ lockPlaybackSelection }, event) => {
    event.preventDefault();
    lockPlaybackSelection();
  },
};
