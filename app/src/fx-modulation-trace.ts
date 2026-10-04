// The traces the Modulation section's graph draws (see FxModulationGraph):
// LFO sampled from the waveform the audio chain follows, and Transient
// scrolled from the levels the chain reports.

import type { LfoAnimation, ReactiveMotion } from "./fx-animation-defaults.ts";
import { reactiveEnvelope } from "./fx-animation-impulse.ts";
import {
  evaluateLfoCycles,
  type LfoTime,
  lfoWaveform,
} from "./fx-animation-waveform.ts";

// An LFO trace spans about this many cycles, within the window below, so a
// fast LFO doesn't blur and a slow one still moves.
const LFO_TRACE_CYCLES = 2;
export const MIN_LFO_TRACE_SECONDS = 0.5;
export const MAX_LFO_TRACE_SECONDS = 4;

// A Transient trace spans this long.
export const TRANSIENT_TRACE_SECONDS = 2;

type LfoTraceSettings = Pick<
  LfoAnimation,
  "shape" | "sync" | "rate" | "syncRate" | "phase" | "depth"
>;

// How many seconds an LFO trace spans at `tempo`.
export function lfoTraceSeconds(
  lfo: LfoTraceSettings,
  tempo: Omit<LfoTime, "time">,
) {
  const perSecond =
    evaluateLfoCycles(lfo, { ...tempo, time: 1 }) -
    evaluateLfoCycles(lfo, { ...tempo, time: 0 });
  if (!(perSecond > 0)) {
    return MAX_LFO_TRACE_SECONDS;
  }
  return Math.min(
    MAX_LFO_TRACE_SECONDS,
    Math.max(MIN_LFO_TRACE_SECONDS, LFO_TRACE_CYCLES / perSecond),
  );
}

// `count` samples of the LFO over the `seconds` up to `at.time`, oldest
// first and ending at `at.time`: its waveform, -1..1, scaled by Depth.
// Random draws from `seed`, as the audio chain does.
export function sampleLfoTrace(
  lfo: LfoTraceSettings,
  at: LfoTime,
  seed: string,
  count: number,
  seconds: number,
  into = new Float32Array(count),
) {
  const depth = Math.max(0, Math.min(1, lfo.depth));
  const step = count > 1 ? seconds / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    const time = at.time - (count - 1 - index) * step;
    const cycles = evaluateLfoCycles(lfo, { ...at, time });
    into[index] = lfoWaveform(lfo.shape, cycles, seed) * depth;
  }
  return into;
}

// How far each Motion's envelope swings at most, found once by sampling.
const envelopePeaks = new Map<ReactiveMotion, number>();
const ENVELOPE_SAMPLES = 2000;

// A Transient level (see StageModulator) as a fraction of the most its
// Motion swings, so a full-strength hit at full Reactivity fills the trace.
export function transientTraceValue(motion: ReactiveMotion, level: number) {
  let peak = envelopePeaks.get(motion);
  if (peak === undefined) {
    peak = 0;
    for (let index = 0; index < ENVELOPE_SAMPLES; index++) {
      peak = Math.max(
        peak,
        Math.abs(reactiveEnvelope(motion, index / ENVELOPE_SAMPLES)),
      );
    }
    envelopePeaks.set(motion, peak);
  }
  return peak > 0 ? level / peak : 0;
}

// Scrolls `trace` left by `steps` samples, filling the freed samples at its
// end with `value`.
export function scrollTrace(trace: Float32Array, steps: number, value: number) {
  const shift = Math.min(trace.length, Math.max(0, Math.floor(steps)));
  if (!shift) {
    return;
  }
  trace.copyWithin(0, shift);
  trace.fill(value, trace.length - shift);
}
