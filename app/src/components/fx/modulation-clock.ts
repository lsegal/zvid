import { createContext } from "react";
import type { ArrangementClip } from "../../app/types";
import type { PlayheadSignal } from "../../playhead-signal";
import type { ReactiveOnset } from "../../fx-animation-impulse";
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

// The hits MIDI effects in Reactive mode hear from the FX panel's MIDI clip, by
// effect id: they have no chain to report them, unlike audio effects.
export const FxMidiOnsetsContext = createContext<
  ReadonlyMap<string, readonly ReactiveOnset[]> | undefined
>(undefined);

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
