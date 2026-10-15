import { formatDegrees, formatPixels } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import {
  MOTION_BLUR_DEFAULT_DISTANCE,
  MOTION_BLUR_MAX_DISTANCE,
} from "./pass.ts";

// Where the effect sits in the add menus, lowest first: beside Gaussian
// Blur.
export const menuOrder = 57;

export const definition: FxEffectDefinition = {
  effectName: "MotionBlur",
  displayName: "Motion Blur",
  description: "Smears the picture along one direction, as if it were moving.",
  accent: "#c4c8ff",
  category: "blur",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    // The direction of the smear: 0° is horizontal, 90° vertical. It runs
    // both ways, so 180° is 0° again.
    {
      kind: "number",
      key: "_Angle",
      label: "Angle",
      min: 0,
      max: 180,
      defaultValue: 0,
      step: 1,
      format: formatDegrees,
    },
    // The smear's full length in output pixels at 1080p, scaled to the
    // output size like Gaussian Blur's Radius.
    {
      kind: "number",
      key: "_Distance",
      label: "Distance",
      min: 0,
      max: MOTION_BLUR_MAX_DISTANCE,
      defaultValue: MOTION_BLUR_DEFAULT_DISTANCE,
      step: 1,
      format: formatPixels,
    },
  ],
};
