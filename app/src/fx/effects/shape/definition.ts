import { formatPercent, formatPixels } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  DASH_KEY,
  DRAWN_KEY,
  GAP_KEY,
  OFFSET_KEY,
  SHAPE_EFFECT_NAME,
  SHAPE_KEY,
  STROKE_KEY,
} from "./shape.ts";
import { DEFAULT_SHAPE, SHAPES } from "./shapes/index.ts";

// Outlines are offered for the shapes that can measure their edge, not for
// Custom ones.
const outlined = {
  key: SHAPE_KEY,
  values: SHAPES.filter((shape) => shape.outline).map((shape) => shape.name),
};

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 75;

export const definition: FxEffectDefinition = {
  effectName: SHAPE_EFFECT_NAME,
  displayName: "Shape",
  description:
    "Draws the layer only inside a shape that fills the layer's box, or along its outline.",
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
    {
      kind: "number",
      key: STROKE_KEY,
      label: "Stroke",
      min: 0,
      max: 200,
      defaultValue: 0,
      step: 0.5,
      format: formatPixels,
      visibleWhen: outlined,
    },
    {
      kind: "number",
      key: DASH_KEY,
      label: "Dash",
      min: 0,
      max: 500,
      defaultValue: 0,
      step: 1,
      format: formatPixels,
      visibleWhen: outlined,
    },
    {
      kind: "number",
      key: GAP_KEY,
      label: "Gap",
      min: 0,
      max: 500,
      defaultValue: 20,
      step: 1,
      format: formatPixels,
      visibleWhen: outlined,
    },
    {
      kind: "number",
      key: OFFSET_KEY,
      label: "Offset",
      min: -1000,
      max: 1000,
      defaultValue: 0,
      step: 1,
      format: formatPixels,
      visibleWhen: outlined,
    },
    {
      kind: "number",
      key: DRAWN_KEY,
      label: "Drawn",
      min: 0,
      max: 1,
      defaultValue: 1,
      step: 0.01,
      format: formatPercent,
      visibleWhen: outlined,
    },
  ],
};
