import { createChainNode } from "../audio-mix/chain-node.ts";
import { CHAIN_WORKLET_URL } from "../audio-mix/chain-worklet-url.ts";
import { renderAudioMix } from "../audio-mix/mix.ts";
import type { AudioStage, AudioStageSettings } from "../audio-mix/processor.ts";
import type { AudioMix, AudioMixClip } from "../audio-mix/resolve.ts";
import { gainStageAt } from "../fx/effects/gain/processor.ts";

// Compares a clip → bus → master mix in the two hosts the app runs it in:
// the export's offline render (renderAudioMix, which compensates the
// stages' latency) and the preview's chain worklets, one per chain, wired
// clip into bus into master in an offline context.

// An effect stage with `numbers` as its knobs, for mixes built by hand.
export function effectStage(
  id: string,
  effectName: string,
  numbers: AudioStageSettings["numbers"],
): AudioStage {
  return { id, effectName, enabled: true, numbers, switches: {} };
}

const SAMPLE_RATE = 48_000;
const MEDIA_SECONDS = 2;
const CLIP_START = 0.1;
const CLIP_SECONDS = 0.8;

// Hits five times a second at 48 kHz: a 300 Hz tone decaying over 40 ms.
function busHits() {
  const hits = new Float32Array(MEDIA_SECONDS * SAMPLE_RATE);
  for (let index = 0; index < hits.length; index++) {
    const age = (index % (SAMPLE_RATE / 5)) / SAMPLE_RATE;
    hits[index] =
      0.3 *
      Math.sin((2 * Math.PI * 300 * index) / SAMPLE_RATE) *
      Math.exp(-age / 0.04);
  }
  return hits;
}

export type BusHostComparison = {
  // The largest difference between the two hosts, after `latencyFrames`.
  difference: number;
  // The largest change the offline render made to the clip's plain hits.
  shaped: number;
  // The offline render's loudest sample.
  loudest: number;
};

// Renders one second of hits played by a clip from 0.1 s to 0.9 s, through
// a 0 dB Gain and `clipStages` on the clip and `busStages` on its bus, in
// both hosts. The worklet chains run uncompensated, so the preview comes
// out `latencyFrames` late; the comparison shifts it back.
export async function compareBusHosts(
  clipStages: AudioStage[],
  busStages: AudioStage[],
  latencyFrames = 0,
): Promise<BusHostComparison> {
  const sampleRate = SAMPLE_RATE;
  const length = sampleRate;
  const hits = busHits();
  const clip: AudioMixClip = {
    id: "hits",
    mediaId: "hits",
    startSeconds: CLIP_START,
    durationSeconds: CLIP_SECONDS,
    sourceOffsetSeconds: -CLIP_START,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: MEDIA_SECONDS,
    effects: [],
    amplitude: 1,
    hasGain: true,
    busId: "bus",
    stages: [gainStageAt(1, "clip-gain"), ...clipStages],
  };
  const mix: AudioMix = {
    clips: [clip],
    buses: [{ id: "bus", stages: busStages }],
    master: [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: 120,
    signature: { numerator: 4, denominator: 4 },
  };
  // Export's host: the offline render.
  const [offline] = renderAudioMix(
    mix,
    new Map([["hits", { sampleRate, channels: [hits] }]]),
    { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
  );

  // The preview's host: the chain worklet in an offline context.
  const context = new OfflineAudioContext(2, length, sampleRate);
  await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
  const tempo = { bpm: mix.bpm, signature: mix.signature };
  const transport = { contextTime: 0, timelineSeconds: 0, rate: 1 };
  const node = (stages: AudioStage[]) =>
    createChainNode(context, {
      settings: { stages, inputGain: 1, delayFrames: 0 },
      tempo,
      transport,
    });
  const clipChain = node(clip.stages);
  const bus = node(busStages);
  const master = node(mix.master);
  const media = context.createBuffer(1, hits.length, sampleRate);
  media.copyToChannel(hits, 0);
  const source = context.createBufferSource();
  source.buffer = media;
  source.connect(clipChain);
  clipChain.connect(bus);
  bus.connect(master);
  master.connect(context.destination);
  source.start(CLIP_START, 0, CLIP_SECONDS);
  const rendered = (await context.startRendering()).getChannelData(0);

  let difference = 0;
  let shaped = 0;
  let loudest = 0;
  for (let index = 0; index < length - latencyFrames; index++) {
    difference = Math.max(
      difference,
      Math.abs(rendered[index + latencyFrames] - offline[index]),
    );
    loudest = Math.max(loudest, Math.abs(offline[index]));
    // How far the render is from the clip's plain hits, so an effect that
    // did nothing in both hosts can't pass.
    const seconds = index / sampleRate;
    const dry =
      seconds >= CLIP_START && seconds < CLIP_START + CLIP_SECONDS
        ? hits[index - Math.round(CLIP_START * sampleRate)]
        : 0;
    shaped = Math.max(shaped, Math.abs(offline[index] - dry));
  }
  return { difference, shaped, loudest };
}
