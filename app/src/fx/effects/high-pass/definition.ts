import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  DEFAULT_HIGH_PASS_SLOPE,
  FREQUENCY_KEY,
  formatFrequency,
  formatResonance,
  HIGH_PASS_EFFECT_NAME,
  HIGH_PASS_RANGES,
  HIGH_PASS_SLOPES,
  type HighPassNumberKey,
  RESONANCE_KEY,
  SLOPE_KEY,
} from "./high-pass.ts";

// In the Audio group of the add menus, among the other audio effects.
export const menuOrder = 290;

// A knob over the parameter's range. Frequency uses a log taper, so each
// octave takes the same travel.
function knob(
  key: HighPassNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = HIGH_PASS_RANGES[key];
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
  effectName: HIGH_PASS_EFFECT_NAME,
  displayName: "High Pass",
  description:
    "Removes low frequencies below the cutoff, at 12 or 24 dB per octave, with an optional resonant peak.",
  accent: "#60a5fa",
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
      options: HIGH_PASS_SLOPES,
      defaultValue: DEFAULT_HIGH_PASS_SLOPE,
    },
  ],
};
