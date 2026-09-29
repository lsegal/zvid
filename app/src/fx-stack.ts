// A layer's effect stack is the ordered subset of the project's `effects`
// array that shares one `trackId` (a Layer id, a clip's `clip:<clipId>` or
// GLOBAL_EFFECT_TRACK_ID). Array order is stack order. The helpers here are pure: each returns a new
// `effects` array, or the same array when nothing changed so history
// commits can skip no-op edits.

import {
  EXCLUDED_LAYERS_KEY,
  hiddenLayerCount,
  isLayerArranged,
  isOrderEffectName,
  ORDER_EFFECT_NAME,
  parseCompositionOrder,
  pruneLayerIdList,
} from "./composition-order.ts";
import { isColorEffectName } from "./fill-paint.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
  normalizeEffectAnimation,
  supportsAnimation,
} from "./fx-animation-defaults.ts";
import {
  type FxEffectDefinition,
  type FxEffectScope,
  type FxFlagOption,
  type FxParameterDefinition,
  type FxParameterVisibility,
  getEffectDefinition,
  getFallbackParameterDefinition,
  isEffectSupportedIn,
} from "./fx-registry.ts";
import type { LvpSession } from "./session.ts";
import { parseFontChoice } from "./text-fonts.ts";
import { isTextEffectName } from "./text-style.ts";

export const GLOBAL_EFFECT_TRACK_ID = "__group_main";

// A clip's own stack is keyed by its clip id, so it follows the clip to
// another layer and survives save/load and collaboration with the clip.
const CLIP_EFFECT_TRACK_PREFIX = "clip:";

export function clipEffectTrackId(clipId: string) {
  return `${CLIP_EFFECT_TRACK_PREFIX}${clipId}`;
}

// The clip a clip stack belongs to, or undefined for a layer or the Global
// stack.
export function getEffectClipId(trackId: string) {
  return trackId.startsWith(CLIP_EFFECT_TRACK_PREFIX)
    ? trackId.slice(CLIP_EFFECT_TRACK_PREFIX.length)
    : undefined;
}

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
  // Bypass flag, saved to `.lvp` as zvid-only `enabled: false`.
  enabled: boolean;
  // The Animation modifier's settings, once it has been turned on. Saved to
  // `.lvp` as zvid-only `animation`.
  animation?: EffectAnimation;
};

export type FxDeviceParameter = {
  key: string;
  label: string;
  kind:
    | "number"
    | "enum"
    | "color"
    | "gradient"
    | "text"
    | "font"
    | "flags"
    | "layers";
  // Position of the value within [min, max], 0..1, for meters.
  value: number;
  numericValue?: number;
  stringValue?: string;
  min: number;
  max: number;
  defaultValue: number | string;
  step?: number;
  options?: readonly string[];
  // The toggles of a `flags` parameter.
  flags?: readonly FxFlagOption[];
  // An enum picked from a dropdown menu.
  menu?: boolean;
  // Shown dimmed, still editable, while it has no visible effect.
  dimmed?: boolean;
  display: string;
};

export type FxDeviceGroup = "layer" | "clip" | "global";

export type FxDevice = {
  id: string;
  effectName: string;
  name: string;
  description: string;
  subtitle: string;
  accent: string;
  group: FxDeviceGroup;
  enabled: boolean;
  // True when the effect can carry the Animation modifier (every known
  // effect but Layout).
  supportsAnimation: boolean;
  // The modifier's settings, once it has been turned on.
  animation?: EffectAnimation;
  // True for a layer's own Layout device. Every visual layer has exactly
  // one, so it can be reset to its defaults but not removed or duplicated.
  layerDefault?: boolean;
  // Labels for the knob rows, when the knobs split evenly into labelled
  // rows, such as a Move's Start and End.
  knobRows?: readonly string[];
  // True for a device on a stack its effect isn't designed for, such as a
  // Global Layout from an older session. It still loads and can be removed.
  unsupported?: boolean;
  // A problem to point out on the device, such as layers an Order grid has
  // no cell for.
  warning?: string;
  parameters: FxDeviceParameter[];
};

export function getTrackGroup(trackId: string): FxDeviceGroup {
  if (trackId === GLOBAL_EFFECT_TRACK_ID) {
    return "global";
  }

  return getEffectClipId(trackId) === undefined ? "layer" : "clip";
}

