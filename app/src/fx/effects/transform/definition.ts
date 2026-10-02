import {
  formatDegrees,
  formatPercent,
  formatSignedPercent,
  transformParameter,
} from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 70;

export const definition: FxEffectDefinition = {
  effectName: "Transform",
  displayName: "Transform",
  description: "Moves, resizes and rotates the layer inside the canvas.",
  accent: "#ff9f6b",
  category: "transform",
  known: true,
  // On a clip it places the clip inside its layer's transformed box, and
  // on an FX clip it moves the box the FX clip adjusts.
  scopes: ["layer", "clip", "fxClip"],
  parameters: [
    transformParameter("PositionX", "X", -2, 2, 0, formatSignedPercent),
    transformParameter("PositionY", "Y", -2, 2, 0, formatSignedPercent),
    transformParameter("ScaleX", "Width", 0.05, 8, 1, formatPercent),
    transformParameter("ScaleY", "Height", 0.05, 8, 1, formatPercent),
    transformParameter("OriginX", "Origin X", -1, 1, 0, formatSignedPercent),
    transformParameter("OriginY", "Origin Y", -1, 1, 0, formatSignedPercent),
    {
      ...transformParameter(
        "Rotation",
        "Rotation",
        -180,
        180,
        0,
        formatDegrees,
      ),
      step: 1,
    },
  ],
};
