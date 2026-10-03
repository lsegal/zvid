// LFO mode of the Animation modifier: the effect's selected knobs swing
// continuously along the Shape, at the Rate, by up to Depth of their reach.
// The LFO runs on session time, so preview and export land on the same phase
// at the same frame, and a synced LFO lines up with the session's bars.

import {
  type LfoAnimation,
  type LfoShape,
  type LfoSyncRate,
  LFO_MAX_PHASE,
  supportsAnimationMode,
} from "./fx-animation-defaults.ts";
import {
  DEFAULT_REACTIVE_RANGE_SCALE,
  reactiveOffset,
} from "./fx-animation-reactive.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import type { MeterSignature } from "./timeline-format.ts";

type LfoParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type LfoEffect = {
  id?: string;
  effectName: string;
  parameters: LfoParameter[];
};

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
    return (
      Number(bars[1]) * signature.numerator * (4 / signature.denominator)
    );
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
  const offset = lfo.phase / LFO_MAX_PHASE;
  if (lfo.sync) {
    if (!(bpm > 0)) {
      return offset;
    }
    const quarters = (time * bpm) / 60;
    return quarters / lfoSyncQuarters(lfo.syncRate, signature) + offset;
  }
  return time * Math.max(0, lfo.rate) + offset;
}

export type LfoOptions = LfoTime & {
  rangeScale?: number;
};

// The parameters `effect` is drawn with at `options.time` under `lfo`. Only
// the selected knobs move, each by up to Depth of its reach either side of
// where it is set, clamped to its limits, and nothing moves on an effect
// that doesn't support LFO mode. Returns `effect.parameters` itself when
// nothing moves.
export function resolveLfoParameters(
  effect: LfoEffect,
  lfo: LfoAnimation,
  options: LfoOptions,
): LfoParameter[] {
  if (
    !supportsAnimationMode(effect.effectName, "lfo") ||
    !(lfo.depth > 0) ||
    !lfo.parameters.length
  ) {
    return effect.parameters;
  }

  const cycles = evaluateLfoCycles(lfo, options);
  const amplitude = Math.min(1, lfo.depth);
  const selected = new Set(lfo.parameters);
  const rangeScale = options.rangeScale ?? DEFAULT_REACTIVE_RANGE_SCALE;
  const effectId = effect.id ?? effect.effectName;
  let result: LfoParameter[] | undefined;
  for (const definition of getEffectDefinition(effect.effectName).parameters) {
    if (
      definition.kind !== "number" ||
      definition.hidden ||
      !selected.has(definition.key)
    ) {
      continue;
    }
    const index = effect.parameters.findIndex(
      (parameter) => parameter.key === definition.key,
    );
    const parameter = effect.parameters[index];
    const base = parameter?.numericValue ?? Number(parameter?.value);
    if (!parameter || !Number.isFinite(base)) {
      continue;
    }

    // Each knob steps to its own Random values.
    const swing =
      lfoWaveform(lfo.shape, cycles, `${effectId}\u0000${definition.key}`) *
      amplitude *
      (definition.max - definition.min) *
      rangeScale;
    const value = Math.max(
      definition.min,
      Math.min(definition.max, base + swing),
    );
    if (value === base) {
      continue;
    }
    result ??= effect.parameters.slice();
    result[index] = {
      ...parameter,
      value: value.toFixed(3),
      numericValue: value,
    };
  }
  return result ?? effect.parameters;
}
