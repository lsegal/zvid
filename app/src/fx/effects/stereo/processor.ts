// Stereo as a chain stage: widens or narrows the first two channels in
// mid/side, then balances them. A mono stage has no side to widen and no
// second channel to pan to, so it passes its input unchanged; so do any
// channels past the second.
import {
  type AudioEffectDsp,
  copyFrames,
} from "../../../audio-mix/processor.ts";
import {
  PAN_DEFAULT,
  PAN_KEY,
  STEREO_EFFECT_NAME,
  sideScale,
  WIDTH_DEFAULT,
  WIDTH_KEY,
  writePanAmplitudes,
} from "./stereo.ts";

export const processor: AudioEffectDsp = {
  effectName: STEREO_EFFECT_NAME,
  createProcessor: () => {
    const pan: [number, number] = [0, 0];
    return {
      process(input, output, frames, params) {
        const stereo = output.length >= 2 && input.length >= 2;
        for (let channel = stereo ? 2 : 0; channel < output.length; channel++) {
          copyFrames(input[channel], output[channel], frames);
        }
        if (!stereo) {
          return;
        }
        const inLeft = input[0];
        const inRight = input[1];
        const outLeft = output[0];
        const outRight = output[1];
        if (!params.changing(WIDTH_KEY) && !params.changing(PAN_KEY)) {
          const width = params.value(WIDTH_KEY);
          if (
            width === WIDTH_DEFAULT &&
            params.value(PAN_KEY) === PAN_DEFAULT
          ) {
            copyFrames(inLeft, outLeft, frames);
            copyFrames(inRight, outRight, frames);
            return;
          }
          // Settled, so the side scale and pan law hold for the whole block.
          const scale = sideScale(width);
          writePanAmplitudes(params.value(PAN_KEY), pan);
          const panLeft = pan[0];
          const panRight = pan[1];
          for (let index = 0; index < frames; index++) {
            const left = inLeft[index];
            const right = inRight[index];
            const mid = (left + right) / 2;
            const side = ((left - right) / 2) * scale;
            outLeft[index] = (mid + side) * panLeft;
            outRight[index] = (mid - side) * panRight;
          }
          return;
        }
        const widths = params.number(WIDTH_KEY);
        const pans = params.number(PAN_KEY);
        for (let index = 0; index < frames; index++) {
          const left = inLeft[index];
          const right = inRight[index];
          const mid = (left + right) / 2;
          const side = ((left - right) / 2) * sideScale(widths[index]);
          writePanAmplitudes(pans[index], pan);
          outLeft[index] = (mid + side) * pan[0];
          outRight[index] = (mid - side) * pan[1];
        }
      },
      // Stateless: nothing carries from one block to the next.
      reset() {},
    };
  },
};
