import type { FxEffectDefinition } from "../../types.ts";
import {
  formatGainDb,
  formatMute,
  GAIN_DEFAULT_DB,
  GAIN_EFFECT_NAME,
  GAIN_KEY,
  GAIN_MAX_DB,
  GAIN_MIN_DB,
  MUTE_KEY,
} from "./gain.ts";

// Where the effect sits in the add menus, lowest first. Audio effects list
// after the video ones, in their own group.
export const menuOrder = 200;

export const definition: FxEffectDefinition = {
  effectName: GAIN_EFFECT_NAME,
  displayName: "Gain",
  description:
    "Sets the volume in dB. The bottom of the fader, or Mute, silences it.",
  accent: "#4fd1c5",
  domain: "audio",
  known: true,
  // Track and clip stacks, source ones included, and Global as a master
  // gain. An FX clip has no sound of its own.
  scopes: ["layer", "clip", "global"],
  parameters: [
    {
      kind: "number",
      key: GAIN_KEY,
      label: "Gain",
      min: GAIN_MIN_DB,
      max: GAIN_MAX_DB,
      defaultValue: GAIN_DEFAULT_DB,
      step: 0.1,
      format: formatGainDb,
      control: "fader",
      ticks: [
        { value: GAIN_MAX_DB, label: "+10" },
        { value: 0, label: "0" },
        { value: GAIN_MIN_DB, label: "−∞" },
      ],
    },
    {
      kind: "number",
      key: MUTE_KEY,
      label: "Mute",
      min: 0,
      max: 1,
      defaultValue: 0,
      step: 1,
      format: formatMute,
      control: "toggle",
    },
  ],
};
