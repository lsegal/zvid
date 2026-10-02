// The Limiter as a chain stage. Gain drives the input; one detector across
// all channels (the loudest one) sets each frame's required gain from the
// Ceiling, so every channel gets the same gain and the stereo image holds.
// The driven signal comes out delayed by the lookahead, which the chain
// compensates as this stage's latency.
//
// Ceiling, Release and Gain ramp like any number parameter. A Lookahead
// change moves the delay, so it crossfades from the old delay and gain
// computer to a new one, primed from the shared history.
import { SWITCH_CROSSFADE_SECONDS } from "../../../audio-mix/chain.ts";
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  CEILING_KEY,
  dbToAmplitude,
  GAIN_KEY,
  LIMITER_EFFECT_NAME,
  LimiterGain,
  LOOKAHEAD_DEFAULT_MS,
  LOOKAHEAD_KEY,
  LOOKAHEAD_MAX_MS,
  lookaheadFrames,
  RELEASE_KEY,
  releaseCoefficient,
} from "./limiter.ts";

export const processor: AudioEffectDsp = {
  effectName: LIMITER_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    // Two lookaheads of history, so a new gain computer can be primed with
    // every frame its window and average reach back to.
    let size = 1;
    while (size < 2 * lookaheadFrames(LOOKAHEAD_MAX_MS, sampleRate) + 2) {
      size *= 2;
    }
    const mask = size - 1;
    const driven = Array.from(
      { length: channels },
      () => new Float32Array(size),
    );
    const required = new Float64Array(size).fill(1);
    const fadeFrames = Math.max(
      1,
      Math.round(SWITCH_CROSSFADE_SECONDS * sampleRate),
    );
    let frame = 0;
    let current: LimiterGain | null = null;
    let fading: { gain: LimiterGain; at: number } | null = null;

    // A gain computer for `lookahead` frames, fed the frames before this
    // one as if it had been running all along.
    const primed = (lookahead: number, release: number) => {
      const gain = new LimiterGain(lookahead);
      for (let back = 2 * lookahead + 1; back > 0; back--) {
        const at = frame - back;
        gain.next(at, at < 0 ? 1 : required[at & mask], release);
      }
      return gain;
    };

    // The delayed frame `lookahead` back, at `gain`, but never above that
    // frame's required gain, whatever the rounding.
    const tap = (channel: number, lookahead: number, gain: number) => {
      const at = (frame - lookahead) & mask;
      return driven[channel][at] * Math.min(gain, required[at]);
    };

    return {
      process(input, output, frames, params) {
        const ceilings = params.changing(CEILING_KEY)
          ? params.number(CEILING_KEY)
          : null;
        const releases = params.changing(RELEASE_KEY)
          ? params.number(RELEASE_KEY)
          : null;
        const gains = params.changing(GAIN_KEY)
          ? params.number(GAIN_KEY)
          : null;
        const ceiling = dbToAmplitude(params.value(CEILING_KEY));
        const release = releaseCoefficient(
          params.value(RELEASE_KEY),
          sampleRate,
        );
        const drive = dbToAmplitude(params.value(GAIN_KEY));
        const lookahead = lookaheadFrames(
          params.value(LOOKAHEAD_KEY),
          sampleRate,
        );

        if (!current) {
          current = primed(lookahead, release);
        } else if (!fading && current.lookahead !== lookahead) {
          fading = { gain: current, at: 0 };
          current = primed(lookahead, release);
        }

        for (let index = 0; index < frames; index++) {
          const amount = gains ? dbToAmplitude(gains[index]) : drive;
          const at = frame & mask;
          let peak = 0;
          for (let channel = 0; channel < channels; channel++) {
            const sample = input[channel][index] * amount;
            driven[channel][at] = sample;
            peak = Math.max(peak, Math.abs(sample));
          }
          const limit = ceilings ? dbToAmplitude(ceilings[index]) : ceiling;
          const need = peak > limit ? limit / peak : 1;
          required[at] = need;
          const pole = releases
            ? releaseCoefficient(releases[index], sampleRate)
            : release;

          const gain = current.next(frame, need, pole);
          if (fading) {
            const old = fading.gain;
            const oldGain = old.next(frame, need, pole);
            const weight = 1 - fading.at / fadeFrames;
            for (let channel = 0; channel < output.length; channel++) {
              const sample = tap(channel, current.lookahead, gain);
              output[channel][index] =
                sample + (tap(channel, old.lookahead, oldGain) - sample) * weight;
            }
            fading.at++;
            if (fading.at >= fadeFrames) {
              fading = null;
            }
          } else {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel][index] = tap(channel, current.lookahead, gain);
            }
          }
          frame++;
        }
      },
    };
  },
  latencyFrames: (settings, sampleRate) =>
    lookaheadFrames(
      settings.numbers[LOOKAHEAD_KEY] ?? LOOKAHEAD_DEFAULT_MS,
      sampleRate,
    ),
};
