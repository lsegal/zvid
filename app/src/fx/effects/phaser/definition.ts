import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  CENTER_KEY,
  DEPTH_KEY,
  FEEDBACK_KEY,
  formatFrequency,
  formatPercent,
  formatRate,
  MIX_KEY,
  PHASER_EFFECT_NAME,
  PHASER_RANGES,
  type PhaserNumberKey,
  RATE_KEY,
  STAGE_OPTIONS,
  STAGES_DEFAULT,
  STAGES_KEY,
} from "./phaser.ts";

// In the Audio group of the add menus, in the order the audio effects were
// requested.
export const menuOrder = 360;

// A knob over the parameter's range. Rate and Center use a log taper, so
// each octave takes the same travel.
function knob(
  key: PhaserNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = PHASER_RANGES[key];
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
  effectName: PHASER_EFFECT_NAME,
  displayName: "Phaser",
  description:
    "Sweeping notches from a chain of all-pass filters an LFO modulates.",
  accent: "#818cf8",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(RATE_KEY, 0.01, formatRate, "log"),
    knob(DEPTH_KEY, 1, formatPercent),
    {
      kind: "enum",
      key: STAGES_KEY,
      label: STAGES_KEY,
      options: STAGE_OPTIONS,
      defaultValue: STAGES_DEFAULT,
    },
    knob(CENTER_KEY, 1, formatFrequency, "log"),
    knob(FEEDBACK_KEY, 1, formatPercent),
    knob(MIX_KEY, 1, formatPercent),
  ],
};
