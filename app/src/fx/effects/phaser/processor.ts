// Phaser as a chain stage. Its knobs are numbers the chain ramps, so the
// processor reads each one per frame; Stages is a switch the chain
// crossfades.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  CENTER_KEY,
  DEPTH_KEY,
  FEEDBACK_KEY,
  MIX_KEY,
  PHASER_EFFECT_NAME,
  PHASER_RANGES,
  PhaserDsp,
  type PhaserNumberKey,
  phaserTailSeconds,
  RATE_KEY,
  STAGES_KEY,
  stageCount,
} from "./phaser.ts";

// `values` clamped to the parameter's range, into `clamped`. The host reads
// an unset parameter as 0, which Rate and Center may not be, so those fall
// back to their defaults.
function inRange(
  key: PhaserNumberKey,
  values: Float32Array,
  clamped: Float32Array,
) {
  const range = PHASER_RANGES[key];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    clamped[index] =
      !Number.isFinite(value) || (value <= 0 && range.min > 0)
        ? range.defaultValue
        : Math.min(range.max, Math.max(range.min, value));
  }
  return clamped;
}

function setting(numbers: Readonly<Record<string, number>>, key: PhaserNumberKey) {
  return numbers[key] ?? PHASER_RANGES[key].defaultValue;
}

export const processor: AudioEffectDsp = {
  effectName: PHASER_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new PhaserDsp(sampleRate, channels);
    // Reused for each block's clamped values, so processing allocates
    // nothing.
    const scratch = new Map<PhaserNumberKey, Float32Array>();
    return {
      process(input, output, frames, params, time) {
        const read = (key: PhaserNumberKey) => {
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
          timeSeconds: time.timeSeconds,
          stages: stageCount(params.switch(STAGES_KEY)),
          rate: read(RATE_KEY),
          depth: read(DEPTH_KEY),
          center: read(CENTER_KEY),
          feedback: read(FEEDBACK_KEY),
          mix: read(MIX_KEY),
        });
      },
    };
  },
  tailSeconds: (settings) =>
    phaserTailSeconds(
      setting(settings.numbers, CENTER_KEY),
      setting(settings.numbers, DEPTH_KEY),
      stageCount(settings.switches[STAGES_KEY]),
      setting(settings.numbers, FEEDBACK_KEY),
    ),
};
