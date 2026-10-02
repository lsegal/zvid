import { formatPercent } from "../../params.ts";
import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  ATTACK_KEY,
  COMPRESSOR_EFFECT_NAME,
  COMPRESSOR_RANGES,
  type CompressorParameterKey,
  formatDb,
  formatMakeupDb,
  formatMs,
  formatRatio,
  KNEE_KEY,
  MAKEUP_KEY,
  MIX_KEY,
  RATIO_KEY,
  RELEASE_KEY,
  THRESHOLD_KEY,
} from "./compressor.ts";

// In the Audio group of the add menus, after Gain, EQ, Stereo and Chorus.
export const menuOrder = 330;

// A knob over the parameter's range. Ratio and times use a log taper, so
// each doubling takes the same travel.
function knob(
  key: CompressorParameterKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = COMPRESSOR_RANGES[key];
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
  effectName: COMPRESSOR_EFFECT_NAME,
  displayName: "Compressor",
  description:
    "Evens out the dynamics: turns down what rises above the threshold by the ratio.",
  accent: "#e879f9",
  category: "dynamics",
  domain: "audio",
  known: true,
  // The same stacks as Gain: tracks, clips (source ones included) and
  // Global as the master.
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(THRESHOLD_KEY, 0.1, formatDb),
    knob(RATIO_KEY, 0.1, formatRatio, "log"),
    knob(ATTACK_KEY, 0.01, formatMs, "log"),
    knob(RELEASE_KEY, 1, formatMs, "log"),
    knob(KNEE_KEY, 0.1, formatDb),
    knob(MAKEUP_KEY, 0.1, formatMakeupDb),
    knob(MIX_KEY, 0.01, formatPercent),
  ],
};
