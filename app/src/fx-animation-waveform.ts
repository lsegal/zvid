// The waveform and clock behind the Animation modifier's LFO mode, which
// audio effects' Modulation shares. It imports nothing at run time, so the
// audio chain worklet can bundle it.

import type {
  LfoAnimation,
  LfoShape,
  LfoSyncRate,
} from "./fx-animation-defaults.ts";
import { reactiveOffset } from "./fx-animation-impulse.ts";
import type { MeterSignature } from "./timeline-format.ts";

// Phase is set in degrees.
const DEGREES_PER_CYCLE = 360;

const COMMON_TIME: MeterSignature = { numerator: 4, denominator: 4 };

// The LFO's value, -1..1, `cycles` cycles after it started. The fractional
// part is the phase through the current cycle; Random holds one value per
// cycle, which `seed` and the cycle's index choose, so the same seed always
// gives the same steps.
export function lfoWaveform(shape: LfoShape, cycles: number, seed = "") {
  const phase = cycles - Math.floor(cycles);
  switch (shape) {
    case "Sine":
      return Math.sin(2 * Math.PI * phase);
    case "Triangle":
      // Rises from 0 to 1 by a quarter cycle, like the sine.
      return phase < 0.25
        ? 4 * phase
        : phase < 0.75
          ? 2 - 4 * phase
          : 4 * phase - 4;
    case "Saw Up":
      return 2 * phase - 1;
    case "Saw Down":
      return 1 - 2 * phase;
    case "Square":
      return phase < 0.5 ? 1 : -1;
    case "Random":
      return reactiveOffset(seed, "lfo", Math.floor(cycles));
    default:
      return 0;
  }
}

// One cycle of a synced Rate in quarter notes. Bars follow the signature, so
// a 6/8 bar is three quarters long.
export function lfoSyncQuarters(
  syncRate: LfoSyncRate,
  signature: MeterSignature = COMMON_TIME,
) {
  const bars = /^(\d+) Bars?$/.exec(syncRate);
  if (bars) {
    return Number(bars[1]) * signature.numerator * (4 / signature.denominator);
  }
  const [, divisor, modifier] = /^1\/(\d+)([DT]?)$/.exec(syncRate) ?? [];
  const quarters = 4 / Number(divisor);
  return modifier === "D"
    ? quarters * 1.5
    : modifier === "T"
      ? (quarters * 2) / 3
      : quarters;
}

export type LfoTime = {
  // Seconds from the session start.
  time: number;
  bpm: number;
  signature?: MeterSignature;
};

// Cycles the LFO has run `time` seconds into the session, Phase included.
// A synced LFO starts a cycle on the session's first downbeat.
export function evaluateLfoCycles(
  lfo: Pick<LfoAnimation, "sync" | "rate" | "syncRate" | "phase">,
  { time, bpm, signature }: LfoTime,
) {
  const offset = lfo.phase / DEGREES_PER_CYCLE;
  if (lfo.sync) {
    if (!(bpm > 0)) {
      return offset;
    }
    const quarters = (time * bpm) / 60;
    return quarters / lfoSyncQuarters(lfo.syncRate, signature) + offset;
  }
  return time * Math.max(0, lfo.rate) + offset;
}
