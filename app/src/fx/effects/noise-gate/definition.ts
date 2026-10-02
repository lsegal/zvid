import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
  FxNumberTaper,
} from "../../types.ts";
import {
  ATTACK_KEY,
  formatDb,
  formatMilliseconds,
  HOLD_KEY,
  NOISE_GATE_EFFECT_NAME,
  NOISE_GATE_RANGES,
  type NoiseGateNumberKey,
  RANGE_KEY,
  RELEASE_KEY,
  THRESHOLD_KEY,
} from "./noise-gate.ts";

// In the Audio group of the add menus, in the order the audio effects were
// requested.
export const menuOrder = 310;

// A knob over the parameter's range. Attack and Release use a log taper, so
// short times get as much travel as long ones.
function knob(
  key: NoiseGateNumberKey,
  step: number,
  format: (value: number) => string,
  taper: FxNumberTaper = "linear",
): FxNumberParameterDefinition {
  const range = NOISE_GATE_RANGES[key];
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
  effectName: NOISE_GATE_EFFECT_NAME,
  displayName: "Noise Gate",
  description: "Silences the sound while it stays below a threshold.",
  accent: "#34d399",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    knob(THRESHOLD_KEY, 0.1, formatDb),
    knob(ATTACK_KEY, 0.1, formatMilliseconds, "log"),
    knob(HOLD_KEY, 1, formatMilliseconds),
    knob(RELEASE_KEY, 1, formatMilliseconds, "log"),
    knob(RANGE_KEY, 0.1, formatDb),
  ],
};
