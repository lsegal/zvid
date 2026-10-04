// Reference processors for testing the audio chain and its hosts, none of
// them registered as effects: a one-pole low-pass filter, a pure delay that
// reports its latency, an echo with a tail, a soft clipper (so a bus effect
// on a sum differs from the sum of per-clip effects), a reverse source
// stage and a tempo-synced modulator.
import { processor as gain } from "../fx/effects/gain/processor.ts";
import {
  type AudioEffectDsp,
  type AudioStage,
  createProcessorRegistry,
} from "./processor.ts";
import { noteValueSeconds, timelinePhase } from "./tempo.ts";

export const ONE_POLE = "Test One-Pole";
export const DELAY = "Test Delay";
export const ECHO = "Test Echo";
export const CLIP = "Test Clip";
export const REVERSE = "Test Reverse";
export const CLOCK = "Test Clock";

const onePole: AudioEffectDsp = {
  effectName: ONE_POLE,
  createProcessor(sampleRate, channels) {
    const state = new Float64Array(channels);
    return {
      process(input, output, frames, params) {
        const cutoff = params.number("Cutoff");
        for (let index = 0; index < frames; index++) {
          const coefficient =
            1 - Math.exp((-2 * Math.PI * cutoff[index]) / sampleRate);
          for (let channel = 0; channel < output.length; channel++) {
            state[channel] +=
              coefficient * (input[channel][index] - state[channel]);
            output[channel][index] = state[channel];
          }
        }
      },
      reset() {
        state.fill(0);
      },
    };
  },
  tailSeconds: () => 0.05,
};

const delay: AudioEffectDsp = {
  effectName: DELAY,
  createProcessor(_sampleRate, channels) {
    let lines: Float32Array[] = [];
    let at = 0;
    return {
      process(input, output, frames, params) {
        const length = Math.round(params.value("Frames"));
        if (lines[0]?.length !== length) {
          lines = Array.from(
            { length: channels },
            () => new Float32Array(length),
          );
          at = 0;
        }
        for (let index = 0; index < frames; index++) {
          for (let channel = 0; channel < output.length; channel++) {
            const line = lines[channel];
            output[channel][index] = length ? line[at] : input[channel][index];
            if (length) {
              line[at] = input[channel][index];
            }
          }
          at = length ? (at + 1) % length : 0;
        }
      },
      reset() {
        lines = [];
        at = 0;
      },
    };
  },
  latencyFrames: (settings) => settings.numbers.Frames ?? 0,
};

const echo: AudioEffectDsp = {
  effectName: ECHO,
  createProcessor(sampleRate, channels) {
    const lines = Array.from(
      { length: channels },
      () => new Float32Array(Math.round(0.05 * sampleRate)),
    );
    let at = 0;
    return {
      process(input, output, frames) {
        for (let index = 0; index < frames; index++) {
          for (let channel = 0; channel < output.length; channel++) {
            const line = lines[channel];
            const sample = input[channel][index] + 0.5 * line[at];
            line[at] = sample;
            output[channel][index] = sample;
          }
          at = (at + 1) % lines[0].length;
        }
      },
      reset() {
        for (const line of lines) {
          line.fill(0);
        }
        at = 0;
      },
    };
  },
  // Half as loud every 50 ms: well under a millionth after a second.
  tailSeconds: () => 1,
};

const clipper: AudioEffectDsp = {
  effectName: CLIP,
  createProcessor: () => ({
    process(input, output, frames) {
      for (let channel = 0; channel < output.length; channel++) {
        for (let index = 0; index < frames; index++) {
          output[channel][index] = Math.tanh(3 * input[channel][index]);
        }
      }
    },
    reset() {},
  }),
};

const reverse: AudioEffectDsp = {
  effectName: REVERSE,
  createProcessor: () => ({
    process(input, output, frames) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].set(input[channel].subarray(0, frames));
      }
    },
    reset() {},
  }),
  source: {
    readSeconds: (seconds, { startSeconds, endSeconds }) =>
      startSeconds + endSeconds - seconds,
  },
};

// Scales its input by the phase of a quarter-note cycle at each frame's
// timeline time, like a tempo-synced LFO.
const clock: AudioEffectDsp = {
  effectName: CLOCK,
  createProcessor: () => ({
    process(input, output, frames, _params, time) {
      const period = noteValueSeconds("1/4", time) ?? 1;
      for (let index = 0; index < frames; index++) {
        const phase = timelinePhase(
          time.timeSeconds + index / time.sampleRate,
          period,
        );
        for (let channel = 0; channel < output.length; channel++) {
          output[channel][index] = input[channel][index] * phase;
        }
      }
    },
    reset() {},
  }),
};

// Gain and the test processors.
export const TEST_PROCESSORS = createProcessorRegistry([
  gain,
  onePole,
  delay,
  echo,
  clipper,
  reverse,
  clock,
]);

export function testStage(
  effectName: string,
  numbers: Record<string, number> = {},
  options: {
    id?: string;
    enabled?: boolean;
    switches?: Record<string, string>;
  } = {},
): AudioStage {
  return {
    id: options.id ?? effectName,
    effectName,
    enabled: options.enabled ?? true,
    numbers,
    switches: options.switches ?? {},
  };
}
