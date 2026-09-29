// A layer's effect stack is the ordered subset of the project's `effects`
// array that shares one `trackId` (a Layer id or GLOBAL_EFFECT_TRACK_ID).
// Array order is stack order. The helpers here are pure: each returns a new
// `effects` array, or the same array when nothing changed so history
// commits can skip no-op edits.

import {
  hiddenLayerCount,
  isOrderEffectName,
  parseCompositionOrder,
} from "./composition-order.ts";
import { isTransformEffectName } from "./composition-transform.ts";
import {
  type FxEffectDefinition,
  type FxParameterDefinition,
  getEffectDefinition,
  getFallbackParameterDefinition,
} from "./fx-registry.ts";
import type { LvpSession } from "./session.ts";

export const GLOBAL_EFFECT_TRACK_ID = "__group_main";

export type EffectParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type SessionEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: EffectParameter[];
  // Bypass flag. `.lvp` has no field for it yet, so it only lives in
  // project state; a missing flag means enabled.
  enabled: boolean;
};

export type FxDeviceParameter = {
  key: string;
  label: string;
  kind: "number" | "enum";
  // Position of the value within [min, max], 0..1, for meters.
  value: number;
  numericValue?: number;
  stringValue?: string;
  min: number;
  max: number;
  defaultValue: number | string;
  step?: number;
  options?: readonly string[];
  display: string;
};

export type FxDeviceGroup = "layer" | "global";

export type FxDevice = {
  id: string;
  effectName: string;
  name: string;
  description: string;
  subtitle: string;
  accent: string;
  group: FxDeviceGroup;
  enabled: boolean;
  // True for a layer's own Layout device. Every visual layer has exactly
  // one, so it can be reset to its defaults but not removed or duplicated.
  layerDefault?: boolean;
  // A problem to point out on the device, such as layers an Order grid has
  // no cell for.
  warning?: string;
  parameters: FxDeviceParameter[];
};

export function mapEffects(source: LvpSession["effects"]) {
  return (source ?? []).map<SessionEffect>((effect) => ({
    id: effect.id,
    trackId: effect.trackId,
    effectName: effect.effectName,
    parameters: Object.entries(effect.parameters ?? {}).map(([key, value]) => ({
      key,
      value:
        typeof value.stringValue === "string"
          ? value.stringValue
          : formatStoredNumber(value.floatValue ?? 0),
      numericValue: value.floatValue,
    })),
    enabled: true,
  }));
}

function formatStoredNumber(value: number) {
  return value.toFixed(3);
}

function findParameterDefinition(definition: FxEffectDefinition, key: string) {
  return definition.parameters.find((parameter) => parameter.key === key);
}

