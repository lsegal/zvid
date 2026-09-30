// A layer's effect stack is the ordered subset of the project's `effects`
// array that shares one `trackId` (a Layer id, a clip's `clip:<clipId>` or
// GLOBAL_EFFECT_TRACK_ID). Array order is stack order. The helpers here are pure: each returns a new
// `effects` array, or the same array when nothing changed so history
// commits can skip no-op edits.

import {
  EXCLUDED_LAYERS_KEY,
  isOrderEffectName,
  ORDER_EFFECT_NAME,
  pruneLayerIdList,
} from "../../composition-order.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
  normalizeEffectAnimation,
  supportsAnimation,
} from "../../fx-animation-defaults.ts";
import {
  type FxEffectDefinition,
  type FxEffectScope,
  type FxParameterDefinition,
  getEffectDefinition,
  getFallbackParameterDefinition,
  isEffectSupportedIn,
} from "../../fx-registry.ts";
import {
  cloneAnimation,
  GLOBAL_EFFECT_TRACK_ID,
  getTrackGroup,
} from "./clip-stacks.ts";
import {
  isLayerLayoutEffect,
  isLayoutEffectName,
  LAYOUT_EFFECT_NAME,
} from "./layer-fx.ts";
import { formatStoredNumber } from "./session-mapping.ts";
import type { EffectParameter, SessionEffect } from "./types.ts";

export function findParameterDefinition(
  definition: FxEffectDefinition,
  key: string,
) {
  return definition.parameters.find((parameter) => parameter.key === key);
}

function createParameter(
  definition: FxParameterDefinition,
  value: number | string,
  clampToRange = true,
): EffectParameter {
  if (definition.kind !== "number" || typeof value === "string") {
    return { key: definition.key, value: `${value}` };
  }

  const clamped = clampToRange
    ? Math.max(definition.min, Math.min(definition.max, value))
    : value;
  return {
    key: definition.key,
    value: formatStoredNumber(clamped),
    numericValue: clamped,
  };
}

function getStack(effects: SessionEffect[], trackId: string) {
  return effects.filter((effect) => effect.trackId === trackId);
}

function updateEffect(
  effects: SessionEffect[],
  effectId: string,
  updater: (effect: SessionEffect) => SessionEffect,
) {
  const index = effects.findIndex((effect) => effect.id === effectId);
  if (index < 0) {
    return effects;
  }

  const current = effects[index];
  const next = updater(current);
  if (next === current) {
    return effects;
  }

  const result = effects.slice();
  result[index] = next;
  return result;
}

export function setEffectParameter(
  effects: SessionEffect[],
  effectId: string,
  key: string,
  value: number | string,
) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return effects;
  }

  return updateEffect(effects, effectId, (effect) => {
    // Unrecognized parameters have no known range, so they are not clamped.
    const knownDefinition = findParameterDefinition(
      getEffectDefinition(effect.effectName),
      key,
    );
    const definition =
      knownDefinition ??
      getFallbackParameterDefinition(
        key,
        typeof value === "string" ? value : undefined,
      );
    const nextParameter = createParameter(
      definition,
      value,
      Boolean(knownDefinition),
    );
    const index = effect.parameters.findIndex(
      (parameter) => parameter.key === key,
    );
    const current = effect.parameters[index];
    if (
      current &&
      current.value === nextParameter.value &&
      current.numericValue === nextParameter.numericValue
    ) {
      return effect;
    }

    const parameters =
      index < 0
        ? [...effect.parameters, nextParameter]
        : effect.parameters.map((parameter, parameterIndex) =>
            parameterIndex === index ? nextParameter : parameter,
          );
    return { ...effect, parameters };
  });
}

export function setEffectEnabled(
  effects: SessionEffect[],
  effectId: string,
  enabled: boolean,
) {
  return updateEffect(effects, effectId, (effect) =>
    (effect.enabled !== false) === enabled ? effect : { ...effect, enabled },
  );
}

