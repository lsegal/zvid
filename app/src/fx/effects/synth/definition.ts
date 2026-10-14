import {
  DEFAULT_SYNTH_PARAMS,
  SYNTH_PARAM_RANGES,
} from "../../../midi-clip.ts";
import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  ATTACK_KEY,
  CUTOFF_KEY,
  DECAY_KEY,
  DETUNE_KEY,
  formatCents,
  formatHertz,
  formatOctave,
  formatSeconds,
  MIN_RESONANCE,
  MIN_TIME_SECONDS,
  OCTAVE_KEY,
  RELEASE_KEY,
  RESONANCE_KEY,
  SUSTAIN_KEY,
  SYNTH_EFFECT_NAME,
  WAVE_KEY,
  WAVE_OPTIONS,
  waveOption,
} from "./synth.ts";

// MIDI effects list after the audio ones; the Synth follows the
// Arpeggiator, as notes do.
export const menuOrder = 410;

const time = (key: string, label: string, max: number, defaultValue: number) =>
  ({
    kind: "number",
    key,
    label,
    min: MIN_TIME_SECONDS,
    max,
    defaultValue,
    taper: "log",
    format: formatSeconds,
  }) as const;

export const definition: FxEffectDefinition = {
  effectName: SYNTH_EFFECT_NAME,
  displayName: "Synth",
  description:
    "Plays the clip's notes: an oscillator through a lowpass filter, shaped by an ADSR envelope.",
  accent: "#9fd4ff",
  category: "midi",
  domain: "midi",
  known: true,
  // Only a MIDI clip's own stack, which the add menus tell apart from other
  // clips' (see addableEffectsFor).
  scopes: ["clip"],
  knobRows: ["Tone", "Env"],
  parameters: [
    {
      kind: "enum",
      key: WAVE_KEY,
      label: "Wave",
      options: WAVE_OPTIONS,
      defaultValue: waveOption(DEFAULT_SYNTH_PARAMS.wave),
    },
    {
      kind: "number",
      key: OCTAVE_KEY,
      label: "Octave",
      ...SYNTH_PARAM_RANGES.octave,
      defaultValue: DEFAULT_SYNTH_PARAMS.octave,
      step: 1,
      format: formatOctave,
    },
    {
      kind: "number",
      key: DETUNE_KEY,
      label: "Detune",
      ...SYNTH_PARAM_RANGES.detune,
      defaultValue: DEFAULT_SYNTH_PARAMS.detune,
      step: 1,
      format: formatCents,
    },
    {
      kind: "number",
      key: CUTOFF_KEY,
      label: "Cutoff",
      ...SYNTH_PARAM_RANGES.cutoff,
      defaultValue: DEFAULT_SYNTH_PARAMS.cutoff,
      taper: "log",
      format: formatHertz,
    },
    {
      kind: "number",
      key: RESONANCE_KEY,
      label: "Resonance",
      min: MIN_RESONANCE,
      max: SYNTH_PARAM_RANGES.resonance.max,
      defaultValue: DEFAULT_SYNTH_PARAMS.resonance,
      taper: "log",
      format: (value) => value.toFixed(1),
    },
    time(
      ATTACK_KEY,
      "Attack",
      SYNTH_PARAM_RANGES.attack.max,
      DEFAULT_SYNTH_PARAMS.attack,
    ),
    time(
      DECAY_KEY,
      "Decay",
      SYNTH_PARAM_RANGES.decay.max,
      DEFAULT_SYNTH_PARAMS.decay,
    ),
    {
      kind: "number",
      key: SUSTAIN_KEY,
      label: "Sustain",
      ...SYNTH_PARAM_RANGES.sustain,
      defaultValue: DEFAULT_SYNTH_PARAMS.sustain,
      step: 0.01,
      format: formatPercent,
    },
    time(
      RELEASE_KEY,
      "Release",
      SYNTH_PARAM_RANGES.release.max,
      DEFAULT_SYNTH_PARAMS.release,
    ),
  ],
};
