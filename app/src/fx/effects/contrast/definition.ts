import { formatRawNumber } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import {
  CONTRAST_DEFAULT,
  CONTRAST_DEFAULT_PIVOT,
  CONTRAST_MAX,
} from "./pass.ts";

// Where the effect sits in the add menus, lowest first: after Exposure (21).
export const menuOrder = 22;

export const definition: FxEffectDefinition = {
  effectName: "Contrast",
  displayName: "Contrast",
  description: "Pushes tones away from, or pulls them toward, a pivot gray.",
  accent: "#c9a4ff",
  category: "color",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    // 1 leaves the picture as it is; below 1 flattens it toward Pivot and
    // above 1 steepens it.
    {
      kind: "number",
      key: "_Contrast",
      label: "Contrast",
      min: 0,
      max: CONTRAST_MAX,
      defaultValue: CONTRAST_DEFAULT,
      step: 0.001,
      format: formatRawNumber,
    },
    // The gray level that stays fixed.
    {
      kind: "number",
      key: "_Pivot",
      label: "Pivot",
      min: 0,
      max: 1,
      defaultValue: CONTRAST_DEFAULT_PIVOT,
      step: 0.001,
      format: formatRawNumber,
    },
  ],
};
