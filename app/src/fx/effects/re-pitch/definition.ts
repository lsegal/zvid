import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  ALGORITHM_DEFAULT,
  ALGORITHM_FORMANTS,
  ALGORITHM_KEY,
  ALGORITHM_OPTIONS,
  ALGORITHM_TRANSIENTS,
  CENTS_KEY,
  CENTS_MAX,
  CENTS_MIN,
  FORMANTS_DEFAULT,
  FORMANTS_KEY,
  formatCents,
  formatSemitones,
  RE_PITCH_EFFECT_NAME,
  SEMITONES_KEY,
  SEMITONES_MAX,
  SEMITONES_MIN,
  TRANSIENTS_DEFAULT,
  TRANSIENTS_KEY,
} from "./re-pitch.ts";

// After Reverse in the Utility group of the add menus.
export const menuOrder = 265;

export const definition: FxEffectDefinition = {
  effectName: RE_PITCH_EFFECT_NAME,
  displayName: "Re-Pitch",
  description:
    "Shifts the pitch of the clip's audio: like a tape, by speeding it up or slowing it down, or keeping its timing while preserving its transients or formants. Its video plays as it was.",
  accent: "#fbbf24",
  category: "utility",
  domain: "audio",
  known: true,
  // Clip stacks only, source clips included, as with Reverse: a track's bus
  // or the master plays as it arrives, so it can't be read faster.
  scopes: ["clip"],
  parameters: [
    {
      kind: "enum",
      key: ALGORITHM_KEY,
      label: "Algorithm",
      options: ALGORITHM_OPTIONS,
      defaultValue: ALGORITHM_DEFAULT,
    },
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
    {
      kind: "number",
      key: TRANSIENTS_KEY,
      label: "Transients",
      min: 0,
      max: 1,
      defaultValue: TRANSIENTS_DEFAULT,
      step: 0.01,
      format: formatPercent,
      visibleWhen: { key: ALGORITHM_KEY, values: [ALGORITHM_TRANSIENTS] },
    },
    {
      kind: "number",
      key: FORMANTS_KEY,
      label: "Formants",
      min: 0,
      max: 1,
      defaultValue: FORMANTS_DEFAULT,
      step: 0.01,
      format: formatPercent,
      visibleWhen: { key: ALGORITHM_KEY, values: [ALGORITHM_FORMANTS] },
    },
  ],
};
