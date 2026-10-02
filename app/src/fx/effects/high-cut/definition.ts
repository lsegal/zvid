import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  DEFAULT_HIGH_CUT_SLOPE,
  FREQUENCY_KEY,
  formatFrequency,
  formatResonance,
  HIGH_CUT_EFFECT_NAME,
  HIGH_CUT_RANGES,
  HIGH_CUT_SLOPES,
  type HighCutNumberKey,
  RESONANCE_KEY,
  SLOPE_KEY,
} from "./high-cut.ts";

// In the Audio group of the add menus, among the other audio effects.
export const menuOrder = 300;

// A knob over the parameter's range. Frequency uses a log taper, so each
// octave takes the same travel.
function knob(
  key: HighCutNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = HIGH_CUT_RANGES[key];
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
  effectName: HIGH_CUT_EFFECT_NAME,
  displayName: "High Cut",
  description:
    "Removes high frequencies above the cutoff, at 12 or 24 dB per octave, with an optional resonant peak.",
  accent: "#3b82f6",
  category: "eq",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(FREQUENCY_KEY, 1, formatFrequency, "log"),
    knob(RESONANCE_KEY, 0.01, formatResonance),
    {
      kind: "enum",
      key: SLOPE_KEY,
      label: SLOPE_KEY,
      options: HIGH_CUT_SLOPES,
      defaultValue: DEFAULT_HIGH_CUT_SLOPE,
    },
  ],
};
