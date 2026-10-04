// Compressor as a chain stage. Every parameter is a number the chain ramps,
// so the processor reads each one per frame.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  ATTACK_KEY,
  COMPRESSOR_EFFECT_NAME,
  type CompressorBlock,
  CompressorDsp,
  KNEE_KEY,
  MAKEUP_KEY,
  MIX_KEY,
  RATIO_KEY,
  RELEASE_KEY,
  THRESHOLD_KEY,
} from "./compressor.ts";

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: COMPRESSOR_EFFECT_NAME,
  createProcessor(sampleRate) {
    const dsp = new CompressorDsp();
    // Filled in again every block, so processing allocates nothing.
    const block: CompressorBlock = {
      frames: 0,
      sampleRate,
      thresholdDb: EMPTY,
      ratio: EMPTY,
      attackMs: EMPTY,
      releaseMs: EMPTY,
      kneeDb: EMPTY,
      makeupDb: EMPTY,
      mix: EMPTY,
    };
    return {
      process(input, output, frames, params) {
        block.frames = frames;
        block.thresholdDb = params.number(THRESHOLD_KEY);
        block.ratio = params.number(RATIO_KEY);
        block.attackMs = params.number(ATTACK_KEY);
        block.releaseMs = params.number(RELEASE_KEY);
        block.kneeDb = params.number(KNEE_KEY);
        block.makeupDb = params.number(MAKEUP_KEY);
        block.mix = params.number(MIX_KEY);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
      },
    };
  },
};
