import type { FxEffectDefinition } from "../../types.ts";
import { REVERSE_EFFECT_NAME } from "./reverse.ts";

export const menuOrder = 260;

export const definition: FxEffectDefinition = {
  effectName: REVERSE_EFFECT_NAME,
  displayName: "Reverse",
  description: "Plays the clip's audio backwards. Its video plays forwards.",
  accent: "#34d399",
  category: "utility",
  domain: "audio",
  known: true,
  // Clip stacks only, source clips included: reversing a track's bus or the
  // master as it plays isn't meaningful.
  scopes: ["clip"],
  parameters: [],
};
