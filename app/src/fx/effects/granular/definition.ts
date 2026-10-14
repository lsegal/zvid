import {
  DEFAULT_GRANULAR_PARAMS,
  GRANULAR_PARAM_RANGES,
  type GranularParams,
} from "../../../midi-clip.ts";
import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  formatHertz,
  formatSeconds,
  MIN_RESONANCE,
  MIN_TIME_SECONDS,
} from "../synth/synth.ts";
import {
  formatDensity,
  formatSemitones,
  GRANULAR_EFFECT_NAME,
  GRANULAR_KEYS,
} from "./granular.ts";

// MIDI effects list after the audio ones; the Granular follows the Synth,
// the other instrument.
export const menuOrder = 420;

const knob = (
  field: keyof GranularParams,
  label: string,
  rest: { format: (value: number) => string; taper?: "log"; step?: number },
) =>
  ({
    kind: "number",
    key: GRANULAR_KEYS[field],
    label,
    ...GRANULAR_PARAM_RANGES[field],
    defaultValue: DEFAULT_GRANULAR_PARAMS[field],
    ...rest,
  }) as const;

const time = (field: "attack" | "release", label: string) => ({
  ...knob(field, label, { taper: "log", format: formatSeconds }),
  min: MIN_TIME_SECONDS,
});

export const definition: FxEffectDefinition = {
  effectName: GRANULAR_EFFECT_NAME,
  displayName: "Granular",
  description:
    "Plays the clip's notes as clouds of short grains of a built-in sound, through a lowpass filter.",
  accent: "#ffc98a",
  category: "midi",
  domain: "midi",
  known: true,
  // Only a MIDI clip's own stack, as the Synth (see addableEffectsFor).
  scopes: ["clip"],
  parameters: [
    knob("grainSize", "Grain Size", { taper: "log", format: formatSeconds }),
    knob("density", "Density", { taper: "log", format: formatDensity }),
    knob("position", "Position", { step: 0.01, format: formatPercent }),
    knob("spray", "Spray", { step: 0.01, format: formatPercent }),
    knob("transpose", "Transpose", { step: 1, format: formatSemitones }),
    time("attack", "Attack"),
    time("release", "Release"),
    knob("cutoff", "Cutoff", { taper: "log", format: formatHertz }),
    {
      ...knob("resonance", "Resonance", {
        taper: "log",
        format: (value) => value.toFixed(1),
      }),
      min: MIN_RESONANCE,
    },
  ],
};
