import type { FxEffectDefinition } from "../../types.ts";
import {
  DEFAULT_DRUM_RACK_VALUE,
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
} from "./drum-rack.ts";

// MIDI effects list after the audio ones; the Drum Rack follows the Synth
// and the Granular, the other instruments.
export const menuOrder = 430;

export const definition: FxEffectDefinition = {
  effectName: DRUM_RACK_EFFECT_NAME,
  displayName: "Drum Rack",
  description:
    "Plays the clip's notes on 16 pads of drum samples, from a built-in bank or the media library.",
  accent: "#ff9a8a",
  category: "midi",
  domain: "midi",
  known: true,
  // Only a MIDI clip's own stack, as the Synth (see addableEffectsFor).
  scopes: ["clip"],
  parameters: [
    {
      kind: "drum-rack",
      key: DRUM_RACK_KEY,
      label: "Pads",
      defaultValue: DEFAULT_DRUM_RACK_VALUE,
    },
  ],
};
