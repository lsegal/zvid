// The Synth effect: the instrument a MIDI clip plays its notes through, an
// oscillator through a lowpass filter and an ADSR envelope for each note
// (see audio-mix/synth.ts). It is a MIDI effect, so only MIDI clips' stacks
// offer it, and a MIDI clip sounds only through an enabled one.
import {
  DEFAULT_SYNTH_PARAMS,
  SYNTH_PARAM_RANGES,
  type SynthParams,
  type SynthWave,
} from "../../../midi-clip.ts";

export const SYNTH_EFFECT_NAME = "Synth";

export const WAVE_KEY = "Wave";
export const OCTAVE_KEY = "Octave";
export const DETUNE_KEY = "Detune";
export const CUTOFF_KEY = "Cutoff";
export const RESONANCE_KEY = "Resonance";
export const ATTACK_KEY = "Attack";
export const DECAY_KEY = "Decay";
export const SUSTAIN_KEY = "Sustain";
export const RELEASE_KEY = "Release";

// Each numeric synth parameter's key.
export const SYNTH_NUMBER_KEYS = {
  octave: OCTAVE_KEY,
  detune: DETUNE_KEY,
  cutoff: CUTOFF_KEY,
  resonance: RESONANCE_KEY,
  attack: ATTACK_KEY,
  decay: DECAY_KEY,
  sustain: SUSTAIN_KEY,
  release: RELEASE_KEY,
} as const satisfies Record<Exclude<keyof SynthParams, "wave">, string>;

// The Wave options, in the device's order, and the oscillator each plays.
export const WAVE_OPTIONS = ["Saw", "Square", "Tri", "Sine"] as const;
const WAVE_BY_OPTION: Record<(typeof WAVE_OPTIONS)[number], SynthWave> = {
  Saw: "sawtooth",
  Square: "square",
  Tri: "triangle",
  Sine: "sine",
};

/** The Wave option that plays `wave`. */
export function waveOption(wave: SynthWave) {
  return (
    WAVE_OPTIONS.find((option) => WAVE_BY_OPTION[option] === wave) ??
    WAVE_OPTIONS[0]
  );
}

// Envelope times and the resonance move by ratio, so their knobs start just
// above 0, where a log taper must.
export const MIN_TIME_SECONDS = 0.001;
export const MIN_RESONANCE = 0.1;

export function isSynthEffectName(effectName: string) {
  return effectName === SYNTH_EFFECT_NAME;
}

export function formatSeconds(seconds: number) {
  return seconds < 1
    ? `${Math.round(seconds * 1000)} ms`
    : `${seconds.toFixed(2)} s`;
}

export function formatHertz(hertz: number) {
  return hertz < 1000
    ? `${Math.round(hertz)} Hz`
    : `${(hertz / 1000).toFixed(1)} kHz`;
}

export function formatOctave(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function formatCents(value: number) {
  return `${Math.round(value)} ¢`;
}

type SynthParameter = { key: string; value: string; numericValue?: number };

/**
 * The synth parameters a Synth effect's stored `parameters` play, any
 * missing or invalid one taking its default and the rest held to their
 * ranges.
 */
export function readSynthEffect(
  parameters: readonly SynthParameter[],
): SynthParams {
  const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS };
  const byKey = new Map(
    parameters.map((parameter) => [parameter.key, parameter]),
  );
  const wave = byKey.get(WAVE_KEY)?.value;
  const option = WAVE_OPTIONS.find((candidate) => candidate === wave);
  if (option) {
    params.wave = WAVE_BY_OPTION[option];
  }
  for (const [field, key] of Object.entries(SYNTH_NUMBER_KEYS)) {
    const stored = byKey.get(key);
    const value =
      stored?.numericValue ??
      (stored ? Number.parseFloat(stored.value) : Number.NaN);
    if (Number.isFinite(value)) {
      const { min, max } =
        SYNTH_PARAM_RANGES[field as keyof typeof SYNTH_NUMBER_KEYS];
      params[field as keyof typeof SYNTH_NUMBER_KEYS] = Math.min(
        max,
        Math.max(min, value),
      );
    }
  }
  params.octave = Math.round(params.octave);
  return params;
}
