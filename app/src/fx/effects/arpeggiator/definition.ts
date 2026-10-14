import { DEFAULT_ARPEGGIATOR } from "../../../note-generators.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  ARPEGGIATOR_EFFECT_NAME,
  MAX_OCTAVES,
  OCTAVES_KEY,
  PATTERN_KEY,
  PATTERN_OPTIONS,
  patternOption,
  RATE_KEY,
  RATE_OPTIONS,
  rateOption,
} from "./arpeggiator.ts";

// MIDI effects list after the audio ones, the Arpeggiator ahead of the
// Synth it feeds.
export const menuOrder = 400;

export const definition: FxEffectDefinition = {
  effectName: ARPEGGIATOR_EFFECT_NAME,
  displayName: "Arpeggiator",
  description:
    "Plays held chords one note at a time on the beat, walking them up, down or at random.",
  accent: "#c7a6ff",
  category: "midi",
  domain: "midi",
  known: true,
  // Only a MIDI clip's own stack, which the add menus tell apart from other
  // clips' (see addableEffectsFor).
  scopes: ["clip"],
  parameters: [
    {
      kind: "enum",
      key: RATE_KEY,
      label: "Rate",
      options: RATE_OPTIONS,
      defaultValue: rateOption(DEFAULT_ARPEGGIATOR.rate),
    },
    {
      kind: "enum",
      key: PATTERN_KEY,
      label: "Pattern",
      options: PATTERN_OPTIONS,
      defaultValue: patternOption(DEFAULT_ARPEGGIATOR.pattern),
    },
    {
      kind: "number",
      key: OCTAVES_KEY,
      label: "Octaves",
      min: 1,
      max: MAX_OCTAVES,
      defaultValue: DEFAULT_ARPEGGIATOR.octaves,
      step: 1,
      format: (value) => `${Math.round(value)}`,
    },
  ],
};
