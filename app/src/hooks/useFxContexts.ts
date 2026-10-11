import { useMemo } from "react";
import type { ArrangementClip } from "../app/types.ts";
import type { PlayheadSignal } from "../playhead-signal";
import type { MeterSignature } from "../timeline-format.ts";

export type FxContextsInputs = {
  playheadSignal: PlayheadSignal;
  bpm: number;
  fps: number;
  signature: MeterSignature;
  isPlaying: boolean;
  timelineClips: ArrangementClip[];
  lanePriority: ReadonlyMap<string, number>;
  fxLaneId: string | undefined;
  fxClipId: string | undefined;
  projectDurationFrames: number | undefined;
};

// The values the FX panel's modulation and animation graphs read from
// context: the playhead clock, and the clips and session length the
// selected stack's animations are timed against.
export function useFxContexts({
  playheadSignal,
  bpm,
  fps,
  signature,
  isPlaying,
  timelineClips,
  lanePriority,
  fxLaneId,
  fxClipId,
  projectDurationFrames,
}: FxContextsInputs) {
  const modulationClock = useMemo(
    () => ({ signal: playheadSignal, bpm, signature, isPlaying }),
    [playheadSignal, bpm, signature, isPlaying],
  );
  const animationTimeline = useMemo(
    () => ({
      fps,
      clips: timelineClips,
      lanePriority,
      laneId: fxLaneId,
      clipId: fxClipId,
      sessionEndSeconds:
        projectDurationFrames && fps > 0
          ? projectDurationFrames / fps
          : undefined,
    }),
    [
      fps,
      timelineClips,
      lanePriority,
      fxLaneId,
      fxClipId,
      projectDurationFrames,
    ],
  );
  return { modulationClock, animationTimeline };
}
