import { createContext } from "react";
import type { PlayheadSignal } from "../../playhead-signal";
import type { MeterSignature } from "../../timeline-format";

// Where the session is, for the Modulation section's graph to follow
// without the FX chain re-rendering on every frame.
export type FxModulationClock = {
  signal: PlayheadSignal;
  bpm: number;
  signature: MeterSignature;
  isPlaying: boolean;
};

export const FxModulationClockContext = createContext<FxModulationClock | null>(
  null,
);
