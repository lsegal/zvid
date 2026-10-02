import type { FxEffectDefinition } from "../../types.ts";
import {
  formatPan,
  formatWidth,
  PAN_DEFAULT,
  PAN_KEY,
  PAN_MAX,
  PAN_MIN,
  STEREO_EFFECT_NAME,
  WIDTH_DEFAULT,
  WIDTH_KEY,
  WIDTH_MAX,
  WIDTH_MIN,
} from "./stereo.ts";

// Lists in the Audio group, after Gain.
export const menuOrder = 210;

export const definition: FxEffectDefinition = {
  effectName: STEREO_EFFECT_NAME,
  displayName: "Stereo",
  description:
    "Sets the stereo width, from mono through doubled side, and the left/right balance.",
  accent: "#a78bfa",
  domain: "audio",
  known: true,
  // The same stacks as Gain: tracks, clips (source ones included) and
  // Global as the master.
  scopes: ["layer", "clip", "global"],
  parameters: [
    {
      kind: "number",
      key: WIDTH_KEY,
      label: "Width",
      min: WIDTH_MIN,
      max: WIDTH_MAX,
      defaultValue: WIDTH_DEFAULT,
      step: 1,
      format: formatWidth,
    },
    {
      kind: "number",
      key: PAN_KEY,
      label: "Pan",
      min: PAN_MIN,
      max: PAN_MAX,
      defaultValue: PAN_DEFAULT,
      step: 1,
      format: formatPan,
    },
  ],
};