// Turns an effect's Animation modifier on or off. Turning it on the first
// time fills in the effect's animation defaults; turning it off keeps the
// settings for next time. Effects without animation support are unchanged.
export function setEffectAnimationEnabled(
  effects: SessionEffect[],
  effectId: string,
  enabled: boolean,
) {
  return updateEffect(effects, effectId, (effect) => {
    if (
      !supportsAnimation(effect.effectName) ||
      (effect.animation?.enabled ?? false) === enabled
    ) {
      return effect;
    }

    const current =
      effect.animation ?? createDefaultAnimation(effect.effectName);
    return current ? { ...effect, animation: { ...current, enabled } } : effect;
  });
}

// Replaces an effect's animation settings, such as its mode or timing.
// Effects without animation support, and settings that match the current
// ones, are unchanged.
export function setEffectAnimation(
  effects: SessionEffect[],
  effectId: string,
  animation: EffectAnimation,
) {
  return updateEffect(effects, effectId, (effect) => {
    const next = normalizeEffectAnimation(animation, effect.effectName);
    return !next || JSON.stringify(next) === JSON.stringify(effect.animation)
      ? effect
      : { ...effect, animation: next };
  });
}

// Moves an effect to `toIndex` within its own stack. `toIndex` counts only
// effects with the same `trackId` and is clamped to the stack. Passing a
// different `toTrackId` is a cross-stack move, which is rejected.
export function moveEffect(
  effects: SessionEffect[],
  effectId: string,
  toIndex: number,
  toTrackId?: string,
) {
  const effect = effects.find((candidate) => candidate.id === effectId);
  if (!effect || (toTrackId !== undefined && toTrackId !== effect.trackId)) {
    return effects;
  }

  const stack = getStack(effects, effect.trackId);
  const fromIndex = stack.indexOf(effect);
  const targetIndex = Math.max(
    0,
    Math.min(stack.length - 1, Math.trunc(toIndex)),
  );
  if (fromIndex === targetIndex || !Number.isFinite(toIndex)) {
    return effects;
  }

  const reordered = stack.slice();
  reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, effect);

  // Other stacks keep their slots; this stack's slots get the new order.
  let stackIndex = 0;
  return effects.map((candidate) =>
    candidate.trackId === effect.trackId ? reordered[stackIndex++] : candidate,
  );
}

export function createEffect(
  trackId: string,
  effectName: string,
  id: string = crypto.randomUUID(),
): SessionEffect {
  const definition = getEffectDefinition(effectName);
  return {
    id,
    trackId,
    effectName,
    parameters: definition.parameters.map((parameter) =>
      createParameter(parameter, parameter.defaultValue),
    ),
    enabled: true,
  };
}

// Inserts a new effect with the registry defaults at `atIndex` within the
// `trackId` stack, or at the end of the stack when omitted. `scope` is the
// stack's scope when the track alone doesn't tell: "fxClip" for an FX
// clip's own stack.
export function addEffect(
  effects: SessionEffect[],
  trackId: string,
  effectName: string,
  atIndex?: number,
  id?: string,
  scope: FxEffectScope = getTrackGroup(trackId),
) {
  let current = effects;
  let stack = getStack(current, trackId);
  // Only effects designed for the stack can be added to it: Transform
  // places one layer, so never on the Global stack, and Order arranges
  // several layers at once, so only on the Global stack or an FX clip.
  if (!isEffectSupportedIn(effectName, scope)) {
    return effects;
  }

  // A stack arranges its layers one way: a new Order bypasses the ones
  // already there, which stay to be switched back on.
  if (isOrderEffectName(effectName)) {
    for (const existing of stack) {
      if (isOrderEffectName(existing.effectName)) {
        current = setEffectEnabled(current, existing.id, false);
      }
    }
    stack = getStack(current, trackId);
  }

  // Layout is per layer: never on the Global stack, and one per layer.
  if (
    isLayoutEffectName(effectName) &&
    (trackId === GLOBAL_EFFECT_TRACK_ID ||
      stack.some((effect) => isLayoutEffectName(effect.effectName)))
  ) {
    return effects;
  }

  const effect = createEffect(trackId, effectName, id);
  const stackIndex =
    atIndex === undefined || !Number.isFinite(atIndex)
      ? stack.length
      : Math.max(0, Math.min(stack.length, Math.trunc(atIndex)));

  let insertAt: number;
  if (stackIndex < stack.length) {
    insertAt = current.indexOf(stack[stackIndex]);
  } else if (stack.length) {
    insertAt = current.indexOf(stack[stack.length - 1]) + 1;
  } else {
    insertAt = current.length;
  }

  return [...current.slice(0, insertAt), effect, ...current.slice(insertAt)];
}

