import type { FxEffectDefinition } from "../../types.ts";
import {
  CENTS_KEY,
  CENTS_MAX,
  CENTS_MIN,
  formatCents,
  formatSemitones,
  RE_PITCH_EFFECT_NAME,
  SEMITONES_KEY,
  SEMITONES_MAX,
  SEMITONES_MIN,
} from "./re-pitch.ts";

// After Reverse in the Utility group of the add menus.
export const menuOrder = 265;

export const definition: FxEffectDefinition = {
  effectName: RE_PITCH_EFFECT_NAME,
  displayName: "Re-Pitch",
  description:
    "Shifts the pitch by speeding the clip's audio up or slowing it down, like a tape. Its video plays as it was.",
  accent: "#fbbf24",
  category: "utility",
  domain: "audio",
  known: true,
  // Clip stacks only, source clips included, as with Reverse: a track's bus
  // or the master plays as it arrives, so it can't be read faster.
  scopes: ["clip"],
  parameters: [
    {
      kind: "number",
      key: SEMITONES_KEY,
      label: "Semitones",
      min: SEMITONES_MIN,
      max: SEMITONES_MAX,
      defaultValue: 0,
      step: 1,
      format: formatSemitones,
    },
    {
      kind: "number",
      key: CENTS_KEY,
      label: "Cents",
      min: CENTS_MIN,
      max: CENTS_MAX,
      defaultValue: 0,
      step: 1,
      format: formatCents,
    },
  ],
};
