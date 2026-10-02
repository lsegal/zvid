// Stereo as a chain stage: widens or narrows the first two channels in
// mid/side, then balances them. A mono stage has no side to widen and no
// second channel to pan to, so it passes its input unchanged; so do any
// channels past the second.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  PAN_DEFAULT,
  PAN_KEY,
  panAmplitudes,
  STEREO_EFFECT_NAME,
  sideScale,
  WIDTH_DEFAULT,
  WIDTH_KEY,
} from "./stereo.ts";

function stereoFrame(
  left: number,
  right: number,
  width: number,
  pan: number,
  out: [number, number],
) {
  const mid = (left + right) / 2;
  const side = ((left - right) / 2) * sideScale(width);
  const [panLeft, panRight] = panAmplitudes(pan);
  out[0] = (mid + side) * panLeft;
  out[1] = (mid - side) * panRight;
}

export const processor: AudioEffectDsp = {
  effectName: STEREO_EFFECT_NAME,
  createProcessor: () => {
    const frame: [number, number] = [0, 0];
    return {
      process(input, output, frames, params) {
        const stereo = output.length >= 2 && input.length >= 2;
        for (let channel = stereo ? 2 : 0; channel < output.length; channel++) {
          output[channel].set(input[channel].subarray(0, frames));
        }
        if (!stereo) {
          return;
        }
        const [inLeft, inRight] = input;
        const [outLeft, outRight] = output;
        if (!params.changing(WIDTH_KEY) && !params.changing(PAN_KEY)) {
          const width = params.value(WIDTH_KEY);
          const pan = params.value(PAN_KEY);
          if (width === WIDTH_DEFAULT && pan === PAN_DEFAULT) {
            outLeft.set(inLeft.subarray(0, frames));
            outRight.set(inRight.subarray(0, frames));
            return;
          }
          for (let index = 0; index < frames; index++) {
            stereoFrame(inLeft[index], inRight[index], width, pan, frame);
            outLeft[index] = frame[0];
            outRight[index] = frame[1];
          }
          return;
        }
        const widths = params.number(WIDTH_KEY);
        const pans = params.number(PAN_KEY);
        for (let index = 0; index < frames; index++) {
          stereoFrame(
            inLeft[index],
            inRight[index],
            widths[index],
            pans[index],
            frame,
          );
          outLeft[index] = frame[0];
          outRight[index] = frame[1];
        }
      },
    };
  },
};
