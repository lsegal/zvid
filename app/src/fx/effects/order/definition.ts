import { formatGridSize, formatPixels } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  DEFAULT_BORDER_COLOR,
  EXCLUDED_LAYERS_KEY,
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  ORDER_ARRANGEMENTS,
  ORDER_EFFECT_NAME,
  SPACING_MAX,
} from "./order.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 90;

export const definition: FxEffectDefinition = {
  effectName: ORDER_EFFECT_NAME,
  displayName: "Order",
  description:
    "Arranges the layers in stacked rows, side-by-side columns or a grid.",
  accent: "#b6e36b",
  known: true,
  // On an FX clip it arranges the layers beneath the clip.
  scopes: ["global", "fxClip"],
  parameters: [
    {
      kind: "enum",
      key: "Arrangement",
      label: "Order",
      options: ORDER_ARRANGEMENTS,
      defaultValue: "Vertical",
    },
    // Only exclusions are stored, so a new layer is arranged too.
    {
      kind: "layers",
      key: EXCLUDED_LAYERS_KEY,
      label: "Layers",
      defaultValue: "",
    },
    {
      kind: "number",
      key: "GridSize",
      label: "Grid Size",
      min: GRID_SIZE_MIN,
      max: GRID_SIZE_MAX,
      defaultValue: GRID_SIZE_MIN,
      step: 1,
      format: formatGridSize,
      visibleWhen: { key: "Arrangement", values: ["Grid"] },
    },
    {
      kind: "number",
      key: "Spacing",
      label: "Spacing",
      min: 0,
      max: SPACING_MAX,
      defaultValue: 0,
      step: 1,
      format: formatPixels,
    },
    {
      kind: "color",
      key: "BorderColor",
      label: "Border",
      defaultValue: DEFAULT_BORDER_COLOR,
      // Without spacing there are no gaps to color.
      dimmedWhen: { key: "Spacing", values: ["0"] },
    },
  ],
};
