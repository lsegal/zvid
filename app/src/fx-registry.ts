// Definitions for the effects that `.lvp` sessions reference by `effectName`.
// Each definition gives the device a friendly name and describes its raw
// parameters (label, range, default and display format) in stack UI order.

export type FxNumberParameterDefinition = {
  kind: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  format: (value: number) => string;
  hidden?: boolean;
};

export type FxEnumParameterDefinition = {
  kind: "enum";
  key: string;
  label: string;
  options: readonly string[];
  defaultValue: string;
  hidden?: boolean;
};

export type FxParameterDefinition =
  | FxNumberParameterDefinition
  | FxEnumParameterDefinition;

export type FxEffectDefinition = {
  effectName: string;
  displayName: string;
  description: string;
  accent: string;
  parameters: FxParameterDefinition[];
  // False for the placeholder returned for effect names the registry does
  // not know; those devices show their raw parameter keys.
  known: boolean;
};

// Positions `parseLayoutAnchor` in CompositionPlayer.tsx understands.
export const LAYOUT_POSITIONS = ["Center", "Top", "Bottom"] as const;

const HIDDEN_PARAMETER_PREFIX = "_LAYERS_";

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

// Hue offsets are stored as -1..1 and map onto a -360°..360° rotation.
export function formatHueDegrees(value: number) {
  const degrees = Math.round(value * 360);
  return `${degrees > 0 ? "+" : ""}${degrees}°`;
}

// Zoom & Pan zoom is stored as 0..1 and maps onto a 1x..4x magnification.
export function formatZoom(value: number) {
  return `${(1 + 3 * value).toFixed(2)}×`;
}

export function formatRawNumber(value: number) {
  return value.toFixed(3);
}

function unitParameter(
  key: string,
  label: string,
  defaultValue: number,
): FxNumberParameterDefinition {
  return {
    kind: "number",
    key,
    label,
    min: 0,
    max: 1,
    defaultValue,
    step: 0.01,
    format: formatPercent,
  };
}

function zoomParameter(
  key: string,
  label: string,
): FxNumberParameterDefinition {
  return { ...unitParameter(key, label, 0), format: formatZoom };
}

const DEFINITIONS: FxEffectDefinition[] = [
  {
    effectName: "ZoomAndPan",
    displayName: "Zoom & Pan",
    description: "Zooms and pans the frame from a start to an end framing.",
    accent: "#7ca1ff",
    known: true,
    parameters: [
      zoomParameter("_Start_Zoom", "Start Zoom"),
      unitParameter("_Start_X", "Start X", 0.5),
      unitParameter("_Start_Y", "Start Y", 0.5),
      zoomParameter("_End_Zoom", "End Zoom"),
      unitParameter("_End_X", "End X", 0.5),
      unitParameter("_End_Y", "End Y", 0.5),
      {
        ...unitParameter("_LAYERS_SelFrac", "Selection Fraction", 0),
        hidden: true,
      },
    ],
  },
  {
    effectName: "Colorize",
    displayName: "Colorize",
    description: "Shifts the hue of the layer in time with the music.",
    accent: "#ff6f9d",
    known: true,
    parameters: [
      {
        kind: "number",
        key: "_HueOffset",
        label: "Hue Shift",
        min: -1,
        max: 1,
        defaultValue: 0,
        step: 0.01,
        format: formatHueDegrees,
      },
      unitParameter("_Reactivity", "Reactivity", 0.5),
    ],
  },
  {
    effectName: "Pixelate",
    displayName: "Pixelate",
    description: "Reduces the layer to large pixels between two intensities.",
    accent: "#7ee0a4",
    known: true,
    parameters: [
      unitParameter("_NumPixels", "Pixel Size", 0.5),
      unitParameter("_LowIntensity", "Low", 0),
      unitParameter("_HighIntensity", "High", 1),
    ],
  },
  {
    effectName: "NegativeSplit",
    displayName: "Negative Split",
    description: "Inverts the brightness range between two intensities.",
    accent: "#c38fff",
    known: true,
    parameters: [
      unitParameter("_LowIntensity", "Low", 0),
      unitParameter("_HighIntensity", "High", 1),
    ],
  },
  {
    effectName: "AnalogGlitch",
    displayName: "Analog Glitch",
    description: "Adds analog tape jitter and colour bleed.",
    accent: "#f6b73c",
    known: true,
    parameters: [
      unitParameter("_LowMod", "Low", 0),
      unitParameter("_HighMod", "High", 0.5),
    ],
  },
  {
    effectName: "Layout",
    displayName: "Layout",
    description: "Anchors the frame inside the canvas.",
    accent: "#5fd3e6",
    known: true,
    parameters: [
      {
        kind: "enum",
        key: "Position",
        label: "Position",
        options: LAYOUT_POSITIONS,
        defaultValue: "Center",
      },
    ],
  },
];

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
      known: false,
      parameters: [],
    }
  );
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
