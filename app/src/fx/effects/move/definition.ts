import { moveParameters } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { DEFAULT_MOTION_CURVE, MOTION_CURVES } from "./motion-easing.ts";
import { MOVE_EFFECT_NAME } from "./move.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 80;

export const definition: FxEffectDefinition = {
  effectName: MOVE_EFFECT_NAME,
  displayName: "Move",
  description:
    "Moves, resizes and rotates each clip from a start to an end placement over its duration.",
  accent: "#ff7f8f",
  known: true,
  // On a layer it runs over each of the layer's clips in turn, and on an
  // FX clip it moves the box the FX clip adjusts.
  scopes: ["layer", "clip", "fxClip"],
  knobRows: ["Start", "End"],
  parameters: [
    {
      kind: "enum",
      key: "Motion",
      label: "Motion",
      options: MOTION_CURVES,
      defaultValue: DEFAULT_MOTION_CURVE,
    },
    ...moveParameters("Start"),
    ...moveParameters("End"),
  ],
};
