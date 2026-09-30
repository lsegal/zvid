import type { FxEffectDefinition } from "../../types.ts";

// Positions `parseLayoutAnchor` in CompositionPlayer.tsx understands.
export const LAYOUT_POSITIONS = ["Center", "Top", "Bottom"] as const;

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 60;

export const definition: FxEffectDefinition = {
  effectName: "Layout",
  displayName: "Layout",
  description: "Anchors the frame inside the canvas.",
  accent: "#5fd3e6",
  known: true,
  scopes: ["layer"],
  layerDefault: true,
  parameters: [
    {
      kind: "enum",
      key: "Position",
      label: "Position",
      options: LAYOUT_POSITIONS,
      defaultValue: "Center",
    },
  ],
};
