import { signal } from "./fx-audio.ts";

// Signals and level measurements the audio effect tests share beyond
// fx-audio.ts: the e2e specs' burst and swelling-noise inputs, and the ways
// their analyser reads summed what they heard.

// The e2e specs' 16-bit WAVs peaked at 10 000, about −10 dBFS.
export const SPEC_PEAK = 10_000 / 32767;

const quantize = (sample: number) => Math.round(sample * 32767) / 32767;

// 440 Hz bursts at 8 kHz, 50 ms every 500 ms.
export function bursts(seconds: number, peak = SPEC_PEAK) {
  return signal(seconds, 8000, (index, t) =>
    index % 4000 < 400 ? quantize(peak * Math.sin(2 * Math.PI * 440 * t)) : 0,
  );
}

// Seeded stereo noise whose level swells and falls twice a second, so a
// compressor keeps attacking and releasing.
export function swellingNoise(frames: number, sampleRate: number, seed = 7) {
  let state = seed;
  return [0, 1].map(() =>
    Float32Array.from({ length: frames }, (_, index) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      const swell =
        0.55 + 0.45 * Math.sin((2 * Math.PI * 2 * index) / sampleRate);
      return (state / 2 ** 32 - 0.5) * swell;
    }),
  );
}

// The RMS level of the channels averaged into one, as the preview's
// analyser hears a stereo mix: a sound panned hard to one side reads lower
// than the same sound centered.
export function monoLevel(channels: readonly Float32Array[]) {
  const frames = channels[0]?.length ?? 0;
  let total = 0;
  for (let index = 0; index < frames; index++) {
    let sum = 0;
    for (const channel of channels) {
      sum += channel[index];
    }
    const sample = sum / channels.length;
    total += sample * sample;
  }
  return frames ? Math.sqrt(total / frames) : 0;
}

// The mean of the RMS levels of consecutive `windowFrames`-sample windows,
// as averaging an analyser's reads through playback does: a tremolo lowers
// it, though its peaks stay at full level.
export function meanWindowLevel(
  channels: readonly Float32Array[],
  windowFrames = 2048,
) {
  const frames = channels[0]?.length ?? 0;
  const levels: number[] = [];
  for (let at = 0; at + windowFrames <= frames; at += windowFrames) {
    let total = 0;
    for (const channel of channels) {
      for (let index = at; index < at + windowFrames; index++) {
        total += channel[index] * channel[index];
      }
    }
    levels.push(Math.sqrt(total / (windowFrames * channels.length)));
  }
  return levels.length
    ? levels.reduce((sum, level) => sum + level, 0) / levels.length
    : 0;
}
