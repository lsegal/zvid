import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import { INTENSITY_KEY, LUT_EFFECT_NAME, LUT_KEY, NO_LUT } from "./lut.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 25;

export const definition: FxEffectDefinition = {
  effectName: LUT_EFFECT_NAME,
  displayName: "LUT",
  description:
    "Color-grades the layer through a 3D lookup table, bundled or imported as a .cube file.",
  accent: "#ffb86b",
  category: "color",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "lut",
      key: LUT_KEY,
      label: "LUT",
      defaultValue: NO_LUT,
    },
    {
      kind: "number",
      key: INTENSITY_KEY,
      label: "Intensity",
      min: 0,
      max: 1,
      defaultValue: 1,
      step: 0.01,
      format: formatPercent,
    },
  ],
};
