import type { FxEffectDefinition } from "../../types.ts";
import {
  ATTACK_KEY,
  formatOutputDb,
  formatShapePercent,
  OUTPUT_DEFAULT_DB,
  OUTPUT_KEY,
  OUTPUT_MAX_DB,
  OUTPUT_MIN_DB,
  SHAPE_DEFAULT,
  SHAPE_MAX,
  SHAPE_MIN,
  SUSTAIN_KEY,
  TRANSIENT_SHAPER_EFFECT_NAME,
} from "./transient-shaper.ts";

// Last of the audio effects in the Audio group of the add menus.
export const menuOrder = 390;

export const definition: FxEffectDefinition = {
  effectName: TRANSIENT_SHAPER_EFFECT_NAME,
  displayName: "Transient Shaper",
  description:
    "Boosts or softens the attack of each hit and raises or lowers its sustain, whatever the level.",
  accent: "#e879f9",
  category: "dynamics",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    {
      kind: "number",
      key: ATTACK_KEY,
      label: "Attack",
      min: SHAPE_MIN,
      max: SHAPE_MAX,
      defaultValue: SHAPE_DEFAULT,
      step: 0.01,
      format: formatShapePercent,
    },
    {
      kind: "number",
      key: SUSTAIN_KEY,
      label: "Sustain",
      min: SHAPE_MIN,
      max: SHAPE_MAX,
      defaultValue: SHAPE_DEFAULT,
      step: 0.01,
      format: formatShapePercent,
    },
    {
      kind: "number",
      key: OUTPUT_KEY,
      label: "Output",
      min: OUTPUT_MIN_DB,
      max: OUTPUT_MAX_DB,
      defaultValue: OUTPUT_DEFAULT_DB,
      step: 0.1,
      format: formatOutputDb,
    },
  ],
};
