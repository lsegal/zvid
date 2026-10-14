import type { FxEffectDefinition } from "../../types.ts";
import {
  DEFAULT_INTERPOLATION,
  DEFAULT_SPEED,
  INTERPOLATION_KEY,
  MAX_SPEED,
  MIN_SPEED,
  RETIME_EFFECT_NAME,
  RETIME_INTERPOLATIONS,
  SPEED_KEY,
  SPEED_STEP,
} from "./retime.ts";

// Where the effect sits in the add menus, lowest first: after Transition.
export const menuOrder = 97;

export const definition: FxEffectDefinition = {
  effectName: RETIME_EFFECT_NAME,
  displayName: "Retime",
  description:
    "Plays the clip's video, GIF or Lottie faster, slower, frozen or backwards. Its audio keeps its timing.",
  accent: "#f0a35e",
  category: "transform",
  known: true,
  // Clip stacks only: it changes which frame of the clip's own media is
  // drawn, which a layer, Global or FX clip has none of.
  scopes: ["clip"],
  parameters: [
    // Negative plays backwards; 0 freezes the clip's first frame.
    {
      kind: "number",
      key: SPEED_KEY,
      label: "Speed",
      min: MIN_SPEED,
      max: MAX_SPEED,
      defaultValue: DEFAULT_SPEED,
      step: SPEED_STEP,
      format: (value) => `${value.toFixed(1)}×`,
    },
    {
      kind: "enum",
      key: INTERPOLATION_KEY,
      label: "Interpolation",
      options: RETIME_INTERPOLATIONS,
      defaultValue: DEFAULT_INTERPOLATION,
    },
  ],
};
