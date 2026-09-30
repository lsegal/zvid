import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 30;

export const definition: FxEffectDefinition = {
  effectName: "Pixelate",
  displayName: "Pixelate",
  description: "Reduces the layer to large pixels between two intensities.",
  accent: "#7ee0a4",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_NumPixels", "Pixel Size", 0.5),
    unitParameter("_LowIntensity", "Low", 0),
    unitParameter("_HighIntensity", "High", 1),
  ],
};