export function removeEffect(effects: SessionEffect[], effectId: string) {
  const index = effects.findIndex((effect) => effect.id === effectId);
  if (index < 0 || isLayerLayoutEffect(effects[index])) {
    return effects;
  }

  return [...effects.slice(0, index), ...effects.slice(index + 1)];
}

// Inserts a copy of an effect, with its parameters and bypass state, right
// after the original in the same stack.
export function duplicateEffect(
  effects: SessionEffect[],
  effectId: string,
  id: string = crypto.randomUUID(),
) {
  const index = effects.findIndex((effect) => effect.id === effectId);
  if (index < 0 || isLayerLayoutEffect(effects[index])) {
    return effects;
  }

  const source = effects[index];
  const copy: SessionEffect = {
    ...source,
    id,
    parameters: source.parameters.map((parameter) => ({ ...parameter })),
    ...(source.animation
      ? { animation: cloneAnimation(source.animation) }
      : {}),
  };
  return [...effects.slice(0, index + 1), copy, ...effects.slice(index + 1)];
}

// Puts an effect's parameters back to the registry defaults and turns it
// back on. Unrecognized parameters are kept, since they have no default.
export function resetEffect(effects: SessionEffect[], effectId: string) {
  return updateEffect(effects, effectId, (effect) => {
    const defaults = createEffect(effect.trackId, effect.effectName, effect.id);
    const knownKeys = new Set(
      defaults.parameters.map((parameter) => parameter.key),
    );
    const parameters = [
      ...defaults.parameters,
      ...effect.parameters.filter((parameter) => !knownKeys.has(parameter.key)),
    ];
    const unchanged =
      effect.enabled !== false &&
      parameters.length === effect.parameters.length &&
      parameters.every((parameter) => {
        const current = effect.parameters.find(
          (candidate) => candidate.key === parameter.key,
        );
        return (
          current?.value === parameter.value &&
          current.numericValue === parameter.numericValue
        );
      });
    return unchanged ? effect : { ...effect, parameters, enabled: true };
  });
}

// Gives each of `laneIds` its own Layout effect at the start of its stack
// and removes Layout from the Global stack. Sessions from before Layout was
// per layer could hold one global Layout for every layer, so layers without
// their own copy its parameters (the last enabled one, as it used to win),
// or else get the defaults. Returns `effects` itself when nothing changed.
export function ensureLayerLayouts(
  effects: SessionEffect[],
  laneIds: readonly string[],
) {
  const globalLayouts = effects.filter(
    (effect) =>
      effect.trackId === GLOBAL_EFFECT_TRACK_ID &&
      isLayoutEffectName(effect.effectName),
  );
  const inherited = globalLayouts.findLast(
    (effect) => effect.enabled !== false,
  );
  let result = globalLayouts.length
    ? effects.filter((effect) => !globalLayouts.includes(effect))
    : effects;

  for (const laneId of laneIds) {
    if (
      result.some(
        (effect) =>
          effect.trackId === laneId && isLayoutEffectName(effect.effectName),
      )
    ) {
      continue;
    }

    // A stable id keeps collaborating peers that migrate the same session
    // in agreement.
    const stableId = `layout-${laneId}`;
    const id = result.some((effect) => effect.id === stableId)
      ? crypto.randomUUID()
      : stableId;
    result = addEffect(result, laneId, LAYOUT_EFFECT_NAME, 0, id);
    if (inherited) {
      const index = result.findIndex((effect) => effect.id === id);
      const layout = result[index];
      const knownKeys = new Set(
        inherited.parameters.map((parameter) => parameter.key),
      );
      result[index] = {
        ...layout,
        parameters: [
          ...inherited.parameters.map((parameter) => ({ ...parameter })),
          ...layout.parameters.filter(
            (parameter) => !knownKeys.has(parameter.key),
          ),
        ],
      };
    }
  }

  return result;
}

