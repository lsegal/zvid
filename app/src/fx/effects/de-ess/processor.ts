// De-ess as a chain stage. Per frame, a band-pass around Frequency feeds a
// peak follower across every channel; its level over Threshold, up to
// Amount, sets how far the high band (the input less a fourth-order
// Linkwitz-Riley low-pass an octave below Frequency) is turned down. Every
// channel gets the same reduction, so the stereo image holds. Below
// Threshold the output is the input, bit for bit. Listen outputs the
// detection band instead. Frequency, Threshold and Amount follow the host's
// ramps frame by frame, so edits don't click; a Listen change crossfades
// between two processors.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  AMOUNT_KEY,
  createEnvelopeFollower,
  DE_ESS_EFFECT_NAME,
  DE_ESS_RANGES,
  DETECTOR_Q,
  type DeEssNumberKey,
  FREQUENCY_KEY,
  isListening,
  LISTEN_KEY,
  reductionDb,
  SPLIT_RATIO,
  Svf,
  SvfCoefficients,
  THRESHOLD_KEY,
} from "./de-ess.ts";

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which only Threshold and Amount may be, so a Frequency of 0 is its
// default.
function inRange(key: DeEssNumberKey, value: number) {
  const range = DE_ESS_RANGES[key];
  if (!Number.isFinite(value) || (value <= 0 && range.min > 0)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// A parameter as a per-frame reader: the ramp while it moves, else its
// settled value.
function reader(params: AudioParameterBlock, key: DeEssNumberKey) {
  if (params.changing(key)) {
    const values = params.number(key);
    return (index: number) => inRange(key, values[index]);
  }
  const value = inRange(key, params.value(key));
  return () => value;
}

// One channel's detector and crossover filters.
class DeEssChannel {
  readonly detector = new Svf();
  readonly split1 = new Svf();
  readonly split2 = new Svf();
}

export const processor: AudioEffectDsp = {
  effectName: DE_ESS_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const states = Array.from({ length: channels }, () => new DeEssChannel());
    const detector = new SvfCoefficients(sampleRate, DETECTOR_Q);
    const split = new SvfCoefficients(sampleRate, Math.SQRT1_2);
    const follower = createEnvelopeFollower(sampleRate);
    return {
      process(input, output, frames, params) {
        const listen = isListening(params.switch(LISTEN_KEY));
        const frequency = reader(params, FREQUENCY_KEY);
        const threshold = reader(params, THRESHOLD_KEY);
        const amount = reader(params, AMOUNT_KEY);
        for (let index = 0; index < frames; index++) {
          const hz = frequency(index);
          detector.set(hz);
          split.set(hz * SPLIT_RATIO);
          let level = 0;
          for (let channel = 0; channel < output.length; channel++) {
            const state = states[channel];
            const sample = input[channel][index];
            state.detector.process(sample, detector);
            state.split1.process(sample, split);
            state.split2.process(state.split1.low, split);
            level = Math.max(level, Math.abs(detector.k * state.detector.band));
          }
          // The follower runs on every frame, even while listening, so
          // turning Listen off starts from its settled state.
          const envelope = follower.next(level);
          if (listen) {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel][index] =
                detector.k * states[channel].detector.band;
            }
            continue;
          }
          const reduction =
            envelope > 0
              ? reductionDb(
                  20 * Math.log10(envelope),
                  threshold(index),
                  amount(index),
                )
              : 0;
          if (reduction === 0) {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel][index] = input[channel][index];
            }
            continue;
          }
          // The share of the high band to take away.
          const cut = 1 - 10 ** (-reduction / 20);
          for (let channel = 0; channel < output.length; channel++) {
            const sample = input[channel][index];
            const high = sample - states[channel].split2.low;
            output[channel][index] = sample - cut * high;
          }
        }
      },
    };
  },
};
