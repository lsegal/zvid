// Reactive mode of the Animation modifier: on each audio hit, the effect's
// selected knobs jump by a random amount and settle back along the Motion
// curve over the Timing, scaled by Reactivity and the hit's strength.

import {
  getReactiveTimingFrames,
  type ReactiveAnimation,
  supportsAnimationMode,
} from "./fx-animation-defaults.ts";
import {
  DEFAULT_REACTIVE_RANGE_SCALE,
  type ReactiveOnset,
  reactiveOffset,
  reactiveSwingAt,
} from "./fx-animation-impulse.ts";
import { getEffectDefinition } from "./fx-registry.ts";

export {
  DEFAULT_REACTIVE_RANGE_SCALE,
  findReactiveImpulse,
  placeOnsets,
  REACTIVE_FRAME_RATE,
  type ReactiveImpulse,
  type ReactiveOnset,
  reactiveEnvelope,
  reactiveOffset,
} from "./fx-animation-impulse.ts";

type ReactiveParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type ReactiveEffect = {
  id?: string;
  effectName: string;
  parameters: ReactiveParameter[];
};

export type ReactiveOptions = {
  // Seconds from the timeline start.
  time: number;
  // The session's frame rate, which the Timing is counted in.
  fps?: number;
  onsets: readonly ReactiveOnset[];
  rangeScale?: number;
};

// The parameters `effect` is drawn with at `options.time` under `reactive`.
// Only the selected knobs move, each clamped to its limits, and nothing moves
// on an effect that doesn't support Reactive mode. Returns
// `effect.parameters` itself when nothing moves.
export function resolveReactiveParameters(
  effect: ReactiveEffect,
  reactive: ReactiveAnimation,
  options: ReactiveOptions,
): ReactiveParameter[] {
  if (
    !supportsAnimationMode(effect.effectName, "reactive") ||
    !reactive.parameters.length
  ) {
    return effect.parameters;
  }

  const swing = reactiveSwingAt(
    reactive,
    options.onsets,
    options.time,
    getReactiveTimingFrames(effect.effectName, reactive.timing),
    options.fps,
  );
  if (!swing) {
    return effect.parameters;
  }

  const selected = new Set(reactive.parameters);
  const rangeScale = options.rangeScale ?? DEFAULT_REACTIVE_RANGE_SCALE;
  const effectId = effect.id ?? effect.effectName;
  let result: ReactiveParameter[] | undefined;
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

    const value = Math.max(
      definition.min,
      Math.min(
        definition.max,
        base +
          reactiveOffset(effectId, definition.key, swing.seed) *
            swing.amount *
            (definition.max - definition.min) *
            rangeScale,
      ),
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
