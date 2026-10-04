// Reverb as a chain stage. Decay, Damping and Mix are read per frame as the
// chain ramps them; Pre-delay and Size as stored, since the reverb
// crossfades its delays to them itself.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DAMPING_KEY,
  DECAY_DEFAULT,
  DECAY_KEY,
  MIX_KEY,
  PRE_DELAY_DEFAULT_MS,
  PRE_DELAY_KEY,
  REVERB_EFFECT_NAME,
  type ReverbBlock,
  ReverbDsp,
  reverbTailSeconds,
  SIZE_DEFAULT,
  SIZE_KEY,
} from "./reverb.ts";

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: REVERB_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new ReverbDsp(sampleRate, channels);
    // Filled in again every block, so processing allocates nothing.
    const block: ReverbBlock = {
      frames: 0,
      sampleRate,
      decay: EMPTY,
      damping: EMPTY,
      mix: EMPTY,
      preDelayMs: 0,
      size: 0,
    };
    return {
      process(input, output, frames, params) {
        block.frames = frames;
        block.decay = params.number(DECAY_KEY);
        block.damping = params.number(DAMPING_KEY);
        block.mix = params.number(MIX_KEY);
        block.preDelayMs = params.value(PRE_DELAY_KEY);
        block.size = params.value(SIZE_KEY);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
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
