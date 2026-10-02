// Reverb as a chain stage. Every parameter is a number the chain ramps, so
// the processor reads each one per frame.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DAMPING_KEY,
  DECAY_DEFAULT,
  DECAY_KEY,
  MIX_KEY,
  PRE_DELAY_DEFAULT_MS,
  PRE_DELAY_KEY,
  REVERB_EFFECT_NAME,
  ReverbDsp,
  reverbTailSeconds,
  SIZE_DEFAULT,
  SIZE_KEY,
} from "./reverb.ts";

export const processor: AudioEffectDsp = {
  effectName: REVERB_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new ReverbDsp(sampleRate, channels);
    return {
      process(input, output, frames, params) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          decay: params.number(DECAY_KEY),
          preDelayMs: params.number(PRE_DELAY_KEY),
          size: params.number(SIZE_KEY),
          damping: params.number(DAMPING_KEY),
          mix: params.number(MIX_KEY),
        });
      },
    };
  },
  tailSeconds: (settings) =>
    reverbTailSeconds(
      settings.numbers[DECAY_KEY] ?? DECAY_DEFAULT,
      settings.numbers[PRE_DELAY_KEY] ?? PRE_DELAY_DEFAULT_MS,
      settings.numbers[SIZE_KEY] ?? SIZE_DEFAULT,
    ),
};
