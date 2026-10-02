import { formatPercent } from "../../params.ts";
import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  BITCRUSH_EFFECT_NAME,
  BITCRUSH_RANGES,
  BITS_KEY,
  type BitcrushNumberKey,
  DOWNSAMPLE_KEY,
  formatBits,
  formatDownsample,
  MIX_KEY,
} from "./bitcrush.ts";

// In the Audio group of the add menus, in the order the audio effects were
// requested.
export const menuOrder = 280;

// A knob over the parameter's range. Downsample uses a log taper, so the
// small factors get as much travel as the large ones.
function knob(
  key: BitcrushNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = BITCRUSH_RANGES[key];
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
  effectName: BITCRUSH_EFFECT_NAME,
  displayName: "Bitcrush",
  description:
    "Lo-fi grit: reduces the sound's bit depth and holds samples to lower its sample rate.",
  accent: "#c084fc",
  category: "distortion",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(BITS_KEY, 1, formatBits),
    knob(DOWNSAMPLE_KEY, 1, formatDownsample, "log"),
    knob(MIX_KEY, 0.01, formatPercent),
  ],
};
