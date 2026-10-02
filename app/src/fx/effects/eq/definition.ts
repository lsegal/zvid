import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  EQ_EFFECT_NAME,
  EQ_RANGES,
  type EqParameterKey,
  formatEqGain,
  formatFrequency,
  formatQ,
  HIGH_FREQ_KEY,
  HIGH_GAIN_KEY,
  LOW_FREQ_KEY,
  LOW_GAIN_KEY,
  MID_FREQ_KEY,
  MID_GAIN_KEY,
  MID_Q_KEY,
} from "./eq.ts";

// After Gain in the Audio group of the add menus.
export const menuOrder = 210;

// A knob over the parameter's range. Frequencies use a log taper, so each
// octave takes the same travel.
function knob(
  key: EqParameterKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = EQ_RANGES[key];
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
  effectName: EQ_EFFECT_NAME,
  displayName: "EQ",
  description:
    "A three-band equalizer: a low shelf, a mid peak and a high shelf.",
  accent: "#38bdf8",
  category: "eq",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(LOW_FREQ_KEY, 1, formatFrequency, "log"),
    knob(LOW_GAIN_KEY, 0.1, formatEqGain),
    knob(MID_FREQ_KEY, 1, formatFrequency, "log"),
    knob(MID_GAIN_KEY, 0.1, formatEqGain),
    knob(MID_Q_KEY, 0.01, formatQ),
    knob(HIGH_FREQ_KEY, 1, formatFrequency, "log"),
    knob(HIGH_GAIN_KEY, 0.1, formatEqGain),
  ],
};