function createParameter(
  definition: FxParameterDefinition,
  value: number | string,
  clampToRange = true,
): EffectParameter {
  if (definition.kind === "enum" || typeof value === "string") {
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

// A layer's FX switch bypasses its whole stack at once. It lives on the
// layer rather than on each effect, so turning it back on restores every
// device's own bypass state. A missing flag means on.
export type FxLayer = {
  id: string;
  fxEnabled?: boolean;
};

export function isLayerFxEnabled(layer: FxLayer | undefined) {
  return layer?.fxEnabled !== false;
}

export function setLaneFxEnabled<T extends FxLayer>(
  layers: T[],
  laneId: string,
  enabled: boolean,
) {
  const index = layers.findIndex((layer) => layer.id === laneId);
  if (index < 0 || isLayerFxEnabled(layers[index]) === enabled) {
    return layers;
  }

  const result = layers.slice();
  result[index] = { ...layers[index], fxEnabled: enabled };
  return result;
}

// The effects the renderer applies: a layer whose FX are off contributes
// nothing but its Layout anchoring. Returns `effects` itself when no layer
// is bypassed.
export function getRenderedEffects<
  T extends { trackId: string; effectName: string },
>(effects: T[], layers: FxLayer[]) {
  const bypassed = new Set(
    layers.filter((layer) => !isLayerFxEnabled(layer)).map((layer) => layer.id),
  );
  if (!bypassed.size) {
    return effects;
  }

  return effects.filter(
    (effect) =>
      !bypassed.has(effect.trackId) || isLayoutEffectName(effect.effectName),
  );
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
// `trackId` stack, or at the end of the stack when omitted.
export function addEffect(
  effects: SessionEffect[],
  trackId: string,
  effectName: string,
  atIndex?: number,
  id?: string,
) {
  const stack = getStack(effects, trackId);
  // Transform places one layer, so it has no meaning on the Global stack.
  if (trackId === GLOBAL_EFFECT_TRACK_ID && isTransformEffectName(effectName)) {
    return effects;
  }

  // Order arranges every layer at once, so only the Global stack takes it.
  if (trackId !== GLOBAL_EFFECT_TRACK_ID && isOrderEffectName(effectName)) {
    return effects;
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
    insertAt = effects.indexOf(stack[stackIndex]);
  } else if (stack.length) {
    insertAt = effects.indexOf(stack[stack.length - 1]) + 1;
  } else {
    insertAt = effects.length;
  }

  return [...effects.slice(0, insertAt), effect, ...effects.slice(insertAt)];
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

export const LAYOUT_EFFECT_NAME = "Layout";

// A Layout effect on a layer's own stack, as opposed to a legacy one on the
// Global stack.
function isLayerLayoutEffect(effect: SessionEffect) {
  return (
    effect.trackId !== GLOBAL_EFFECT_TRACK_ID &&
    isLayoutEffectName(effect.effectName)
  );
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
  layerFx: (layerName: string, enabled: boolean) =>
    `Turn FX ${enabled ? "On" : "Off"} for ${layerName}`,
};

export function isLayoutEffectName(effectName: string) {
  return effectName.trim().toLowerCase().includes("layout");
}

function toDeviceParameter(
  definition: FxParameterDefinition,
  stored: EffectParameter | undefined,
): FxDeviceParameter {
  if (definition.kind === "enum") {
    const raw = stored?.value ?? definition.defaultValue;
    const option = definition.options.find(
      (candidate) => candidate.toLowerCase() === raw.trim().toLowerCase(),
    );
    const stringValue = option ?? raw;
    const optionIndex = Math.max(0, definition.options.indexOf(stringValue));
    return {
      key: definition.key,
      label: definition.label,
      kind: "enum",
      value:
        definition.options.length > 1
          ? optionIndex / (definition.options.length - 1)
          : 0.5,
      stringValue,
      min: 0,
      max: Math.max(0, definition.options.length - 1),
      defaultValue: definition.defaultValue,
      options: definition.options.includes(stringValue)
        ? definition.options
        : [...definition.options, stringValue],
      display: stringValue,
    };
  }

  const numericValue =
    stored?.numericValue ??
    (stored ? Number.parseFloat(stored.value) : Number.NaN);
  const resolved = Number.isFinite(numericValue)
    ? numericValue
    : definition.defaultValue;
  const span = definition.max - definition.min;
  return {
    key: definition.key,
    label: definition.label,
    kind: "number",
    value:
      span > 0
        ? Math.max(0, Math.min(1, (resolved - definition.min) / span))
        : 0,
    numericValue: resolved,
    min: definition.min,
    max: definition.max,
    defaultValue: definition.defaultValue,
    step: definition.step,
    display: definition.format(resolved),
  };
}

// Whether a parameter with a `visibleWhen` condition shows for the effect's
// current values.
function isParameterVisible(
  parameter: FxParameterDefinition,
  definition: FxEffectDefinition,
  effect: SessionEffect,
) {
  const condition = parameter.visibleWhen;
  if (!condition) {
    return true;
  }

  const controlling = findParameterDefinition(definition, condition.key);
  const stored = effect.parameters.find(
    (candidate) => candidate.key === condition.key,
  )?.value;
  const value = (stored ?? `${controlling?.defaultValue ?? ""}`)
    .trim()
    .toLowerCase();
  return condition.values.some(
    (candidate) => candidate.toLowerCase() === value,
  );
}

// Layers an enabled Order grid has no cell for, when there are any.
function describeHiddenLayers(effect: SessionEffect, activeLayerCount: number) {
  if (effect.enabled === false || !isOrderEffectName(effect.effectName)) {
    return undefined;
  }

  const hidden = hiddenLayerCount(
    activeLayerCount,
    parseCompositionOrder(effect.parameters),
  );
  return hidden
    ? `${hidden} ${hidden === 1 ? "layer" : "layers"} hidden by grid`
    : undefined;
}

function toDevice(
  effect: SessionEffect,
  layerName: string,
  activeLayerCount = 0,
): FxDevice {
  const definition = getEffectDefinition(effect.effectName);
  const group: FxDeviceGroup =
    effect.trackId === GLOBAL_EFFECT_TRACK_ID ? "global" : "layer";
  const knownKeys = new Set(
    definition.parameters.map((parameter) => parameter.key),
  );
  const parameterDefinitions = [
    ...definition.parameters,
    ...effect.parameters
      .filter((parameter) => !knownKeys.has(parameter.key))
      .map((parameter) =>
        getFallbackParameterDefinition(
          parameter.key,
          parameter.numericValue === undefined &&
            !Number.isFinite(Number.parseFloat(parameter.value))
            ? parameter.value
            : undefined,
        ),
      ),
  ];

  return {
    id: effect.id,
    effectName: effect.effectName,
    name: definition.displayName,
    description: definition.description,
    subtitle: group === "global" ? "Global stack" : layerName,
    accent: definition.accent,
    group,
    enabled: effect.enabled !== false,
    layerDefault: isLayerLayoutEffect(effect) || undefined,
    warning: describeHiddenLayers(effect, activeLayerCount),
    parameters: parameterDefinitions
      .filter(
        (parameter) =>
          !parameter.hidden &&
          isParameterVisible(parameter, definition, effect),
      )
      .map((parameter) =>
        toDeviceParameter(
          parameter,
          effect.parameters.find((stored) => stored.key === parameter.key),
        ),
      ),
  };
}

// Devices for a layer in processing order: the layer's own stack first,
// then the Global stack.
export function mapSessionEffectsToDevices(
  effects: SessionEffect[],
  laneId: string | undefined,
  // Display name of the layer, such as "Layer 3"; defaults to its id.
  layerName = `Layer ${laneId}`,
  // Layers the compositor draws at the playhead, for the Order grid warning.
  activeLayerCount = 0,
) {
  const layerDevices = effects
    .filter((effect) => laneId !== undefined && effect.trackId === laneId)
    .map((effect) => toDevice(effect, layerName));
  const globalDevices = effects
    .filter((effect) => effect.trackId === GLOBAL_EFFECT_TRACK_ID)
    .map((effect) => toDevice(effect, layerName, activeLayerCount));
  return [...layerDevices, ...globalDevices];
}
