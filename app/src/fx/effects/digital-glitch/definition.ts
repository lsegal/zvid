import { unitParameter } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 54;

function formatRate(value: number) {
  return `${Math.round(value)} /s`;
}

export const definition: FxEffectDefinition = {
  effectName: "DigitalGlitch",
  displayName: "Digital Glitch",
  description: "Adds blocky digital corruption and channel offsets.",
  accent: "#4fd1e8",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    unitParameter("_Amount", "Amount", 0.3),
    unitParameter("_BlockSize", "Block Size", 0.4),
    unitParameter("_Displace", "Displace", 0.5),
    unitParameter("_ChannelShift", "Channel Shift", 0.3),
    unitParameter("_ColorCrush", "Color Crush", 0),
    {
      kind: "number",
      key: "_Rate",
      label: "Rate",
      min: 1,
      max: 30,
      defaultValue: 8,
      step: 1,
      format: formatRate,
    },
  ],
};
