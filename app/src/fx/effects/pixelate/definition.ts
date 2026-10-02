import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 30;

export const definition: FxEffectDefinition = {
  effectName: "Pixelate",
  displayName: "Pixelate",
  description: "Reduces the layer to large pixels.",
  accent: "#7ee0a4",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_NumPixels", "Pixel Size", 0.5),
    // Low and High only scaled the pulse audio hits used to add. The music
    // moves Pixel Size through the Animation modifier's Reactive mode now, so
    // they are hidden and kept only so saved values round-trip.
    { ...unitParameter("_LowIntensity", "Low", 0), hidden: true },
    { ...unitParameter("_HighIntensity", "High", 1), hidden: true },
  ],
};
