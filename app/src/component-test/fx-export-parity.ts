import { AudioChain, BLOCK_FRAMES } from "../audio-mix/chain.ts";
import { renderAudioMixOffline } from "../audio-mix/offline.ts";
import {
  type AudioStage,
  DEFAULT_TIME_SIGNATURE,
} from "../audio-mix/processor.ts";
import { AUDIO_PROCESSORS } from "../audio-mix/processors.ts";
import type { AudioMix } from "../audio-mix/resolve.ts";
import { signal, wavBlob } from "./fx-audio.ts";

// Export-parity checks for audio effects: one clip rendered as the export
// renders it (renderAudioMixOffline, decoding a WAV file at the render's
// rate), against the same input run block by block through a lone
// AudioChain.

export const PARITY_SAMPLE_RATE = 48_000;
// Two seconds at the parity sample rate.
export const PARITY_LENGTH = PARITY_SAMPLE_RATE * 2;

const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };

// A URL for a 16-bit mono WAV of two seconds at the parity sample rate,
// sample by sample.
export function parityWavUrl(
  sampleAt: (index: number, seconds: number) => number,
) {
  return URL.createObjectURL(
    wavBlob(
      signal(PARITY_LENGTH / PARITY_SAMPLE_RATE, PARITY_SAMPLE_RATE, sampleAt),
    ),
  );
}

// One enabled device in a chain.
export function parityStage(
  effectName: string,
  numbers: Record<string, number>,
  switches: Record<string, string> = {},
): AudioStage {
  return { id: effectName, effectName, enabled: true, numbers, switches };
}

// What the export renders of a two-second clip of the WAV at `url` with
// `stages` on it, in mono.
export async function exportClip(url: string, stages: AudioStage[]) {
  const mix: AudioMix = {
    clips: [
      {
        id: "clip",
        mediaId: "sound",
        startSeconds: 0,
        durationSeconds: 2,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: 2,
        effects: [],
        amplitude: 1,
        hasGain: true,
        busId: "bus",
        stages,
      },
    ],
    buses: [{ id: "bus", stages: [] }],
    master: [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: TEMPO.bpm,
    signature: TEMPO.signature,
  };
  const rendered = await renderAudioMixOffline(
    mix,
    [{ id: "sound", previewUrl: url }],
    {
      sampleRate: PARITY_SAMPLE_RATE,
      numberOfChannels: 1,
      startSeconds: 0,
      length: PARITY_LENGTH,
    },
  );
  if (!rendered) {
    throw new Error("The export rendered nothing");
  }
  return rendered[0];
}

// The WAV at `url`, decoded as the export decodes it.
export async function decodeWav(url: string) {
  const context = new OfflineAudioContext(1, 1, PARITY_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(
    await (await fetch(url)).arrayBuffer(),
  );
  return decoded.getChannelData(0);
}

// `input` through a lone chain of `stages`, block by block from timeline
// second 0, for `frames` frames (past the input's end it reads silence).
export function runChain(
  stages: AudioStage[],
  input: Float32Array,
  frames = PARITY_LENGTH,
) {
  const chain = new AudioChain(AUDIO_PROCESSORS, PARITY_SAMPLE_RATE, 1);
  chain.configure({ stages, inputGain: 1, delayFrames: 0 }, TEMPO);
  const direct = new Float32Array(frames);
  const block = [new Float32Array(BLOCK_FRAMES)];
  for (let start = 0; start < frames; start += BLOCK_FRAMES) {
    const count = Math.min(BLOCK_FRAMES, frames - start);
    const source = new Float32Array(BLOCK_FRAMES);
    source.set(input.subarray(start, start + count));
    chain.process([source], block, count, start / PARITY_SAMPLE_RATE);
    direct.set(block[0].subarray(0, count), start);
  }
  return direct;
}

// The largest difference between `a` and `b` read `offset` frames later,
// over the parity length.
export function maxDifference(a: Float32Array, b: Float32Array, offset = 0) {
  let difference = 0;
  for (let index = 0; index < PARITY_LENGTH; index++) {
    difference = Math.max(difference, Math.abs(a[index] - b[index + offset]));
  }
  return difference;
}

// The RMS level over the second half of the parity length, once a filter
// has settled.
export function secondHalfRms(samples: Float32Array) {
  let total = 0;
  for (let index = PARITY_LENGTH / 2; index < PARITY_LENGTH; index++) {
    total += samples[index] * samples[index];
  }
  return Math.sqrt(total / (PARITY_LENGTH / 2));
}

// The gain in dB from `input` to `output` over the second half.
export function secondHalfGainDb(input: Float32Array, output: Float32Array) {
  return 20 * Math.log10(secondHalfRms(output) / secondHalfRms(input));
}
