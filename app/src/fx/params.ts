// Parameter builders and display formatters shared by the effect
// definitions in effects/*/definition.ts.

import type { FxNumberParameterDefinition } from "./types.ts";

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

// The stored 0..1 value of a zoom factor, rounded to the 0.01× knob step so
// defaults like 1.20× land exactly on a step.
export function zoomToUnit(zoom: number) {
  return Math.round((zoom - 1) * 100) / 300;
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

export function unitParameter(
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

// A zoom knob defaulting to `defaultZoom` (1x..4x), stepping 0.01× at a time.
export function zoomParameter(
  key: string,
  label: string,
  defaultZoom = 1,
): FxNumberParameterDefinition {
  return {
    ...unitParameter(key, label, zoomToUnit(defaultZoom)),
    step: 1 / 300,
    format: formatZoom,
  };
}

export function transformParameter(
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

// Transform's knobs with keys prefixed by `prefix` ("Start" or "End"), for
// one row of a Move.
export function moveParameters(prefix: string): FxNumberParameterDefinition[] {
  return [
    transformParameter(
      `${prefix}PositionX`,
      "X",
      -2,
      2,
      0,
      formatSignedPercent,
    ),
    transformParameter(
      `${prefix}PositionY`,
      "Y",
      -2,
      2,
      0,
      formatSignedPercent,
    ),
    transformParameter(`${prefix}ScaleX`, "Width", 0.05, 8, 1, formatPercent),
    transformParameter(`${prefix}ScaleY`, "Height", 0.05, 8, 1, formatPercent),
    transformParameter(
      `${prefix}OriginX`,
      "Origin X",
      -1,
      1,
      0,
      formatSignedPercent,
    ),
    transformParameter(
      `${prefix}OriginY`,
      "Origin Y",
      -1,
      1,
      0,
      formatSignedPercent,
    ),
    {
      ...transformParameter(
        `${prefix}Rotation`,
        "Rotation",
        -180,
        180,
        0,
        formatDegrees,
      ),
      step: 1,
    },
  ];
}
