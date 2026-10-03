import { formatDegrees, unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// The surfaces Refraction looks through, in the order the pass numbers them.
export const REFRACTION_TYPES = [
  "Water",
  "Frosted Glass",
  "Reeded Glass",
  "Glass Blocks",
] as const;

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 53;

export const definition: FxEffectDefinition = {
  effectName: "Refraction",
  displayName: "Refraction",
  description: "Shows the layer through water or textured glass.",
  accent: "#9ad7f5",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "enum",
      key: "_Type",
      label: "Type",
      options: REFRACTION_TYPES,
      menu: true,
      defaultValue: "Water",
    },
    unitParameter("_Amount", "Amount", 0.3),
    unitParameter("_Scale", "Scale", 0.5),
    {
      ...unitParameter("_Speed", "Speed", 0.2),
      visibleWhen: { key: "_Type", values: ["Water"] },
    },
    {
      kind: "number",
      key: "_Angle",
      label: "Angle",
      min: 0,
      max: 180,
      defaultValue: 90,
      step: 1,
      format: formatDegrees,
      visibleWhen: { key: "_Type", values: ["Reeded Glass"] },
    },
    unitParameter("_Dispersion", "Dispersion", 0),
  ],
};
