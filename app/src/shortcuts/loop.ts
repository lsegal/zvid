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

// Ctrl/Cmd+L sets the loop region to the timeline selection, the lane range
// before the playback selection, or clears it when nothing is selected.
export const toggleLoopShortcut: Shortcut = {
  id: "loop.toggle",
  keys: ["Mod+L"],
  when: canEditTimeline,
  run: (
    {
      lockPlaybackSelection,
      pendingSelection,
      playbackSelection,
      setLoopRegion,
    },
    event,
  ) => {
    event.preventDefault();
    if (pendingSelection && pendingSelection.durationQ > 0) {
      setLoopRegion({
        startQ: pendingSelection.startQ,
        endQ: pendingSelection.startQ + pendingSelection.durationQ,
      });
    } else if (playbackSelection) {
      lockPlaybackSelection();
    } else {
      setLoopRegion(null);
    }
  },
};
