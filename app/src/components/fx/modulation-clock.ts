import { createContext } from "react";
import type { ArrangementClip } from "../../app/types";
import type { PlayheadSignal } from "../../playhead-signal";
import type { MeterSignature } from "../../timeline-format";

// Where the session is, for the Modulation and Animation sections' graphs
// to follow without the FX chain re-rendering on every frame.
export type FxModulationClock = {
  signal: PlayheadSignal;
  bpm: number;
  signature: MeterSignature;
  isPlaying: boolean;
};

export const FxModulationClockContext = createContext<FxModulationClock | null>(
  null,
);

// The timeline the Animation section's graph samples Clip and Reactive mode
// on: the session's frame rate, which animation timings are counted in, and
// for Clip mode the clips, the FX panel's layer and clip, and the session's
// end.
export type FxAnimationTimeline = {
  fps: number;
  clips: readonly ArrangementClip[];
  lanePriority: ReadonlyMap<string, number>;
  laneId?: string;
  clipId?: string;
  sessionEndSeconds?: number;
};

export const FxAnimationTimelineContext =
  createContext<FxAnimationTimeline | null>(null);
