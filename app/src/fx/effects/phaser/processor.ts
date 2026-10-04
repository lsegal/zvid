// Phaser as a chain stage. Its knobs are numbers the chain ramps, so the
// processor reads each one per frame; Stages is a switch the chain
// crossfades.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  CENTER_KEY,
  DEPTH_KEY,
  FEEDBACK_KEY,
  MIX_KEY,
  PHASER_EFFECT_NAME,
  PHASER_RANGES,
  type PhaserBlock,
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

// The parameter's values this block clamped into `scratch`, or into a new
// array the first time or should the block size change.
function clampInto(
  key: PhaserNumberKey,
  params: AudioParameterBlock,
  scratch: Float32Array,
) {
  const values = params.number(key);
  const clamped =
    scratch.length === values.length
      ? scratch
      : new Float32Array(values.length);
  return inRange(key, values, clamped);
}

function setting(
  numbers: Readonly<Record<string, number>>,
  key: PhaserNumberKey,
) {
  return numbers[key] ?? PHASER_RANGES[key].defaultValue;
}

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: PHASER_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new PhaserDsp(sampleRate, channels);
    // Filled in again every block, so processing allocates nothing.
    const block: PhaserBlock = {
      frames: 0,
      timeSeconds: 0,
      stages: stageCount(undefined),
      rate: EMPTY,
      depth: EMPTY,
      center: EMPTY,
      feedback: EMPTY,
      mix: EMPTY,
    };
    // The Stages text last read, so it is parsed again only on a change.
    let stages: string | undefined;
    return {
      process(input, output, frames, params, time) {
        const nextStages = params.switch(STAGES_KEY);
        if (nextStages !== stages) {
          stages = nextStages;
          block.stages = stageCount(stages);
        }
        block.frames = frames;
        block.timeSeconds = time.timeSeconds;
        // Each block's clamped values overwrite the last block's.
        block.rate = clampInto(RATE_KEY, params, block.rate);
        block.depth = clampInto(DEPTH_KEY, params, block.depth);
        block.center = clampInto(CENTER_KEY, params, block.center);
        block.feedback = clampInto(FEEDBACK_KEY, params, block.feedback);
        block.mix = clampInto(MIX_KEY, params, block.mix);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
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
