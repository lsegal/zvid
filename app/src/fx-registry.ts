// Definitions for the effects that `.lvp` sessions reference by `effectName`.
// Each definition gives the device a friendly name and describes its raw
// parameters (label, range, default and display format) in stack UI order.

import {
  EXCLUDED_LAYERS_KEY,
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
import {
  DEFAULT_FONT_FAMILY,
  FONT_WEIGHT_LABELS,
  getFontWeightLabels,
} from "./text-fonts.ts";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_SHADOW_COLOR,
  DEFAULT_STROKE_COLOR,
  DEFAULT_TEXT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_GRADIENT,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  OFF_ON,
  TEXT_ALIGNS,
  TEXT_EFFECT_NAME,
  TEXT_FILL_MODES,
  TEXT_STYLE_FLAGS,
  TEXT_VERTICAL_ALIGNS,
} from "./text-style.ts";

// Shows a parameter only while the enum parameter `key` holds one of
// `values` (compared case-insensitively).
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

// Reads another parameter's stored value on the same effect.
export type FxParameterReader = (key: string) => string | undefined;

export type FxEnumParameterDefinition = {
  kind: "enum";
  key: string;
  label: string;
  options: readonly string[];
  // The options available for the effect's current values, a subset of
  // `options` in the same order. A stored value outside them shows as the
  // nearest one.
  optionsFor?: (read: FxParameterReader) => readonly string[];
  // Picks from a dropdown menu instead of segmented buttons, for long
  // option lists.
  menu?: boolean;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

// A toggle in a `flags` parameter: `value` is stored, `label` is its button
// and `title` its accessible name.
export type FxFlagOption = { value: string; label: string; title: string };

// String parameters with their own editors: a CSS colour (`color`) or CSS
// linear/radial gradient (`gradient`) with a colour picker, free text
// (`text`) in a text area, a font (`font`) from the font list, a set of
// toggles (`flags`) stored comma-separated, and a set of layers (`layers`)
// stored as comma-separated layer ids.
type FxStringParameterFields = {
  key: string;
  label: string;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

export type FxStringParameterDefinition =
  | (FxStringParameterFields & { kind: "color" })
  | (FxStringParameterFields & { kind: "gradient" })
  | (FxStringParameterFields & { kind: "text" })
  | (FxStringParameterFields & { kind: "font" })
  | (FxStringParameterFields & { kind: "layers" })
  | (FxStringParameterFields & {
      kind: "flags";
      options: readonly FxFlagOption[];
    });

export type FxParameterDefinition =
  | FxNumberParameterDefinition
  | FxEnumParameterDefinition
  | FxStringParameterDefinition;

// The stacks an effect is designed for: a clip's own stack, which processes
// that clip before its layer does, a layer's own stack, the Global stack
// that processes the composite, and an FX clip's own stack, which processes
// the composite beneath the FX clip. Effects that make content (Color, Text)
// or place a layer (Layout) have nothing to work on in an FX clip.
export type FxEffectScope = "layer" | "clip" | "global" | "fxClip";

const ALL_SCOPES: readonly FxEffectScope[] = [
  "layer",
  "clip",
  "global",
  "fxClip",
];

export type FxEffectDefinition = {
  effectName: string;
  displayName: string;
  description: string;
  accent: string;
  parameters: FxParameterDefinition[];
  // Stacks the add menus offer the effect on. A device loaded onto any other
  // stack still shows, flagged as not supported there.
  scopes: readonly FxEffectScope[];
  // True for an effect every visual layer is given exactly once, so no add
  // menu offers it.
  layerDefault?: boolean;
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

export function formatEms(value: number) {
  return `${Number(value.toFixed(2))} em`;
}

export function formatMultiple(value: number) {
  return `${value.toFixed(2)}×`;
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
    scopes: ALL_SCOPES,
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
    scopes: ALL_SCOPES,
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
    scopes: ALL_SCOPES,
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
    scopes: ALL_SCOPES,
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
    scopes: ALL_SCOPES,
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
    scopes: ["layer"],
    layerDefault: true,
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
    effectName: "Transform",
    displayName: "Transform",
    description: "Moves, resizes and rotates the layer inside the canvas.",
    accent: "#ff9f6b",
    known: true,
    // On a clip it places the clip inside its layer's transformed box, and
    // on an FX clip it moves the box the FX clip adjusts.
    scopes: ["layer", "clip", "fxClip"],
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
    // On an FX clip it arranges the layers beneath the clip.
    scopes: ["global", "fxClip"],
    parameters: [
      {
        kind: "enum",
        key: "Arrangement",
        label: "Order",
        options: ORDER_ARRANGEMENTS,
        defaultValue: "Vertical",
      },
      // Only exclusions are stored, so a new layer is arranged too.
      {
        kind: "layers",
        key: EXCLUDED_LAYERS_KEY,
        label: "Layers",
        defaultValue: "",
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
  {
    effectName: COLOR_EFFECT_NAME,
    displayName: "Color",
    description: "Paints fill clips a solid colour or a gradient.",
    accent: "#ffd166",
    known: true,
    // A fill clip carries its own Color; one on the layer paints the layer's
    // fill clips that have none.
    scopes: ["layer", "clip"],
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
    effectName: TEXT_EFFECT_NAME,
    displayName: "Text",
    description: "Sets the words, font and look of a text clip.",
    accent: "#e8e4ff",
    known: true,
    // Each text clip carries its own Text, so clips on one layer can say
    // different things.
    scopes: ["clip"],
    parameters: [
      { kind: "text", key: "Text", label: "Text", defaultValue: DEFAULT_TEXT },
      {
        kind: "font",
        key: "FontFamily",
        label: "Font",
        defaultValue: DEFAULT_FONT_FAMILY,
      },
      {
        kind: "enum",
        key: "FontWeight",
        label: "Weight",
        options: FONT_WEIGHT_LABELS,
        optionsFor: (read) => getFontWeightLabels(read("FontFamily")),
        menu: true,
        defaultValue: "Regular",
      },
      {
        kind: "flags",
        key: "FontStyle",
        label: "Style",
        options: TEXT_STYLE_FLAGS,
        defaultValue: "",
      },
      {
        kind: "enum",
        key: "Align",
        label: "Align",
        options: TEXT_ALIGNS,
        defaultValue: "Center",
      },
      {
        kind: "enum",
        key: "VerticalAlign",
        label: "Vertical",
        options: TEXT_VERTICAL_ALIGNS,
        defaultValue: "Middle",
      },
      {
        kind: "enum",
        key: "ResizeToFit",
        label: "Resize to fit",
        options: OFF_ON,
        defaultValue: "Off",
      },
      {
        kind: "enum",
        key: "FillMode",
        label: "Fill",
        options: TEXT_FILL_MODES,
        defaultValue: "Solid",
      },
      {
        kind: "color",
        key: "Color",
        label: "Color",
        defaultValue: DEFAULT_TEXT_COLOR,
        visibleWhen: { key: "FillMode", values: ["Solid"] },
      },
      {
        kind: "gradient",
        key: "Gradient",
        label: "Gradient",
        defaultValue: DEFAULT_TEXT_GRADIENT,
        visibleWhen: { key: "FillMode", values: ["Gradient"] },
      },
      {
        kind: "color",
        key: "Stroke",
        label: "Stroke Color",
        defaultValue: DEFAULT_STROKE_COLOR,
      },
      {
        kind: "enum",
        key: "Shadow",
        label: "Shadow",
        options: OFF_ON,
        defaultValue: "Off",
      },
      {
        kind: "color",
        key: "ShadowColor",
        label: "Shadow Color",
        defaultValue: DEFAULT_SHADOW_COLOR,
        visibleWhen: { key: "Shadow", values: ["On"] },
      },
      {
        kind: "number",
        key: "FontSize",
        label: "Size",
        min: MIN_FONT_SIZE,
        max: MAX_FONT_SIZE,
        defaultValue: DEFAULT_FONT_SIZE,
        step: 1,
        format: formatPixels,
      },
      {
        kind: "number",
        key: "LineHeight",
        label: "Leading",
        min: 0.6,
        max: 3,
        defaultValue: 1.2,
        step: 0.01,
        format: formatMultiple,
      },
      {
        kind: "number",
        key: "LetterSpacing",
        label: "Tracking",
        min: -0.2,
        max: 1,
        defaultValue: 0,
        step: 0.01,
        format: formatEms,
      },
      {
        kind: "number",
        key: "StrokeWidth",
        label: "Stroke",
        min: 0,
        max: 20,
        defaultValue: 0,
        step: 0.5,
        format: formatPixels,
      },
      {
        kind: "number",
        key: "Padding",
        label: "Padding",
        min: 0,
        max: 200,
        defaultValue: 0,
        step: 1,
        format: formatPixels,
      },
      {
        kind: "number",
        key: "ShadowBlur",
        label: "Blur",
        min: 0,
        max: 50,
        defaultValue: 8,
        step: 1,
        format: formatPixels,
        visibleWhen: { key: "Shadow", values: ["On"] },
      },
      {
        kind: "number",
        key: "ShadowOffsetX",
        label: "Shadow X",
        min: -50,
        max: 50,
        defaultValue: 4,
        step: 1,
        format: formatPixels,
        visibleWhen: { key: "Shadow", values: ["On"] },
      },
      {
        kind: "number",
        key: "ShadowOffsetY",
        label: "Shadow Y",
        min: -50,
        max: 50,
        defaultValue: 4,
        step: 1,
        format: formatPixels,
        visibleWhen: { key: "Shadow", values: ["On"] },
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
