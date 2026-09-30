import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 50;

export const definition: FxEffectDefinition = {
  effectName: "AnalogGlitch",
  displayName: "Analog Glitch",
  description: "Adds analog tape jitter and colour bleed.",
  accent: "#f6b73c",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_LowMod", "Low", 0),
    unitParameter("_HighMod", "High", 0.5),
  ],
};
