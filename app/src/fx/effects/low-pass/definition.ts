import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  DEFAULT_LOW_PASS_SLOPE,
  FREQUENCY_KEY,
  formatFrequency,
  formatResonance,
  LOW_PASS_EFFECT_NAME,
  LOW_PASS_RANGES,
  LOW_PASS_SLOPES,
  type LowPassNumberKey,
  RESONANCE_KEY,
  SLOPE_KEY,
} from "./low-pass.ts";

// In the Audio group of the add menus, among the other audio effects.
export const menuOrder = 300;

// A knob over the parameter's range. Frequency uses a log taper, so each
// octave takes the same travel.
function knob(
  key: LowPassNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = LOW_PASS_RANGES[key];
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
  effectName: LOW_PASS_EFFECT_NAME,
  displayName: "Low Pass",
  description:
    "Removes high frequencies above the cutoff, at 12 or 24 dB per octave, with an optional resonant peak.",
  accent: "#3b82f6",
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
      options: LOW_PASS_SLOPES,
      defaultValue: DEFAULT_LOW_PASS_SLOPE,
    },
  ],
};
