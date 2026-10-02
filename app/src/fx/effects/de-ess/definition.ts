import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  AMOUNT_KEY,
  DE_ESS_EFFECT_NAME,
  DE_ESS_RANGES,
  type DeEssNumberKey,
  FREQUENCY_KEY,
  formatAmountDb,
  formatFrequency,
  formatThresholdDb,
  LISTEN_DEFAULT,
  LISTEN_KEY,
  LISTEN_OPTIONS,
  THRESHOLD_KEY,
} from "./de-ess.ts";

// In the Audio group of the add menus, among the other audio effects.
export const menuOrder = 320;

function knob(
  key: DeEssNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = DE_ESS_RANGES[key];
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
  effectName: DE_ESS_EFFECT_NAME,
  displayName: "De-ess",
  description:
    "Tames harsh sibilance: turns down the high band while the band around Frequency is louder than Threshold.",
  accent: "#4ade80",
  category: "dynamics",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(FREQUENCY_KEY, 1, formatFrequency, "log"),
    knob(THRESHOLD_KEY, 0.1, formatThresholdDb),
    knob(AMOUNT_KEY, 0.1, formatAmountDb),
    {
      kind: "enum",
      key: LISTEN_KEY,
      label: LISTEN_KEY,
      options: LISTEN_OPTIONS,
      defaultValue: LISTEN_DEFAULT,
    },
  ],
};
