import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { OPACITY_EFFECT_NAME, OPACITY_KEY } from "./opacity.ts";

// Where the effect sits in the add menus, lowest first: after Transform.
export const menuOrder = 72;

export const definition: FxEffectDefinition = {
  effectName: OPACITY_EFFECT_NAME,
  displayName: "Opacity",
  description: "Fades the layer or clip, or an FX clip's effects.",
  accent: "#b8c4d6",
  category: "transform",
  known: true,
  // On a clip it fades the clip inside its layer, which its layer's fades
  // in turn; on an FX clip it mixes the clip's effects over what is
  // beneath it.
  scopes: ["layer", "clip", "fxClip"],
  parameters: [unitParameter(OPACITY_KEY, "Opacity", 1)],
};
