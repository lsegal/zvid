// A layer's effect stack is the ordered subset of the project's `effects`
// array that shares one `trackId` (a Layer id or GLOBAL_EFFECT_TRACK_ID).
// Array order is stack order. The helpers here are pure: each returns a new
// `effects` array, or the same array when nothing changed so history
// commits can skip no-op edits.

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
  // True for the placeholder Layout device shown when a session has none;
  // it does not exist in `effects` and cannot be edited.
  placeholder?: boolean;
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
  const effect = createEffect(trackId, effectName, id);
  const stack = getStack(effects, trackId);
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
  if (index < 0) {
    return effects;
  }

  return [...effects.slice(0, index), ...effects.slice(index + 1)];
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

function toDevice(effect: SessionEffect, layerName: string): FxDevice {
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
    parameters: parameterDefinitions
      .filter((parameter) => !parameter.hidden)
      .map((parameter) =>
        toDeviceParameter(
          parameter,
          effect.parameters.find((stored) => stored.key === parameter.key),
        ),
      ),
  };
}

function createPlaceholderLayoutDevice(
  laneId: string | undefined,
  layerName: string,
): FxDevice {
  const definition = getEffectDefinition("Layout");
  return {
    id: `layout-default-${laneId ?? "global"}`,
    effectName: definition.effectName,
    name: definition.displayName,
    description: definition.description,
    subtitle: laneId
      ? `${layerName} / default frame anchor`
      : "Default frame anchor",
    accent: definition.accent,
    group: "layer",
    enabled: true,
    placeholder: true,
    parameters: definition.parameters.map((parameter) =>
      toDeviceParameter(parameter, undefined),
    ),
  };
}

// Devices for a layer in processing order: the layer's own stack first,
// then the Global stack. Visual layers without any Layout effect get a
// placeholder Layout device showing the default anchor.
export function mapSessionEffectsToDevices(
  effects: SessionEffect[],
  laneId: string | undefined,
  kind: string | undefined,
  // Display name of the layer, such as "Layer 3"; defaults to its id.
  layerName = `Layer ${laneId}`,
) {
  const layerDevices = effects
    .filter((effect) => laneId !== undefined && effect.trackId === laneId)
    .map((effect) => toDevice(effect, layerName));
  const globalDevices = effects
    .filter((effect) => effect.trackId === GLOBAL_EFFECT_TRACK_ID)
    .map((effect) => toDevice(effect, layerName));
  const devices = [...layerDevices, ...globalDevices];

  if (
    kind === "audio" ||
    devices.some((device) => isLayoutEffectName(device.effectName))
  ) {
    return devices;
  }

  return [createPlaceholderLayoutDevice(laneId, layerName), ...devices];
}
