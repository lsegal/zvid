// Compressor as a chain stage. Every parameter is a number the chain ramps,
// so the processor reads each one per frame.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  ATTACK_KEY,
  COMPRESSOR_EFFECT_NAME,
  CompressorDsp,
  KNEE_KEY,
  MAKEUP_KEY,
  MIX_KEY,
  RATIO_KEY,
  RELEASE_KEY,
  THRESHOLD_KEY,
} from "./compressor.ts";

export const processor: AudioEffectDsp = {
  effectName: COMPRESSOR_EFFECT_NAME,
  createProcessor(sampleRate) {
    const dsp = new CompressorDsp();
    return {
      process(input, output, frames, params) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          thresholdDb: params.number(THRESHOLD_KEY),
          ratio: params.number(RATIO_KEY),
          attackMs: params.number(ATTACK_KEY),
          releaseMs: params.number(RELEASE_KEY),
          kneeDb: params.number(KNEE_KEY),
          makeupDb: params.number(MAKEUP_KEY),
          mix: params.number(MIX_KEY),
        });
      },
    };
  },
};
