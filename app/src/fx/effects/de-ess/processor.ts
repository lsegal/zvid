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
// settled value. Each processor keeps one per parameter and updates it
// every block, so reading allocates nothing.
class ParameterReader {
  // The block's ramp while the parameter moves, else null.
  ramp: Float32Array | null = null;
  // Its settled value, in range.
  settled = 0;
  private readonly key: DeEssNumberKey;

  constructor(key: DeEssNumberKey) {
    this.key = key;
  }

  update(params: AudioParameterBlock) {
    this.ramp = params.changing(this.key) ? params.number(this.key) : null;
    this.settled = inRange(this.key, params.value(this.key));
  }

  at(index: number) {
    return this.ramp ? inRange(this.key, this.ramp[index]) : this.settled;
  }

  reset() {
    this.ramp = null;
    this.settled = 0;
  }
}

// One channel's detector and crossover filters.
class DeEssChannel {
  readonly detector = new Svf();
  readonly split1 = new Svf();
  readonly split2 = new Svf();

  reset() {
    this.detector.reset();
    this.split1.reset();
    this.split2.reset();
  }
}

// Below Threshold's amplitude by this margin, an envelope's level is
// surely under Threshold whatever log10 rounds to, so its log is skipped.
const UNDER_THRESHOLD = 1 - 1e-6;

export const processor: AudioEffectDsp = {
  effectName: DE_ESS_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const states = Array.from({ length: channels }, () => new DeEssChannel());
    const detector = new SvfCoefficients(sampleRate, DETECTOR_Q);
    const split = new SvfCoefficients(sampleRate, Math.SQRT1_2);
    const follower = createEnvelopeFollower(sampleRate);
    const frequency = new ParameterReader(FREQUENCY_KEY);
    const threshold = new ParameterReader(THRESHOLD_KEY);
    const amount = new ParameterReader(AMOUNT_KEY);
    // isListening trims and lowercases, so it runs only when Listen changes.
    let listenValue: string | null = null;
    let listen = false;
    // The last reduction and its cut, since a clamped reduction repeats.
    let lastReduction = Number.NaN;
    let lastCut = 0;
    return {
      process(input, output, frames, params) {
        const listenSwitch = params.switch(LISTEN_KEY);
        if (listenSwitch !== listenValue) {
          listenValue = listenSwitch;
          listen = isListening(listenSwitch);
        }
        frequency.update(params);
        threshold.update(params);
        amount.update(params);
        // An envelope at or below this can't reach a settled Threshold, or
        // anything when a settled Amount is 0, so it needs no reduction.
        let floor = 0;
        if (!amount.ramp && amount.settled <= 0) {
          floor = Number.POSITIVE_INFINITY;
        } else if (!threshold.ramp) {
          floor = 10 ** (threshold.settled / 20) * UNDER_THRESHOLD;
        }
        for (let index = 0; index < frames; index++) {
          const hz = frequency.at(index);
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
            envelope > 0 && envelope > floor
              ? reductionDb(
                  20 * Math.log10(envelope),
                  threshold.at(index),
                  amount.at(index),
                )
              : 0;
          if (reduction === 0) {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel][index] = input[channel][index];
            }
            continue;
          }
          // The share of the high band to take away.
          if (reduction !== lastReduction) {
            lastReduction = reduction;
            lastCut = 1 - 10 ** (-reduction / 20);
          }
          const cut = lastCut;
          for (let channel = 0; channel < output.length; channel++) {
            const sample = input[channel][index];
            const high = sample - states[channel].split2.low;
            output[channel][index] = sample - cut * high;
          }
        }
      },
      reset() {
        for (let channel = 0; channel < states.length; channel++) {
          states[channel].reset();
        }
        detector.reset();
        split.reset();
        follower.reset();
        frequency.reset();
        threshold.reset();
        amount.reset();
        listenValue = null;
        listen = false;
        lastReduction = Number.NaN;
        lastCut = 0;
      },
    };
  },
};
