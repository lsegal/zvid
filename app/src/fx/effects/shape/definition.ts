import type { FxEffectDefinition } from "../../types.ts";
import { SHAPE_EFFECT_NAME, SHAPE_KEY } from "./shape.ts";
import { DEFAULT_SHAPE } from "./shapes/index.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 75;

export const definition: FxEffectDefinition = {
  effectName: SHAPE_EFFECT_NAME,
  displayName: "Shape",
  description:
    "Draws the layer only inside a shape that fills the layer's box.",
  accent: "#f4a7ff",
  category: "transform",
  known: true,
  scopes: ["layer", "clip"],
  parameters: [
    {
      kind: "shape",
      key: SHAPE_KEY,
      label: "Shape",
      defaultValue: DEFAULT_SHAPE.name,
    },
  ],
};
