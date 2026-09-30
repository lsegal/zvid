// Moving the playhead. Space toggles playback in useSpacePlayback.ts, since
// it acts on release and must reach the key before focused controls do.
import { secondsToQuarters } from "../app/timeline-math.ts";
import { clamp } from "../app/util.ts";
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

// The arrows step the playhead a frame, or five with Shift.
export const stepFrameShortcut: Shortcut = {
  id: "transport.step-frame",
  keys: ["ArrowLeft", "ArrowRight"],
  when: canEditTimeline,
  run: (
    { bpm, fps, playbackOriginRef, playheadQRef, setPlayheadQ, totalQuarters },
    event,
  ) => {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const deltaQ = secondsToQuarters(
      (direction * (event.shiftKey ? 5 : 1)) / fps,
      bpm,
    );
    const nextPlayheadQ = clamp(
      playheadQRef.current + deltaQ,
      0,
      totalQuarters,
    );
    setPlayheadQ(nextPlayheadQ);
    playbackOriginRef.current = nextPlayheadQ;
  },
};

// Home and End go to the start and to the last frame of the content.
export const jumpToEdgeShortcut: Shortcut = {
  id: "transport.jump-to-edge",
  keys: ["Home", "End"],
  when: canEditTimeline,
  run: (
    { bpm, fps, playbackOriginRef, setPlayheadQ, timelineContentEndQ },
    event,
  ) => {
    event.preventDefault();
    const lastFrameQ = Math.max(
      0,
      timelineContentEndQ - secondsToQuarters(1 / fps, bpm),
    );
    const nextPlayheadQ = event.key === "Home" ? 0 : lastFrameQ;
    setPlayheadQ(nextPlayheadQ);
    playbackOriginRef.current = nextPlayheadQ;
  },
};
