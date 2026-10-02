import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  AMOUNT_DEFAULT,
  AMOUNT_KEY,
  MONO_EFFECT_NAME,
  MONO_SOURCES,
  SOURCE_KEY,
  SOURCE_SUM,
} from "./mono.ts";

// Between EQ and Stereo in the Audio group of the add menus.
export const menuOrder = 215;

export const definition: FxEffectDefinition = {
  effectName: MONO_EFFECT_NAME,
  displayName: "Mono",
  description:
    "Folds the sound to mono: the sum of both sides, or just the left or right.",
  accent: "#22d3ee",
  category: "volume",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    {
      kind: "enum",
      key: SOURCE_KEY,
      label: "Source",
      options: MONO_SOURCES,
      defaultValue: SOURCE_SUM,
    },
    {
      kind: "number",
      key: AMOUNT_KEY,
      label: "Amount",
      min: 0,
      max: 1,
      defaultValue: AMOUNT_DEFAULT,
      step: 0.01,
      format: formatPercent,
    },
  ],
};
