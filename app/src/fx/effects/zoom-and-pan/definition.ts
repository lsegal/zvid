import { unitParameter, zoomParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 10;

export const definition: FxEffectDefinition = {
  effectName: "ZoomAndPan",
  displayName: "Zoom & Pan",
  description: "Zooms and pans the frame from a start to an end framing.",
  accent: "#7ca1ff",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    zoomParameter("_Start_Zoom", "Start Zoom"),
    unitParameter("_Start_X", "Start X", 0.5),
    unitParameter("_Start_Y", "Start Y", 0.5),
    zoomParameter("_End_Zoom", "End Zoom", 1.2),
    unitParameter("_End_X", "End X", 0.5),
    unitParameter("_End_Y", "End Y", 0.5),
    {
      ...unitParameter("_LAYERS_SelFrac", "Selection Fraction", 0),
      hidden: true,
    },
  ],
};
