// LFO mode of the Animation modifier: the effect's selected knobs swing
// continuously along the Shape, at the Rate, by up to Depth of their reach.
// The LFO runs on session time, so preview and export land on the same phase
// at the same frame, and a synced LFO lines up with the session's bars.

import {
  type LfoAnimation,
  supportsAnimationMode,
} from "./fx-animation-defaults.ts";
import { DEFAULT_REACTIVE_RANGE_SCALE } from "./fx-animation-reactive.ts";
import {
  evaluateLfoCycles,
  type LfoTime,
  lfoWaveform,
} from "./fx-animation-waveform.ts";
import { getEffectDefinition } from "./fx-registry.ts";

export {
  evaluateLfoCycles,
  type LfoTime,
  lfoSyncQuarters,
  lfoWaveform,
} from "./fx-animation-waveform.ts";

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
