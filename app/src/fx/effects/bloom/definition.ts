import { formatPercent, unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import { DEFAULT_BLOOM_TINT } from "./pass.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 55;

export const definition: FxEffectDefinition = {
  effectName: "Bloom",
  displayName: "Bloom",
  description: "Makes bright areas glow into their surroundings.",
  accent: "#ffe9a8",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_Threshold", "Threshold", 0.7),
    {
      kind: "number",
      key: "_Intensity",
      label: "Intensity",
      min: 0,
      max: 2,
      defaultValue: 0.6,
      step: 0.01,
      format: formatPercent,
    },
    unitParameter("_Radius", "Radius", 0.4),
    {
      kind: "color",
      key: "_Tint",
      label: "Tint",
      defaultValue: DEFAULT_BLOOM_TINT,
    },
  ],
};
