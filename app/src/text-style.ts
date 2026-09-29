// The typography a text clip draws with, read from the Text effect on the
// clip's layer. Sizes, padding, stroke and shadow are in pixels at 1080p and
// scale with the output's short side, so preview and export match.

import {
  type FillEffect,
  type ParsedGradient,
  parseCssColor,
  parseCssGradient,
  type Rgba,
} from "./fill-paint.ts";
import {
  DEFAULT_FONT_FAMILY,
  getFontWeights,
  nearestFontWeight,
  parseFontChoice,
  parseFontWeight,
} from "./text-fonts.ts";

export const TEXT_EFFECT_NAME = "Text";
export const DEFAULT_TEXT = "Text";
export const DEFAULT_TEXT_COLOR = "rgba(255,255,255,1)";
export const DEFAULT_TEXT_GRADIENT =
  "linear-gradient(90deg, rgba(255,209,102,1) 0%, rgba(255,111,157,1) 100%)";
export const DEFAULT_STROKE_COLOR = "rgba(0,0,0,1)";
export const DEFAULT_SHADOW_COLOR = "rgba(0,0,0,0.6)";

// Font sizes are clamped to this range; Resize to fit never goes below the
// minimum.
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 600;
export const DEFAULT_FONT_SIZE = 96;
// The short side of the output sizes are given at.
export const TEXT_REFERENCE_HEIGHT = 1080;

export const TEXT_ALIGNS = ["Left", "Center", "Right", "Justify"] as const;
export const TEXT_VERTICAL_ALIGNS = ["Top", "Middle", "Bottom"] as const;
export const TEXT_FILL_MODES = ["Solid", "Gradient"] as const;
export const OFF_ON = ["Off", "On"] as const;

// Style toggles, stored comma-separated in the FontStyle parameter.
export const TEXT_STYLE_FLAGS = [
  { value: "Bold", label: "B", title: "Bold" },
  { value: "Italic", label: "I", title: "Italic" },
  { value: "Underline", label: "U", title: "Underline" },
  { value: "Strikethrough", label: "S", title: "Strikethrough" },
  { value: "AllCaps", label: "AA", title: "All caps" },
] as const;

export type TextStyleFlag = (typeof TEXT_STYLE_FLAGS)[number]["value"];

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextVerticalAlign = "top" | "middle" | "bottom";

export type TextPaint = { kind: "solid"; color: Rgba } | ParsedGradient;

export type TextStyle = {
  text: string;
  // Stored font value (see text-fonts.ts), such as `Inter` or `google:Roboto`.
  font: string;
  weight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  allCaps: boolean;
  fontSize: number;
  resizeToFit: boolean;
  align: TextAlign;
  verticalAlign: TextVerticalAlign;
  // Line height as a multiple of the font size.
  lineHeight: number;
  // Extra space between characters, in ems.
  letterSpacing: number;
  paint: TextPaint;
  stroke?: { color: Rgba; width: number };
  shadow?: { color: Rgba; blur: number; offsetX: number; offsetY: number };
  padding: number;
};

export function isTextEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "text";
}

