import { expect, test } from "vitest";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import { AudioChain, type AudioChainSettings, BLOCK_FRAMES } from "./chain.ts";
import { createChainNode } from "./chain-node.ts";
import { CHAIN_WORKLET_URL } from "./chain-worklet-url.ts";
import { renderAudioMix } from "./mix.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";
import type { AudioMix, AudioMixClip } from "./resolve.ts";

// The preview runs audio effect chains in the chain worklet; export renders
// them offline in plain JS (see mix.ts and chain.ts). Both run the same
// DSP, so a signal played through the real worklet in an
// OfflineAudioContext must match the offline render to within
// floating-point noise. Ported from audio-chain-worklet.spec.ts and
// mono-audio.spec.ts.

test("the chain worklet plays a mix as the offline render does", {
  timeout: 30_000,
}, async () => {
  const sampleRate = 48_000;
  const length = sampleRate;
  const toneSeconds = 2;
  const tone = new Float32Array(toneSeconds * sampleRate);
  for (let index = 0; index < tone.length; index++) {
    tone[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
  }
  const clipStart = 0.25;
  const clip: AudioMixClip = {
    id: "tone",
    mediaId: "tone",
    startSeconds: clipStart,
    durationSeconds: 0.5,
    sourceOffsetSeconds: -clipStart,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: toneSeconds,
    effects: [],
    amplitude: 0.5,
    hasGain: true,
    busId: "bus",
    stages: [gainStageAt(0.5, "clip-gain")],
  };
  const mix: AudioMix = {
    clips: [clip],
    buses: [{ id: "bus", stages: [gainStageAt(0.8, "bus-gain")] }],
    master: [gainStageAt(1.5, "master-gain")],
    masterAmplitude: 1.5,
    fromSourceTracks: true,
    bpm: 120,
    signature: { numerator: 4, denominator: 4 },
  };
  const [offline] = renderAudioMix(
    mix,
    new Map([["tone", { sampleRate, channels: [tone] }]]),
    { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
  );

  const context = new OfflineAudioContext(2, length, sampleRate);
  await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
  const tempo = { bpm: 120, signature: mix.signature };
  const transport = { contextTime: 0, timelineSeconds: 0, rate: 1 };
  const node = (stages: AudioChainSettings["stages"]) =>
    createChainNode(context, {
      settings: { stages, inputGain: 1, delayFrames: 0 },
      tempo,
      transport,
    });
  const clipChain = node(clip.stages);
  const bus = node(mix.buses[0].stages);
  const master = node(mix.master);
  // The clip's media plays from its source window as its element would.
  const media = context.createBuffer(1, tone.length, sampleRate);
  media.copyToChannel(tone, 0);
  const source = context.createBufferSource();
  source.buffer = media;
  source.connect(clipChain);
  clipChain.connect(bus);
  bus.connect(master);
  master.connect(context.destination);
  source.start(clipStart, 0, clip.durationSeconds);
  const rendered = (await context.startRendering()).getChannelData(0);

  let difference = 0;
  let peak = 0;
  for (let index = 0; index < length; index++) {
    difference = Math.max(
      difference,
      Math.abs(rendered[index] - offline[index]),
    );
    peak = Math.max(peak, Math.abs(offline[index]));
  }
  // 0.3 × 0.5 × 0.8 × 1.5, below the limiter's knee.
  expect(peak).toBeGreaterThan(0.17);
  expect(difference).toBeLessThan(1e-5);
});

test("the preview's chain worklet renders Mono as export does", {
  timeout: 30_000,
}, async () => {
  const sampleRate = 48_000;
  const length = sampleRate;
  const tempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
  const settings: AudioChainSettings = {
    stages: [
      {
        id: "mono",
        effectName: "Mono",
        enabled: true,
        numbers: { Amount: 0.6 },
        switches: { Source: "Sum" },
      },
    ],
    inputGain: 1,
    delayFrames: 0,
  };
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    left[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    right[index] = 0.3 * Math.sin((2 * Math.PI * 97 * index) / sampleRate);
  }

  // The preview's host: the chain worklet in an offline context.
  const context = new OfflineAudioContext(2, length, sampleRate);
  await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
  const buffer = context.createBuffer(2, length, sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  const sourceNode = context.createBufferSource();
  sourceNode.buffer = buffer;
  const node = createChainNode(context, { channels: 2, settings, tempo });
  sourceNode.connect(node).connect(context.destination);
  sourceNode.start();
  const rendered = await context.startRendering();

  // Export's host: the chain run block by block in JS.
  const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 2);
  chain.configure(settings, tempo);
  const expected = [new Float32Array(length), new Float32Array(length)];
  for (let start = 0; start < length; start += BLOCK_FRAMES) {
    const end = Math.min(length, start + BLOCK_FRAMES);
    chain.process(
      [left.subarray(start, end), right.subarray(start, end)],
      expected.map((channel) => channel.subarray(start, end)),
      end - start,
      start / sampleRate,
    );
  }

  let largest = 0;
  let energy = 0;
  for (let channel = 0; channel < 2; channel++) {
    const actual = rendered.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      largest = Math.max(
        largest,
        Math.abs(actual[index] - expected[channel][index]),
      );
      energy += actual[index] ** 2;
    }
  }
  // Amount 0.6 moves each side toward the other, so they differ less than
  // the input's sides do.
  let sideDifference = 0;
  for (let index = 0; index < length; index++) {
    sideDifference = Math.max(
      sideDifference,
      Math.abs(
        rendered.getChannelData(0)[index] - rendered.getChannelData(1)[index],
      ),
    );
  }

  expect(energy).toBeGreaterThan(1);
  expect(largest).toBeLessThan(1e-6);
  // The input's sides differ by up to 0.8; 40 % of that is left.
  expect(sideDifference).toBeLessThan(0.33);
  expect(sideDifference).toBeGreaterThan(0.25);
});
