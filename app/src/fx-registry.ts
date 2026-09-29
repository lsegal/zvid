// Definitions for the effects that `.lvp` sessions reference by `effectName`.
// Each definition gives the device a friendly name and describes its raw
// parameters (label, range, default and display format) in stack UI order.

import {
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  ORDER_ARRANGEMENTS,
  ORDER_EFFECT_NAME,
  SPACING_MAX,
} from "./composition-order.ts";
import {
  COLOR_EFFECT_NAME,
  DEFAULT_FILL_GRADIENT,
  FILL_MODES,
  NEUTRAL_FILL_COLOR,
} from "./fill-paint.ts";

// Shows a parameter only while the enum parameter `key` holds one of
// `values` (compared case-insensitively), such as the Color effect's colour
// while its Type is Solid.
export type FxParameterVisibility = {
  key: string;
  values: readonly string[];
};

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
  visibleWhen?: FxParameterVisibility;
};

export type FxEnumParameterDefinition = {
  kind: "enum";
  key: string;
  label: string;
  options: readonly string[];
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

// A CSS colour (`color`) or CSS linear/radial gradient (`gradient`) string,
// edited with a colour picker.
type FxPaintParameterFields = {
  key: string;
  label: string;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

export type FxPaintParameterDefinition =
  | (FxPaintParameterFields & { kind: "color" })
  | (FxPaintParameterFields & { kind: "gradient" });

export type FxParameterDefinition =
  | FxNumberParameterDefinition
  | FxEnumParameterDefinition
  | FxPaintParameterDefinition;

// Where an effect can go: a layer's own stack and/or the Global stack.
export type FxEffectScope = "layer" | "global";

export type FxEffectDefinition = {
  effectName: string;
  displayName: string;
  description: string;
  accent: string;
  parameters: FxParameterDefinition[];
  // Stacks the add menus offer the effect on; every stack when omitted.
  scopes?: readonly FxEffectScope[];
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

export function formatSignedPercent(value: number) {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export function formatDegrees(value: number) {
  return `${Math.round(value)}°`;
}

export function formatGridSize(value: number) {
  const size = Math.round(value);
  return `${size}×${size}`;
}

export function formatPixels(value: number) {
  return `${Math.round(value)} px`;
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

function transformParameter(
  key: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  format: (value: number) => string,
): FxNumberParameterDefinition {
  return {
    kind: "number",
    key,
    label,
    min,
    max,
    defaultValue,
    step: 0.01,
    format,
  };
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
  {
    effectName: COLOR_EFFECT_NAME,
    displayName: "Color",
    description: "Paints the layer's fill clips a solid colour or a gradient.",
    accent: "#ffd166",
    known: true,
    scopes: ["layer"],
    parameters: [
      {
        kind: "enum",
        key: "Mode",
        label: "Type",
        options: FILL_MODES,
        defaultValue: "Solid",
      },
      {
        kind: "color",
        key: "Color",
        label: "Color",
        defaultValue: NEUTRAL_FILL_COLOR,
        visibleWhen: { key: "Mode", values: ["Solid"] },
      },
      {
        kind: "gradient",
        key: "Gradient",
        label: "Gradient",
        defaultValue: DEFAULT_FILL_GRADIENT,
        visibleWhen: { key: "Mode", values: ["Gradient"] },
      },
      unitParameter("Opacity", "Opacity", 1),
    ],
  },
  {
    effectName: "Transform",
    displayName: "Transform",
    description: "Moves, resizes and rotates the layer inside the canvas.",
    accent: "#ff9f6b",
    known: true,
    parameters: [
      transformParameter("PositionX", "X", -2, 2, 0, formatSignedPercent),
      transformParameter("PositionY", "Y", -2, 2, 0, formatSignedPercent),
      transformParameter("ScaleX", "Width", 0.05, 8, 1, formatPercent),
      transformParameter("ScaleY", "Height", 0.05, 8, 1, formatPercent),
      transformParameter("OriginX", "Origin X", -1, 1, 0, formatSignedPercent),
      transformParameter("OriginY", "Origin Y", -1, 1, 0, formatSignedPercent),
      {
        ...transformParameter(
          "Rotation",
          "Rotation",
          -180,
          180,
          0,
          formatDegrees,
        ),
        step: 1,
      },
    ],
  },
  {
    effectName: ORDER_EFFECT_NAME,
    displayName: "Order",
    description:
      "Arranges the layers in stacked rows, side-by-side columns or a grid.",
    accent: "#b6e36b",
    known: true,
    parameters: [
      {
        kind: "enum",
        key: "Arrangement",
        label: "Order",
        options: ORDER_ARRANGEMENTS,
        defaultValue: "Vertical",
      },
      {
        kind: "number",
        key: "GridSize",
        label: "Grid Size",
        min: GRID_SIZE_MIN,
        max: GRID_SIZE_MAX,
        defaultValue: GRID_SIZE_MIN,
        step: 1,
        format: formatGridSize,
        visibleWhen: { key: "Arrangement", values: ["Grid"] },
      },
      {
        kind: "number",
        key: "Spacing",
        label: "Spacing",
        min: 0,
        max: SPACING_MAX,
        defaultValue: 0,
        step: 1,
        format: formatPixels,
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
