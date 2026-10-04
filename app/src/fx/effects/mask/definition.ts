import type { FxEffectDefinition } from "../../types.ts";
import {
  MASK_EFFECT_NAME,
  MASK_MODE_KEY,
  MASK_MODES,
  MASK_TARGET_KEY,
} from "./mask.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 95;

export const definition: FxEffectDefinition = {
  effectName: MASK_EFFECT_NAME,
  displayName: "Mask",
  description:
    "Shows the layer only where another layer draws, or cuts that layer's shape out of it. On an FX clip, limits where its effects apply.",
  accent: "#8fd3ff",
  category: "transform",
  known: true,
  scopes: ["layer", "clip", "fxClip"],
  parameters: [
    // One layer's id, or empty for no masking.
    {
      kind: "layer",
      key: MASK_TARGET_KEY,
      label: "Target",
      defaultValue: "",
    },
    {
      kind: "enum",
      key: MASK_MODE_KEY,
      label: "Mode",
      options: MASK_MODES,
      defaultValue: "Additive",
    },
  ],
};
