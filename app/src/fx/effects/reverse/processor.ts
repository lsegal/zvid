// Reverse as a chain stage: its source stage mirrors where the clip reads
// its media, so the stage itself passes the reversed sound through to the
// effects after it.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import { REVERSE_EFFECT_NAME, reverseReadSeconds } from "./reverse.ts";

export const processor: AudioEffectDsp = {
  effectName: REVERSE_EFFECT_NAME,
  createProcessor: () => ({
    process(input, output, frames) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].set(input[channel].subarray(0, frames));
      }
    },
  }),
  source: { readSeconds: reverseReadSeconds },
};
