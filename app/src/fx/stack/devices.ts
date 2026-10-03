import {
  hiddenLayerCount,
  isLayerArranged,
  isOrderEffectName,
  parseCompositionOrder,
} from "../../composition-order.ts";
import { supportsAnimation } from "../../fx-animation-defaults.ts";
import { supportsModulation } from "../../fx-modulation-defaults.ts";
import {
  type FxEffectDefinition,
  type FxEffectScope,
  type FxParameterDefinition,
  type FxParameterVisibility,
  getEffectDefinition,
  getEffectDomain,
  getFallbackParameterDefinition,
  isEffectSupportedIn,
} from "../../fx-registry.ts";
import { parseFontChoice } from "../../text-fonts.ts";
import { isTextEffectName } from "../../text-style.ts";
import { taperPosition } from "../taper.ts";
import { GLOBAL_EFFECT_TRACK_ID, getTrackGroup } from "./clip-stacks.ts";
import { isLayerLayoutEffect } from "./layer-fx.ts";
import { findParameterDefinition } from "./ops.ts";
import type {
  EffectParameter,
  FxDevice,
  FxDeviceParameter,
  SessionEffect,
} from "./types.ts";

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
  return {
    key: definition.key,
    label: definition.label,
    kind: "number",
    value: taperPosition(
      resolved,
      definition.min,
      definition.max,
      definition.taper,
    ),
    numericValue: resolved,
    min: definition.min,
    max: definition.max,
    defaultValue: definition.defaultValue,
    step: definition.step,
    ...(definition.control && definition.control !== "knob"
      ? { control: definition.control }
      : {}),
    ...(definition.taper && definition.taper !== "linear"
      ? { taper: definition.taper }
      : {}),
    ...(definition.ticks ? { ticks: definition.ticks } : {}),
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
  const conditions = condition ? [condition].flat() : [];
  return (
    conditions.length > 0 &&
    conditions.every((candidate) =>
      matchesCondition(candidate, definition, effect),
    )
  );
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
  const domain = getEffectDomain(definition);
  const knownKeys = new Set([
    ...definition.parameters.map((parameter) => parameter.key),
    ...(definition.retiredParameters ?? []),
  ]);
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
    domain,
    enabled: effect.enabled !== false,
    // Audio effects carry Modulation instead of Animation.
    supportsAnimation:
      domain === "video" && supportsAnimation(effect.effectName),
    ...(effect.animation ? { animation: effect.animation } : {}),
    supportsModulation:
      domain === "audio" && supportsModulation(effect.effectName),
    ...(effect.modulation ? { modulation: effect.modulation } : {}),
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
// the selected clip's own stack (`clipTrackId`), which is processed first.
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
  // The selected clip's own stack, such as `clipEffectTrackId(clipId)`,
  // which is listed too.
  clipTrackId?: string,
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