// Adds an Order effect with its defaults (Vertical, no spacing) at the start
// of the Global stack when the stack has none, enabled or bypassed, so the
// layers keep their stacked bands. Returns `effects` itself when nothing
// changed.
export function ensureGlobalOrder(effects: SessionEffect[]) {
  if (hasGlobalOrder(effects)) {
    return effects;
  }

  // A stable id keeps collaborating peers that add it in agreement.
  const stableId = "order-global";
  const id = effects.some((effect) => effect.id === stableId)
    ? crypto.randomUUID()
    : stableId;
  return addEffect(effects, GLOBAL_EFFECT_TRACK_ID, ORDER_EFFECT_NAME, 0, id);
}

// True when the Global stack holds an Order effect, enabled or bypassed.
export function hasGlobalOrder(effects: readonly SessionEffect[]) {
  return effects.some(
    (effect) =>
      effect.trackId === GLOBAL_EFFECT_TRACK_ID &&
      isOrderEffectName(effect.effectName),
  );
}

export function getEffectDisplayName(effectName: string) {
  return getEffectDefinition(effectName).displayName;
}

function getParameterLabel(effectName: string, key: string) {
  return (
    findParameterDefinition(getEffectDefinition(effectName), key)?.label ?? key
  );
}

// History labels for effect edits.
export const effectHistoryLabels = {
  parameter: (effectName: string, key: string) =>
    `Change ${getParameterLabel(effectName, key)}`,
  move: (effectName: string) => `Move ${getEffectDisplayName(effectName)}`,
  add: (effectName: string) => `Add ${getEffectDisplayName(effectName)}`,
  remove: (effectName: string) => `Remove ${getEffectDisplayName(effectName)}`,
  reset: (effectName: string) => `Reset ${getEffectDisplayName(effectName)}`,
  duplicate: (effectName: string) =>
    `Duplicate ${getEffectDisplayName(effectName)}`,
  enabled: (effectName: string, enabled: boolean) =>
    `${enabled ? "Enable" : "Bypass"} ${getEffectDisplayName(effectName)}`,
  animationEnabled: (effectName: string, enabled: boolean) =>
    `Turn Animation ${enabled ? "On" : "Off"} for ${getEffectDisplayName(effectName)}`,
  animation: (effectName: string) =>
    `Change ${getEffectDisplayName(effectName)} Animation`,
  layerFx: (layerName: string, enabled: boolean) =>
    `Turn FX ${enabled ? "On" : "Off"} for ${layerName}`,
};

// The effects with each Order's excluded layers limited to `layerIds`, the
// layers that still exist. Effects with nothing to drop are kept as they
// are.
export function pruneExcludedLayers<
  T extends { effectName: string; parameters: EffectParameter[] },
>(effects: T[], layerIds: Iterable<string>) {
  const existing = [...layerIds];
  return effects.map((effect) => {
    if (!isOrderEffectName(effect.effectName)) {
      return effect;
    }

    let changed = false;
    const parameters = effect.parameters.map((parameter) => {
      if (parameter.key !== EXCLUDED_LAYERS_KEY) {
        return parameter;
      }
      const value = pruneLayerIdList(parameter.value, existing);
      if (value === parameter.value) {
        return parameter;
      }
      changed = true;
      return { key: parameter.key, value };
    });
    return changed ? { ...effect, parameters } : effect;
  });
}
