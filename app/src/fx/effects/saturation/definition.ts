import { formatPercent } from "../../params.ts";
import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  DEFAULT_SATURATION_TYPE,
  DRIVE_KEY,
  formatDrive,
  formatSaturationDb,
  formatTone,
  MIX_KEY,
  OUTPUT_KEY,
  SATURATION_EFFECT_NAME,
  SATURATION_RANGES,
  SATURATION_TYPES,
  type SaturationNumberKey,
  TONE_KEY,
  TYPE_KEY,
} from "./saturation.ts";

// In the Audio group of the add menus, among the other audio effects.
export const menuOrder = 370;

function knob(
  key: SaturationNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = SATURATION_RANGES[key];
  return {
    kind: "number",
    key,
    label: key,
    min: range.min,
    max: range.max,
    defaultValue: range.defaultValue,
    step,
    format,
    taper,
  };
}

export const definition: FxEffectDefinition = {
  effectName: SATURATION_EFFECT_NAME,
  displayName: "Saturation",
  description:
    "Warm harmonic distortion: drives the sound into a Soft, Hard, Tape or Tube curve, then darkens it with Tone.",
  accent: "#fb923c",
  category: "distortion",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(DRIVE_KEY, 0.1, formatDrive),
    {
      kind: "enum",
      key: TYPE_KEY,
      label: TYPE_KEY,
      options: SATURATION_TYPES,
      defaultValue: DEFAULT_SATURATION_TYPE,
    },
    knob(TONE_KEY, 1, formatTone, "log"),
    knob(OUTPUT_KEY, 0.1, formatSaturationDb),
    knob(MIX_KEY, 0.01, formatPercent),
  ],
};
