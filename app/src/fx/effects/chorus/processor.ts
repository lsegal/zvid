// Chorus as a chain stage. Every parameter is a number the chain ramps, so
// the processor reads each one per frame.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  CHORUS_EFFECT_NAME,
  ChorusDsp,
  chorusTailSeconds,
  DELAY_DEFAULT_MS,
  DELAY_KEY,
  DEPTH_DEFAULT,
  DEPTH_KEY,
  FEEDBACK_DEFAULT,
  FEEDBACK_KEY,
  MIX_KEY,
  RATE_KEY,
  SPREAD_KEY,
} from "./chorus.ts";

export const processor: AudioEffectDsp = {
  effectName: CHORUS_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new ChorusDsp(sampleRate, channels);
    return {
      process(input, output, frames, params, time) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          timeSeconds: time.timeSeconds,
          rate: params.number(RATE_KEY),
          depth: params.number(DEPTH_KEY),
          delayMs: params.number(DELAY_KEY),
          feedback: params.number(FEEDBACK_KEY),
          spread: params.number(SPREAD_KEY),
          mix: params.number(MIX_KEY),
        });
      },
    };
  },
  tailSeconds: (settings) =>
    chorusTailSeconds(
      settings.numbers[DELAY_KEY] ?? DELAY_DEFAULT_MS,
      settings.numbers[DEPTH_KEY] ?? DEPTH_DEFAULT,
      settings.numbers[FEEDBACK_KEY] ?? FEEDBACK_DEFAULT,
    ),
};