export function parseStyleFlags(value: string | undefined) {
  const flags = new Set<TextStyleFlag>();
  for (const part of (value ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    const flag = TEXT_STYLE_FLAGS.find(
      (candidate) => candidate.value.toLowerCase() === name,
    );
    if (flag) {
      flags.add(flag.value);
    }
  }
  return flags;
}

/** The flags in toolbar order, comma-separated. */
export function formatStyleFlags(flags: ReadonlySet<string>) {
  return TEXT_STYLE_FLAGS.filter((flag) => flags.has(flag.value))
    .map((flag) => flag.value)
    .join(",");
}

export function toggleStyleFlag(value: string | undefined, flag: string) {
  const flags = new Set<string>(parseStyleFlags(value));
  if (flags.has(flag)) {
    flags.delete(flag);
  } else {
    flags.add(flag);
  }
  return formatStyleFlags(flags);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

type Reader = {
  string: (key: string) => string | undefined;
  number: (key: string, fallback: number, min: number, max: number) => number;
  option: <T extends string>(
    key: string,
    options: readonly T[],
    fallback: T,
  ) => T;
};

function createReader(effect: FillEffect | undefined): Reader {
  const find = (key: string) =>
    effect?.parameters.find(
      (parameter) => parameter.key.toLowerCase() === key.toLowerCase(),
    );
  return {
    string: (key) => find(key)?.value,
    number: (key, fallback, min, max) => {
      const parameter = find(key);
      const raw =
        parameter?.numericValue ??
        (parameter ? Number.parseFloat(parameter.value) : Number.NaN);
      return Number.isFinite(raw) ? clamp(raw, min, max) : fallback;
    },
    option: (key, options, fallback) => {
      const raw = find(key)?.value.trim().toLowerCase();
      return options.find((option) => option.toLowerCase() === raw) ?? fallback;
    },
  };
}

function readColor(value: string | undefined, fallback: string) {
  return parseCssColor(value) ?? (parseCssColor(fallback) as Rgba);
}

function readTextPaint(read: Reader): TextPaint {
  if (read.option("FillMode", TEXT_FILL_MODES, "Solid") === "Gradient") {
    const gradient = parseCssGradient(read.string("Gradient"));
    if (gradient) {
      return gradient;
    }
  }
  return {
    kind: "solid",
    color: readColor(read.string("Color"), DEFAULT_TEXT_COLOR),
  };
}

/** The style a Text effect describes, with defaults for anything unset. */
export function readTextStyle(effect: FillEffect | undefined): TextStyle {
  const read = createReader(effect);
  const flags = parseStyleFlags(read.string("FontStyle"));
  const font = read.string("FontFamily")?.trim() || DEFAULT_FONT_FAMILY;
  // Bold is a shortcut for weight 700, at the font's nearest weight.
  const weight = nearestFontWeight(
    flags.has("Bold") ? 700 : parseFontWeight(read.string("FontWeight")),
    getFontWeights(parseFontChoice(font)),
  );
  const strokeWidth = read.number("StrokeWidth", 0, 0, 20);
  const shadowOn = read.option("Shadow", OFF_ON, "Off") === "On";
  return {
    text: read.string("Text") ?? DEFAULT_TEXT,
    font,
    weight,
    italic: flags.has("Italic"),
    underline: flags.has("Underline"),
    strikethrough: flags.has("Strikethrough"),
    allCaps: flags.has("AllCaps"),
    fontSize: read.number(
      "FontSize",
      DEFAULT_FONT_SIZE,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
    resizeToFit: read.option("ResizeToFit", OFF_ON, "Off") === "On",
    align: read
      .option("Align", TEXT_ALIGNS, "Center")
      .toLowerCase() as TextAlign,
    verticalAlign: read
      .option("VerticalAlign", TEXT_VERTICAL_ALIGNS, "Middle")
      .toLowerCase() as TextVerticalAlign,
    lineHeight: read.number("LineHeight", 1.2, 0.6, 3),
    letterSpacing: read.number("LetterSpacing", 0, -0.2, 1),
    paint: readTextPaint(read),
    stroke:
      strokeWidth > 0
        ? {
            color: readColor(read.string("Stroke"), DEFAULT_STROKE_COLOR),
            width: strokeWidth,
          }
        : undefined,
    shadow: shadowOn
      ? {
          color: readColor(read.string("ShadowColor"), DEFAULT_SHADOW_COLOR),
          blur: read.number("ShadowBlur", 8, 0, 50),
          offsetX: read.number("ShadowOffsetX", 4, -50, 50),
          offsetY: read.number("ShadowOffsetY", 4, -50, 50),
        }
      : undefined,
    padding: read.number("Padding", 0, 0, 200),
  };
}

/**
 * The style for text clips on layer `laneId`: the last enabled Text effect
 * on that layer's own stack, or the defaults when there is none.
 */
export function resolveTextStyle(
  effects: readonly FillEffect[],
  laneId: string,
): TextStyle {
  return readTextStyle(
    effects.findLast(
      (candidate) =>
        candidate.trackId === laneId &&
        candidate.enabled !== false &&
        isTextEffectName(candidate.effectName),
    ),
  );
}

/** The first line of the text, for the clip's timeline card. */
export function getTextPreview(style: Pick<TextStyle, "text" | "allCaps">) {
  const line = style.text.split("\n").find((candidate) => candidate.trim());
  const preview = line?.trim() ?? "";
  return style.allCaps ? preview.toUpperCase() : preview;
}
