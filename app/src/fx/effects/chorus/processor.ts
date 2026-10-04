// Chorus as a chain stage. Every parameter is a number the chain ramps, so
// the processor reads each one per frame.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  CHORUS_EFFECT_NAME,
  type ChorusBlock,
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

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: CHORUS_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new ChorusDsp(sampleRate, channels);
    // Filled in again every block, so processing allocates nothing.
    const block: ChorusBlock = {
      frames: 0,
      sampleRate,
      timeSeconds: 0,
      rate: EMPTY,
      depth: EMPTY,
      delayMs: EMPTY,
      feedback: EMPTY,
      spread: EMPTY,
      mix: EMPTY,
    };
    return {
      process(input, output, frames, params, time) {
        block.frames = frames;
        block.timeSeconds = time.timeSeconds;
        block.rate = params.number(RATE_KEY);
        block.depth = params.number(DEPTH_KEY);
        block.delayMs = params.number(DELAY_KEY);
        block.feedback = params.number(FEEDBACK_KEY);
        block.spread = params.number(SPREAD_KEY);
        block.mix = params.number(MIX_KEY);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
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
