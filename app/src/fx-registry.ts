// Definitions for the effects that `.lvp` sessions reference by `effectName`.
// Each definition gives the device a friendly name and describes its raw
// parameters (label, range, default and display format) in stack UI order.
// The definitions live in fx/effects/<effect>/definition.ts and are collected
// by the generated fx/effects/index.generated.ts; see fx/README.md.

import { EFFECT_DEFINITION_MODULES } from "./fx/effects/index.generated.ts";
import { formatRawNumber } from "./fx/params.ts";
import {
  ALL_SCOPES,
  type FxEffectDefinition,
  type FxEffectDomain,
  type FxEffectScope,
  type FxParameterDefinition,
} from "./fx/types.ts";

export { LAYOUT_POSITIONS } from "./fx/effects/layout/definition.ts";
export {
  formatDegrees,
  formatEms,
  formatGridSize,
  formatHueDegrees,
  formatMultiple,
  formatPercent,
  formatPixels,
  formatRawNumber,
  formatSignedPercent,
  formatZoom,
  zoomToUnit,
} from "./fx/params.ts";
export type {
  FxEffectCategory,
  FxEffectDefinition,
  FxEffectDomain,
  FxEffectScope,
  FxEnumParameterDefinition,
  FxFlagOption,
  FxNumberControl,
  FxNumberParameterDefinition,
  FxNumberTaper,
  FxParameterDefinition,
  FxParameterReader,
  FxParameterVisibility,
  FxScaleTick,
  FxStringParameterDefinition,
} from "./fx/types.ts";

const HIDDEN_PARAMETER_PREFIX = "_LAYERS_";

// In add-menu order.
const DEFINITIONS: FxEffectDefinition[] = EFFECT_DEFINITION_MODULES.toSorted(
  (a, b) => a.menuOrder - b.menuOrder,
).map((module) => module.definition);

const DEFINITIONS_BY_NAME = new Map(
  DEFINITIONS.map((definition) => [definition.effectName, definition]),
);

const FALLBACK_ACCENT = "#8d93a8";

export const FX_EFFECT_DEFINITIONS: readonly FxEffectDefinition[] = DEFINITIONS;

export function getEffectDefinition(effectName: string): FxEffectDefinition {
  return (
    DEFINITIONS_BY_NAME.get(effectName) ?? {
      effectName,
      displayName: effectName,
      description: "Unrecognized effect",
      accent: FALLBACK_ACCENT,
      category: "utility",
      known: false,
      // Unrecognized effects stay wherever the session put them.
      scopes: ALL_SCOPES,
      parameters: [],
    }
  );
}

// Whether `effectName` is designed for the `scope` stack. Unrecognized
// effects are supported wherever they are.
export function isEffectSupportedIn(effectName: string, scope: FxEffectScope) {
  return getEffectDefinition(effectName).scopes.includes(scope);
}

// What the effect processes; unrecognized effects count as video.
export function getEffectDomain(
  definition: Pick<FxEffectDefinition, "domain">,
): FxEffectDomain {
  return definition.domain ?? "video";
}

export function isAudioEffectName(effectName: string) {
  return getEffectDomain(getEffectDefinition(effectName)) === "audio";
}

export function isHiddenParameterKey(key: string) {
  return key.startsWith(HIDDEN_PARAMETER_PREFIX);
}

// Definition for a raw parameter key the effect's definition does not list,
// so unrecognized parameters still show up under their raw key.
export function getFallbackParameterDefinition(
  key: string,
  stringValue?: string,
): FxParameterDefinition {
  if (stringValue !== undefined) {
    return {
      kind: "enum",
      key,
      label: key,
      options: [stringValue],
      defaultValue: stringValue,
      hidden: isHiddenParameterKey(key),
    };
  }

  return {
    kind: "number",
    key,
    label: key,
    min: 0,
    max: 1,
    defaultValue: 0,
    format: formatRawNumber,
    hidden: isHiddenParameterKey(key),
  };
}
