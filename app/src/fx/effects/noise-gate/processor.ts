// The Noise Gate as a chain stage. Its knobs are numbers the chain ramps,
// so the processor reads each one per frame and a change is click-free.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  ATTACK_KEY,
  HOLD_KEY,
  NOISE_GATE_EFFECT_NAME,
  NOISE_GATE_RANGES,
  NoiseGateDsp,
  type NoiseGateNumberKey,
  RANGE_KEY,
  RELEASE_KEY,
  THRESHOLD_KEY,
} from "./noise-gate.ts";

// `values` clamped to the parameter's range, into `clamped`.
function inRange(
  key: NoiseGateNumberKey,
  values: Float32Array,
  clamped: Float32Array,
) {
  const range = NOISE_GATE_RANGES[key];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    clamped[index] = Number.isFinite(value)
      ? Math.min(range.max, Math.max(range.min, value))
      : range.defaultValue;
  }
  return clamped;
}

export const processor: AudioEffectDsp = {
  effectName: NOISE_GATE_EFFECT_NAME,
  createProcessor(sampleRate) {
    const dsp = new NoiseGateDsp(sampleRate);
    // Reused for each block's clamped values, so processing allocates
    // nothing.
    const scratch = new Map<NoiseGateNumberKey, Float32Array>();
    return {
      process(input, output, frames, params) {
        const read = (key: NoiseGateNumberKey) => {
          const values = params.number(key);
          let clamped = scratch.get(key);
          if (clamped?.length !== values.length) {
            clamped = new Float32Array(values.length);
            scratch.set(key, clamped);
          }
          return inRange(key, values, clamped);
        };
        dsp.process(input, output, {
          frames,
          threshold: read(THRESHOLD_KEY),
          attack: read(ATTACK_KEY),
          hold: read(HOLD_KEY),
          release: read(RELEASE_KEY),
          range: read(RANGE_KEY),
        });
      },
    };
  },
};