export function mapEffects(source: LvpSession["effects"]) {
  return (source ?? []).map<SessionEffect>((effect) => {
    const animation = normalizeEffectAnimation(
      effect.animation,
      effect.effectName,
    );
    return {
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
    // Sessions without the flag, including every Layers session, are on.
    enabled: effect.enabled !== false,
    ...(animation ? { animation } : {}),
  };
  });
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

    const current = effect.animation ?? createDefaultAnimation(effect.effectName);
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
    return !next ||
      JSON.stringify(next) === JSON.stringify(effect.animation)
      ? effect
      : { ...effect, animation: next };
  });
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
// nothing but its Layout anchoring, the Color its fill clips are painted
// with and any Text a session from before clip Text still has there. Clip
// stacks are not the layer's and stay. Returns `effects` itself when no
// layer is bypassed.
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
      !bypassed.has(effect.trackId) ||
      isLayoutEffectName(effect.effectName) ||
      isColorEffectName(effect.effectName) ||
      isTextEffectName(effect.effectName),
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
    ...(source.animation ? { animation: cloneAnimation(source.animation) } : {}),
  };
  return [...effects.slice(0, index + 1), copy, ...effects.slice(index + 1)];
}

function cloneAnimation(animation: EffectAnimation): EffectAnimation {
  return {
    ...animation,
    clip: { ...animation.clip },
    reactive: {
      ...animation.reactive,
      parameters: [...animation.reactive.parameters],
    },
  };
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
    getTrackGroup(effect.trackId) === "layer" &&
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

export function isLayoutEffectName(effectName: string) {
  return effectName.trim().toLowerCase().includes("layout");
}

// The option of `available` nearest to `value` in the full `options` order.
function nearestOption(
  value: string,
  options: readonly string[],
  available: readonly string[],
) {
  const index = options.indexOf(value);
  let best = available[0] ?? value;
  for (const candidate of available) {
    if (
      Math.abs(options.indexOf(candidate) - index) <
      Math.abs(options.indexOf(best) - index)
    ) {
      best = candidate;
    }
  }
  return best;
}

function toDeviceParameter(
  definition: FxParameterDefinition,
  stored: EffectParameter | undefined,
  read: (key: string) => string | undefined,
): FxDeviceParameter {
  if (definition.kind !== "number" && definition.kind !== "enum") {
    // Text, style toggles and layer lists can be empty; paint and fonts
    // fall back to their defaults.
    const stringValue =
      definition.kind === "text" ||
      definition.kind === "flags" ||
      definition.kind === "layers"
        ? (stored?.value ?? definition.defaultValue)
        : stored?.value.trim() || definition.defaultValue;
    return {
      key: definition.key,
      label: definition.label,
      kind: definition.kind,
      value: 0,
      stringValue,
      min: 0,
      max: 0,
      defaultValue: definition.defaultValue,
      flags: definition.kind === "flags" ? definition.options : undefined,
      display:
        definition.kind === "font"
          ? parseFontChoice(stringValue).family
          : stringValue,
    };
  }

  if (definition.kind === "enum") {
    const raw = stored?.value ?? definition.defaultValue;
    const option = definition.options.find(
      (candidate) => candidate.toLowerCase() === raw.trim().toLowerCase(),
    );
    const available = definition.optionsFor?.(read) ?? definition.options;
    const stringValue =
      option && !available.includes(option)
        ? nearestOption(option, definition.options, available)
        : (option ?? raw);
    const optionIndex = Math.max(0, available.indexOf(stringValue));
    return {
      key: definition.key,
      label: definition.label,
      kind: "enum",
      value: available.length > 1 ? optionIndex / (available.length - 1) : 0.5,
      stringValue,
      min: 0,
      max: Math.max(0, available.length - 1),
      defaultValue: definition.defaultValue,
      options: available.includes(stringValue)
        ? available
        : [...available, stringValue],
      menu: definition.menu,
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

// Whether the effect's current value of `condition.key` is one of
// `condition.values`: numerically for numbers, otherwise ignoring case.
function matchesCondition(
  condition: FxParameterVisibility,
  definition: FxEffectDefinition,
  effect: SessionEffect,
) {
  const controlling = findParameterDefinition(definition, condition.key);
  const stored = effect.parameters.find(
    (candidate) => candidate.key === condition.key,
  );
  const value = (stored?.value ?? `${controlling?.defaultValue ?? ""}`)
    .trim()
    .toLowerCase();
  const numeric = stored?.numericValue ?? Number.parseFloat(value);
  return condition.values.some((candidate) =>
    Number.isFinite(numeric) && Number.isFinite(Number.parseFloat(candidate))
      ? Number.parseFloat(candidate) === numeric
      : candidate.toLowerCase() === value,
  );
}

// Whether a parameter with a `visibleWhen` condition shows for the effect's
// current values.
function isParameterVisible(
  parameter: FxParameterDefinition,
  definition: FxEffectDefinition,
  effect: SessionEffect,
) {
  const condition = parameter.visibleWhen;
  return !condition || matchesCondition(condition, definition, effect);
}

// Whether a parameter with a `dimmedWhen` condition is dimmed for the
// effect's current values.
function isParameterDimmed(
  parameter: FxParameterDefinition,
  definition: FxEffectDefinition,
  effect: SessionEffect,
) {
  const condition =
    "dimmedWhen" in parameter ? parameter.dimmedWhen : undefined;
  return !!condition && matchesCondition(condition, definition, effect);
}

// Layers an enabled Order grid has no cell for, when there are any. Layers
// the Order excludes need no cell.
function describeHiddenLayers(
  effect: SessionEffect,
  activeLayerIds: readonly string[],
) {
  if (effect.enabled === false || !isOrderEffectName(effect.effectName)) {
    return undefined;
  }

  const order = parseCompositionOrder(effect.parameters);
  const hidden = hiddenLayerCount(
    activeLayerIds.filter((id) => isLayerArranged(order, id)).length,
    order,
  );
  return hidden
    ? `${hidden} ${hidden === 1 ? "layer" : "layers"} hidden by grid`
    : undefined;
}

// The font of an enabled Text effect that could not be loaded, which is
// drawn in the default font instead.
function describeMissingFont(
  effect: SessionEffect,
  missingFonts: ReadonlySet<string>,
) {
  if (effect.enabled === false || !isTextEffectName(effect.effectName)) {
    return undefined;
  }

  const stored = effect.parameters.find(
    (parameter) => parameter.key === "FontFamily",
  )?.value;
  const font = parseFontChoice(stored);
  const value = stored?.trim();
  return value && missingFonts.has(value)
    ? `Font not available: ${font.family}`
    : undefined;
}

function toDevice(
  effect: SessionEffect,
  layerName: string,
  activeLayerIds: readonly string[] = [],
  missingFonts: ReadonlySet<string> = new Set(),
  // The scope a clip stack's effects are checked against: "fxClip" for an
  // FX clip.
  clipScope: FxEffectScope = "clip",
): FxDevice {
  const definition = getEffectDefinition(effect.effectName);
  const group = getTrackGroup(effect.trackId);
  const scope = group === "clip" ? clipScope : group;
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
    subtitle:
      group === "global"
        ? "Global stack"
        : group === "clip"
          ? "Clip"
          : layerName,
    accent: definition.accent,
    group,
    enabled: effect.enabled !== false,
    supportsAnimation: supportsAnimation(effect.effectName),
    ...(effect.animation ? { animation: effect.animation } : {}),
    layerDefault: isLayerLayoutEffect(effect) || undefined,
    ...(definition.knobRows ? { knobRows: definition.knobRows } : {}),
    unsupported: !isEffectSupportedIn(effect.effectName, scope) || undefined,
    warning:
      describeHiddenLayers(effect, activeLayerIds) ??
      describeMissingFont(effect, missingFonts),
    parameters: parameterDefinitions
      .filter(
        (parameter) =>
          !parameter.hidden &&
          isParameterVisible(parameter, definition, effect),
      )
      .map((parameter) => {
        const device = toDeviceParameter(
          parameter,
          effect.parameters.find((stored) => stored.key === parameter.key),
          (key) =>
            effect.parameters.find((stored) => stored.key === key)?.value,
        );
        return isParameterDimmed(parameter, definition, effect)
          ? { ...device, dimmed: true }
          : device;
      }),
  };
}

// Shown on an Order that isn't first on an FX clip's stack.
export const ORDER_RUNS_FIRST_NOTE =
  "Arranges the layers before the effects to its left";

// Devices for a layer: the layer's own stack, then the Global stack, then
// the selected clip's own stack (`clipId`), which is processed first.
export function mapSessionEffectsToDevices(
  effects: SessionEffect[],
  laneId: string | undefined,
  // Display name of the layer, such as "Layer 3"; defaults to its id.
  layerName = `Layer ${laneId}`,
  // Ids of the layers the compositor draws at the playhead, for the Order
  // grid warning.
  activeLayerIds: readonly string[] = [],
  // Fonts that could not be loaded, for the Text device's warning.
  missingFonts: ReadonlySet<string> = new Set(),
  // The selected clip, whose own stack is listed too.
  clipId?: string,
  // "fxClip" when the selected clip is an FX clip.
  clipScope: FxEffectScope = "clip",
  // Ids of the layers beneath the selected FX clip at the playhead, for the
  // grid warning of an Order on its stack.
  clipLayerIds: readonly string[] = [],
) {
  const layerDevices = effects
    .filter((effect) => laneId !== undefined && effect.trackId === laneId)
    .map((effect) => toDevice(effect, layerName, [], missingFonts));
  const globalDevices = effects
    .filter((effect) => effect.trackId === GLOBAL_EFFECT_TRACK_ID)
    .map((effect) => toDevice(effect, layerName, activeLayerIds));
  const clipTrackId =
    clipId === undefined ? undefined : clipEffectTrackId(clipId);
  const clipDevices = effects
    .filter((effect) => effect.trackId === clipTrackId)
    .map((effect, index) => {
      const device = toDevice(
        effect,
        layerName,
        clipScope === "fxClip" ? clipLayerIds : [],
        missingFonts,
        clipScope,
      );
      // An FX clip arranges the layers beneath it before any of its other
      // effects run, wherever its Order sits in the stack.
      return clipScope === "fxClip" &&
        index > 0 &&
        !device.warning &&
        !device.unsupported &&
        isOrderEffectName(effect.effectName)
        ? { ...device, warning: ORDER_RUNS_FIRST_NOTE }
        : device;
    });
  return [...layerDevices, ...globalDevices, ...clipDevices];
}

type StackEffect = {
  id: string;
  trackId: string;
  parameters: readonly object[];
};

// Gives each `[fromClipId, toClipId]` copy of a clip the source clip's stack,
// with new effect ids, in place of any stack the copy had. The stacks are
// read from `source`, such as a clipboard snapshot of clips that were cut
// since, and default to `effects`. Returns `effects` itself when no source
// clip has a stack.
export function copyClipEffects<T extends StackEffect>(
  effects: T[],
  copies: Iterable<readonly [string, string]>,
  source: readonly T[] = effects,
  createId: () => string = () => crypto.randomUUID(),
) {
  let result = effects;
  for (const [fromClipId, toClipId] of copies) {
    const fromTrackId = clipEffectTrackId(fromClipId);
    const toTrackId = clipEffectTrackId(toClipId);
    const stack = source.filter((effect) => effect.trackId === fromTrackId);
    if (!stack.length || fromTrackId === toTrackId) {
      continue;
    }

    result = [
      ...result.filter((effect) => effect.trackId !== toTrackId),
      ...stack.map(
        (effect) =>
          ({
            ...effect,
            id: createId(),
            trackId: toTrackId,
            parameters: effect.parameters.map((parameter) => ({
              ...parameter,
            })),
            ...("animation" in effect && effect.animation
              ? { animation: cloneAnimation(effect.animation as EffectAnimation) }
              : {}),
          }) as T,
      ),
    ];
  }
  return result;
}

// The effects a Ctrl/Cmd-drag duplicate is drawn with before it is dropped:
// the in-flight copy borrows its source clip's stack, so it looks as it will
// once dropped. Nothing is committed; the drop copies the stack for real
// with `copyClipEffects`. The ids are stable across calls, so redrawing the
// drag doesn't churn them. Returns `effects` itself when the source clip has
// no stack.
export function previewDuplicateClipEffects<T extends StackEffect>(
  effects: T[],
  sourceClipId: string,
  copyClipId: string,
) {
  let next = 0;
  return copyClipEffects(
    effects,
    [[sourceClipId, copyClipId]],
    effects,
    () => `${clipEffectTrackId(copyClipId)}:preview-${++next}`,
  );
}

// Drops the stacks of clips that are gone, so deleting a clip deletes its
// effects. Returns `effects` itself when every clip stack still has its clip.
export function pruneClipEffects<T extends { trackId: string }>(
  effects: T[],
  clips: readonly { id: string }[],
) {
  const clipIds = new Set(clips.map((clip) => clip.id));
  const isOrphan = (effect: T) => {
    const clipId = getEffectClipId(effect.trackId);
    return clipId !== undefined && !clipIds.has(clipId);
  };
  return effects.some(isOrphan)
    ? effects.filter((effect) => !isOrphan(effect))
    : effects;
}

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

// The effects with each clip stack moved to the clip's new id in `clipIds`,
// such as the ids clips are saved under. Other stacks keep their track.
export function renameClipEffectTracks<T extends { trackId: string }>(
  effects: T[],
  clipIds: ReadonlyMap<string, string>,
) {
  return effects.map((effect) => {
    const clipId = getEffectClipId(effect.trackId);
    const renamed = clipId === undefined ? undefined : clipIds.get(clipId);
    return renamed === undefined || renamed === clipId
      ? effect
      : { ...effect, trackId: clipEffectTrackId(renamed) };
  });
}
