// Mono as a chain stage: both channels blend toward the folded signal by
// Amount, which the host ramps. Source is a switch, so the chain crossfades
// it. A one-channel input has nothing to fold and passes through.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  AMOUNT_KEY,
  blendToMono,
  MONO_EFFECT_NAME,
  monoSample,
  SOURCE_KEY,
} from "./mono.ts";

export const processor: AudioEffectDsp = {
  effectName: MONO_EFFECT_NAME,
  createProcessor: () => ({
    process(input, output, frames, params) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].set(input[channel].subarray(0, frames));
      }
      if (output.length < 2) {
        return;
      }
      const source = params.switch(SOURCE_KEY);
      const changing = params.changing(AMOUNT_KEY);
      const amounts = changing ? params.number(AMOUNT_KEY) : null;
      const settled = params.value(AMOUNT_KEY);
      const left = input[0];
      const right = input[1];
      for (let index = 0; index < frames; index++) {
        const amount = amounts ? amounts[index] : settled;
        const mono = monoSample(source, left[index], right[index]);
        output[0][index] = blendToMono(left[index], mono, amount);
        output[1][index] = blendToMono(right[index], mono, amount);
      }
    },
  }),
};
