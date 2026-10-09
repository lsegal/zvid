import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first: right after
// Colorize.
export const menuOrder = 21;

export const EXPOSURE_MAX_STOPS = 4;

// Stops with a sign and one decimal, like "+1.0 EV".
export function formatStops(value: number) {
  const stops = Number(value.toFixed(1));
  return `${stops > 0 ? "+" : ""}${stops.toFixed(1)} EV`;
}

export const definition: FxEffectDefinition = {
  effectName: "Exposure",
  displayName: "Exposure",
  description: "Brightens or darkens the layer in photographic stops.",
  accent: "#ffc857",
  category: "color",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "number",
      key: "_Stops",
      label: "Exposure",
      min: -EXPOSURE_MAX_STOPS,
      max: EXPOSURE_MAX_STOPS,
      defaultValue: 0,
      step: 0.1,
      format: formatStops,
    },
  ],
};
