import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import { CAUSTICS_BLENDS, DEFAULT_CAUSTICS_COLOR } from "./pass.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 52;

export const definition: FxEffectDefinition = {
  effectName: "Caustics",
  displayName: "Caustics",
  description: "Plays animated underwater light over the layer.",
  accent: "#4fd6e8",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_Intensity", "Intensity", 0.5),
    unitParameter("_Scale", "Scale", 0.5),
    unitParameter("_Speed", "Speed", 0.3),
    unitParameter("_Warp", "Warp", 0.1),
    {
      kind: "color",
      key: "_Color",
      label: "Color",
      defaultValue: DEFAULT_CAUSTICS_COLOR,
    },
    {
      kind: "enum",
      key: "_Blend",
      label: "Blend",
      options: CAUSTICS_BLENDS,
      defaultValue: "Screen",
    },
  ],
};
