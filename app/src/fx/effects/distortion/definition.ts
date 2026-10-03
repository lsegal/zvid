import {
  formatDegrees,
  formatSignedPercent,
  transformParameter,
  unitParameter,
} from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 51;

export const DISTORTION_TYPES = [
  "Wave",
  "Ripple",
  "Twirl",
  "Bulge",
  "Fisheye",
  "Turbulence",
] as const;

export const DISTORTION_EDGES = ["Clamp", "Mirror", "Transparent"] as const;

// The types that distort around a center point.
const CENTERED_TYPES = ["Ripple", "Twirl", "Bulge", "Fisheye"];

export const definition: FxEffectDefinition = {
  effectName: "Distortion",
  displayName: "Distortion",
  description: "Warps the layer with waves, ripples, twirls and bulges.",
  accent: "#ff8a4c",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "enum",
      key: "_Type",
      label: "Type",
      options: DISTORTION_TYPES,
      menu: true,
      defaultValue: "Wave",
    },
    {
      kind: "enum",
      key: "_Edges",
      label: "Edges",
      options: DISTORTION_EDGES,
      defaultValue: "Clamp",
    },
    transformParameter("_Amount", "Amount", -1, 1, 0.3, formatSignedPercent),
    unitParameter("_Size", "Size", 0.5),
    unitParameter("_Speed", "Speed", 0),
    {
      ...transformParameter("_Angle", "Angle", 0, 360, 0, formatDegrees),
      step: 1,
      visibleWhen: { key: "_Type", values: ["Wave"] },
    },
    {
      ...unitParameter("_CenterX", "Center X", 0.5),
      visibleWhen: { key: "_Type", values: CENTERED_TYPES },
    },
    {
      ...unitParameter("_CenterY", "Center Y", 0.5),
      visibleWhen: { key: "_Type", values: CENTERED_TYPES },
    },
  ],
};
