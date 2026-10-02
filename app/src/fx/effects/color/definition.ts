import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  COLOR_EFFECT_NAME,
  DEFAULT_FILL_GRADIENT,
  FILL_MODES,
  NEUTRAL_FILL_COLOR,
} from "./color.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 100;

export const definition: FxEffectDefinition = {
  effectName: COLOR_EFFECT_NAME,
  displayName: "Color",
  description: "Paints fill clips a solid color or a gradient.",
  accent: "#ffd166",
  category: "color",
  known: true,
  // A fill clip carries its own Color; one on the layer paints the layer's
  // fill clips that have none.
  scopes: ["layer", "clip"],
  parameters: [
    {
      kind: "enum",
      key: "Mode",
      label: "Type",
      options: FILL_MODES,
      defaultValue: "Solid",
    },
    {
      kind: "color",
      key: "Color",
      label: "Color",
      defaultValue: NEUTRAL_FILL_COLOR,
      visibleWhen: { key: "Mode", values: ["Solid"] },
    },
    {
      kind: "gradient",
      key: "Gradient",
      label: "Gradient",
      defaultValue: DEFAULT_FILL_GRADIENT,
      visibleWhen: { key: "Mode", values: ["Gradient"] },
    },
    unitParameter("Opacity", "Opacity", 1),
  ],
};
