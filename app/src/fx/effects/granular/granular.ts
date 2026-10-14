// The Granular effect: an instrument a MIDI clip can play its notes through
// instead of the Synth, each note a cloud of short grains of a built-in
// source sound (see audio-mix/granular.ts). It is a MIDI effect, so only
// MIDI clips' stacks offer it.
import {
  DEFAULT_GRANULAR_PARAMS,
  GRANULAR_PARAM_RANGES,
  type GranularParams,
} from "../../../midi-clip.ts";

export const GRANULAR_EFFECT_NAME = "Granular";

// Each Granular parameter's key.
export const GRANULAR_KEYS = {
  grainSize: "Grain Size",
  density: "Density",
  transpose: "Transpose",
  position: "Position",
  spray: "Spray",
  attack: "Attack",
  release: "Release",
  cutoff: "Cutoff",
  resonance: "Resonance",
} as const satisfies Record<keyof GranularParams, string>;

export function isGranularEffectName(effectName: string) {
  return effectName === GRANULAR_EFFECT_NAME;
}

export function formatSemitones(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} st`;
}

export function formatDensity(value: number) {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} /s`;
}

type GranularParameter = { key: string; value: string; numericValue?: number };

/**
 * The parameters a Granular effect's stored `parameters` play, any missing
 * or invalid one taking its default and the rest held to their ranges.
 */
export function readGranularEffect(
  parameters: readonly GranularParameter[],
): GranularParams {
  const params: GranularParams = { ...DEFAULT_GRANULAR_PARAMS };
  const byKey = new Map(
    parameters.map((parameter) => [parameter.key, parameter]),
  );
  for (const [field, key] of Object.entries(GRANULAR_KEYS)) {
    const stored = byKey.get(key);
    const value =
      stored?.numericValue ??
      (stored ? Number.parseFloat(stored.value) : Number.NaN);
    if (Number.isFinite(value)) {
      const { min, max } = GRANULAR_PARAM_RANGES[field as keyof GranularParams];
      params[field as keyof GranularParams] = Math.min(
        max,
        Math.max(min, value),
      );
    }
  }
  params.transpose = Math.round(params.transpose);
  return params;
}
