import { formatHueDegrees } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 20;

export const definition: FxEffectDefinition = {
  effectName: "Colorize",
  displayName: "Colorize",
  description: "Shifts the hue of the layer.",
  accent: "#ff6f9d",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "number",
      key: "_HueOffset",
      label: "Hue Shift",
      min: -1,
      max: 1,
      defaultValue: 0,
      step: 0.01,
      format: formatHueDegrees,
    },
  ],
};
