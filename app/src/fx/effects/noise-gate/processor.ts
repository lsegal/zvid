// The Noise Gate as a chain stage. Its knobs are numbers the chain ramps,
// so the processor reads each one per frame and a change is click-free.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  ATTACK_KEY,
  HOLD_KEY,
  NOISE_GATE_EFFECT_NAME,
  NOISE_GATE_RANGES,
  type NoiseGateBlock,
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

// A parameter clamped into its own array, reused block to block; it grows
// only if the host's block does.
class ClampedParameter {
  values = new Float32Array(0);
  private readonly key: NoiseGateNumberKey;

  constructor(key: NoiseGateNumberKey) {
    this.key = key;
  }

  read(params: AudioParameterBlock) {
    const values = params.number(this.key);
    if (this.values.length !== values.length) {
      this.values = new Float32Array(values.length);
    }
    return inRange(this.key, values, this.values);
  }
}

export const processor: AudioEffectDsp = {
  effectName: NOISE_GATE_EFFECT_NAME,
  createProcessor(sampleRate) {
    const dsp = new NoiseGateDsp(sampleRate);
    const threshold = new ClampedParameter(THRESHOLD_KEY);
    const attack = new ClampedParameter(ATTACK_KEY);
    const hold = new ClampedParameter(HOLD_KEY);
    const release = new ClampedParameter(RELEASE_KEY);
    const range = new ClampedParameter(RANGE_KEY);
    // One block description, rewritten every block.
    const block: NoiseGateBlock = {
      frames: 0,
      threshold: threshold.values,
      attack: attack.values,
      hold: hold.values,
      release: release.values,
      range: range.values,
    };
    return {
      process(input, output, frames, params) {
        block.frames = frames;
        block.threshold = threshold.read(params);
        block.attack = attack.read(params);
        block.hold = hold.read(params);
        block.release = release.read(params);
        block.range = range.read(params);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
      },
    };
  },
};
