import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 40;

export const definition: FxEffectDefinition = {
  effectName: "NegativeSplit",
  displayName: "Negative Split",
  description: "Inverts the brightness range between two intensities.",
  accent: "#c38fff",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_LowIntensity", "Low", 0),
    unitParameter("_HighIntensity", "High", 1),
  ],
};
