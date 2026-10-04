import { formatPixels } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import { GAUSSIAN_BLUR_DEFAULT_RADIUS, GAUSSIAN_BLUR_MAX_RADIUS } from "./pass.ts";

// Where the effect sits in the add menus, lowest first: beside Bloom.
export const menuOrder = 56;

export const definition: FxEffectDefinition = {
  effectName: "GaussianBlur",
  displayName: "Gaussian Blur",
  description: "Softens the picture with a smooth blur.",
  accent: "#b8d4ff",
  category: "stylize",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    // Output pixels at 1080p, scaled to the output size like Order's
    // Spacing.
    {
      kind: "number",
      key: "_Radius",
      label: "Radius",
      min: 0,
      max: GAUSSIAN_BLUR_MAX_RADIUS,
      defaultValue: GAUSSIAN_BLUR_DEFAULT_RADIUS,
      step: 1,
      format: formatPixels,
    },
  ],
};
