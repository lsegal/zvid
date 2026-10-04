import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { gainToAmplitude } from "../fx/effects/gain/gain.ts";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import { BLOCK_FRAMES, createBuffers } from "./chain.ts";
import {
  type ChainMessage,
  type ChainNodeOptions,
  type ChainReport,
  TRANSIENT_REPORT_RATE,
} from "./chain-node.ts";
import {
  CLIP,
  CLOCK,
  DELAY,
  ONE_POLE,
  TEST_PROCESSORS,
  testStage,
} from "./chain-test-utils.ts";
import type { chainWorkletProcessor } from "./chain-worklet.ts";
import {
  audioMixTempo,
  audioMixTiming,
  ClipReader,
  type DecodedAudio,
  renderAudioMix,
  softLimit,
} from "./mix.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import type { AudioMix, AudioMixClip } from "./resolve.ts";

// The preview's worklet host, outside a browser: the chain worklet's
// processor class, fed the clips' media as their elements would play it, a
// render quantum at a time, with the nodes summed as Web Audio sums them.
// Its output must match the offline render export uses.

const SAMPLE_RATE = 8000;
const CHANNELS = 2;

type WorkletProcessor = InstanceType<ReturnType<typeof chainWorkletProcessor>>;
type Scope = typeof globalThis & {
  sampleRate: number;
  currentTime: number;
  AudioWorkletProcessor: unknown;
  registerProcessor: unknown;
};
const scope = globalThis as Scope;

let createProcessor: (options: ChainNodeOptions) => WorkletProcessor;

before(async () => {
  scope.sampleRate = SAMPLE_RATE;
  scope.currentTime = 0;
  scope.AudioWorkletProcessor = class {
    posted: unknown[] = [];
    port = {
      onmessage: null,
      postMessage: (message: unknown) => {
        this.posted.push(message);
      },
    };
  };
  scope.registerProcessor = () => {};
  const worklet = await import("./chain-worklet.ts");
  const Processor = worklet.chainWorkletProcessor(TEST_PROCESSORS);
  createProcessor = (options) => new Processor({ processorOptions: options });
});

function send(processor: WorkletProcessor, message: ChainMessage) {
  (
    processor.port as unknown as {
      onmessage: (event: { data: ChainMessage }) => void;
    }
  ).onmessage({ data: message });
}

function posted(processor: WorkletProcessor) {
  return (processor as unknown as { posted: ChainReport[] }).posted;
}

function tone(frequency: number, peak: number, seconds = 2): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] =
      peak * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

// Decaying noise bursts every quarter second, for Transient to hear.
function hits(peak: number, seconds = 2): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let seed = 7;
  for (let at = 0.15; at < seconds; at += 0.25) {
    const start = Math.round(at * SAMPLE_RATE);
    for (let index = 0; index < 300 && start + index < data.length; index++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[start + index] =
        ((seed / 0xffffffff) * 2 - 1) * peak * (1 - index / 300);
    }
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function clip(id: string, stages = [gainStageAt(1)]): AudioMixClip {
  return {
    id,
    mediaId: id,
    startSeconds: 0.1,
    durationSeconds: 0.8,
    sourceOffsetSeconds: -0.1,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    effects: [],
    amplitude: 1,
    hasGain: true,
    busId: "bus",
    stages,
  };
}

// Plays `mix` through worklet processors from timeline second 0, the
// media `ahead` of the playhead by the mix's latency, as the preview does.
function playThroughWorklet(
  mix: AudioMix,
  media: ReadonlyMap<string, DecodedAudio>,
  length: number,
) {
  const timing = audioMixTiming(mix, SAMPLE_RATE, TEST_PROCESSORS);
  const ahead = timing.latencyFrames / SAMPLE_RATE;
  const tempo = audioMixTempo(mix);
  const transport = { contextTime: 0, timelineSeconds: ahead, rate: 1 };
  const node = (settings: ChainNodeOptions["settings"]) =>
    createProcessor({ channels: CHANNELS, settings, tempo, transport });
  const master = node({ stages: mix.master, inputGain: 1, delayFrames: 0 });
  const buses = new Map(
    mix.buses.map((bus) => [
      bus.id,
      node({ stages: bus.stages, inputGain: 1, delayFrames: 0 }),
    ]),
  );
  const voices = mix.clips.map((mixClip) => ({
    busId: mixClip.busId,
    reader: new ClipReader(
      mixClip,
      media.get(mixClip.mediaId) as DecodedAudio,
      mix.bpm,
      SAMPLE_RATE,
      ahead,
      TEST_PROCESSORS,
    ),
    node: node({
      stages: mixClip.stages,
      inputGain: mixClip.hasGain ? 1 : 0,
      delayFrames: timing.clipDelayFrames.get(mixClip.id) ?? 0,
    }),
  }));
  // A parameter message arrives as it would after creation: unchanged
  // settings change nothing.
  send(master, {
    type: "configure",
    settings: { stages: mix.master, inputGain: 1, delayFrames: 0 },
    tempo,
  });

  const output = new Float32Array(length);
  const element = createBuffers(CHANNELS, BLOCK_FRAMES);
  const quantum = () => createBuffers(CHANNELS, BLOCK_FRAMES);
  for (let block = 0; block < length; block += BLOCK_FRAMES) {
    scope.currentTime = block / SAMPLE_RATE;
    const busInputs = new Map(mix.buses.map((bus) => [bus.id, quantum()]));
    for (const voice of voices) {
      voice.reader.read(element, block, BLOCK_FRAMES);
      const out = quantum();
      voice.node.process([element], [out]);
      const sum = busInputs.get(voice.busId) as Float32Array[];
      out.forEach((data, channel) => {
        data.forEach((sample, index) => {
          sum[channel][index] += sample;
        });
      });
    }
    const masterInput = quantum();
    for (const [busId, busNode] of buses) {
      const out = quantum();
      busNode.process([busInputs.get(busId) as Float32Array[]], [out]);
      out.forEach((data, channel) => {
        data.forEach((sample, index) => {
          masterInput[channel][index] += sample;
        });
      });
    }
    const out = quantum();
    master.process([masterInput], [out]);
    for (
      let index = 0;
      index < BLOCK_FRAMES && block + index < length;
      index++
    ) {
      output[block + index] = softLimit(out[0][index]);
    }
  }
  return output;
}

function largestDifference(a: Float32Array, b: Float32Array) {
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference = Math.max(difference, Math.abs(a[index] - b[index]));
  }
  return difference;
}

describe("chain worklet", () => {
  it("plays a mix of reference processors as the offline render does", () => {
    const mix: AudioMix = {
      clips: [
        clip("a", [
          gainStageAt(gainToAmplitude(-3)),
          testStage(ONE_POLE, { Cutoff: 800 }),
          testStage(DELAY, { Frames: 40 }),
        ]),
        clip("b"),
      ],
      buses: [{ id: "bus", stages: [testStage(CLIP)] }],
      master: [
        testStage(ONE_POLE, { Cutoff: 2000 }),
        gainStageAt(gainToAmplitude(-2)),
        testStage(CLOCK, {}, { enabled: false }),
      ],
      masterAmplitude: gainToAmplitude(-2),
      fromSourceTracks: true,
      bpm: 120,
      signature: DEFAULT_TIME_SIGNATURE,
    };
    const media = new Map([
      ["a", tone(220, 0.4)],
      ["b", tone(330, 0.3)],
    ]);
    const length = SAMPLE_RATE;
    const [offline] = renderAudioMix(
      mix,
      media,
      { sampleRate: SAMPLE_RATE, numberOfChannels: 1, startSeconds: 0, length },
      TEST_PROCESSORS,
    );
    const preview = playThroughWorklet(mix, media, length);
    assert.ok(Math.max(...offline) > 0.3);
    assert.ok(
      largestDifference(preview, offline) < 1e-6,
      `${largestDifference(preview, offline)}`,
    );
  });

  it("tells processors the timeline time of what they play", () => {
    const mix: AudioMix = {
      clips: [clip("a", [testStage(CLOCK)])],
      buses: [{ id: "bus", stages: [] }],
      master: [testStage(DELAY, { Frames: 24 })],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 120,
      signature: DEFAULT_TIME_SIGNATURE,
    };
    const media = new Map([["a", tone(220, 0.4)]]);
    const length = SAMPLE_RATE / 2;
    const [offline] = renderAudioMix(
      mix,
      media,
      { sampleRate: SAMPLE_RATE, numberOfChannels: 1, startSeconds: 0, length },
      TEST_PROCESSORS,
    );
    const preview = playThroughWorklet(mix, media, length);
    assert.ok(largestDifference(preview, offline) < 1e-6);
  });

  it("plays modulated stages as the offline render does", () => {
    const cutoff = { key: "Cutoff", min: 20, max: 4000, taper: "log" as const };
    const mix: AudioMix = {
      clips: [
        clip("a", [
          {
            ...gainStageAt(1),
            modulation: {
              mode: "lfo",
              shape: "Triangle",
              sync: true,
              rate: 1,
              syncRate: "1/8",
              depth: 0.8,
              phase: 45,
              parameters: [{ key: "Gain", min: -68, max: 10 }],
            },
          },
          {
            ...testStage(ONE_POLE, { Cutoff: 300 }, { id: "filter" }),
            modulation: {
              mode: "transient",
              motion: "Bounce",
              reactivity: 1,
              lengthFrames: 12,
              parameters: [cutoff],
            },
          },
        ]),
      ],
      buses: [{ id: "bus", stages: [] }],
      master: [
        {
          ...testStage(ONE_POLE, { Cutoff: 1500 }, { id: "master-filter" }),
          modulation: {
            mode: "lfo",
            shape: "Random",
            sync: false,
            rate: 6,
            syncRate: "1/4",
            depth: 1,
            phase: 0,
            parameters: [cutoff],
          },
        },
      ],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 128,
      signature: DEFAULT_TIME_SIGNATURE,
    };
    const media = new Map([["a", hits(0.6)]]);
    const length = SAMPLE_RATE;
    const [offline] = renderAudioMix(
      mix,
      media,
      { sampleRate: SAMPLE_RATE, numberOfChannels: 1, startSeconds: 0, length },
      TEST_PROCESSORS,
    );
    const unmodulated = renderAudioMix(
      {
        ...mix,
        clips: mix.clips.map((mixClip) => ({
          ...mixClip,
          stages: mixClip.stages.map(({ modulation: _, ...stage }) => stage),
        })),
        master: mix.master.map(({ modulation: _, ...stage }) => stage),
      },
      media,
      { sampleRate: SAMPLE_RATE, numberOfChannels: 1, startSeconds: 0, length },
      TEST_PROCESSORS,
    )[0];
    const preview = playThroughWorklet(mix, media, length);
    assert.ok(largestDifference(offline, unmodulated) > 0.01);
    assert.ok(
      largestDifference(preview, offline) < 1e-6,
      `${largestDifference(preview, offline)}`,
    );
  });

  it("drops its state on a reset", () => {
    const processor = createProcessor({
      channels: 1,
      settings: {
        stages: [testStage(ONE_POLE, { Cutoff: 10 })],
        inputGain: 1,
        delayFrames: 0,
      },
      tempo: { bpm: 120, signature: DEFAULT_TIME_SIGNATURE },
    });
    const loud = [new Float32Array(BLOCK_FRAMES).fill(1)];
    const out = [new Float32Array(BLOCK_FRAMES)];
    processor.process([loud], [out]);
    processor.process([[new Float32Array(BLOCK_FRAMES)]], [out]);
    assert.ok(out[0][0] > 0);
    send(processor, { type: "reset" });
    processor.process([[new Float32Array(BLOCK_FRAMES)]], [out]);
    assert.equal(out[0][0], 0);
  });

  it("reports watched Transient levels, about TRANSIENT_REPORT_RATE times a second", () => {
    const transient = {
      mode: "transient" as const,
      motion: "Bounce" as const,
      reactivity: 1,
      lengthFrames: 12,
      parameters: [{ key: "Cutoff", min: 20, max: 4000 }],
    };
    const make = (watch?: string[]) =>
      createProcessor({
        channels: 1,
        settings: {
          stages: [
            {
              ...testStage(ONE_POLE, { Cutoff: 300 }, { id: "filter" }),
              modulation: transient,
            },
            {
              ...testStage(ONE_POLE, { Cutoff: 900 }, { id: "other" }),
              modulation: transient,
            },
            testStage(ONE_POLE, { Cutoff: 600 }, { id: "plain" }),
          ],
          inputGain: 1,
          delayFrames: 0,
        },
        tempo: { bpm: 120, signature: DEFAULT_TIME_SIGNATURE },
        transport: { contextTime: 0, timelineSeconds: 0, rate: 1 },
        ...(watch ? { watch } : {}),
      });
    const play = (processor: WorkletProcessor, seconds: number) => {
      const [data] = hits(0.6, seconds).channels;
      const out = [new Float32Array(BLOCK_FRAMES)];
      for (let block = 0; block + BLOCK_FRAMES <= data.length; ) {
        scope.currentTime = block / SAMPLE_RATE;
        processor.process(
          [[data.subarray(block, block + BLOCK_FRAMES)]],
          [out],
        );
        block += BLOCK_FRAMES;
      }
    };

    // Nothing is reported until a stage is watched.
    const unwatched = make();
    play(unwatched, 1);
    assert.deepEqual(posted(unwatched), []);

    const processor = make(["filter", "plain"]);
    play(processor, 2);
    const reports = posted(processor);
    assert.ok(
      reports.length >= TRANSIENT_REPORT_RATE * 2 - 2 &&
        reports.length <= TRANSIENT_REPORT_RATE * 2,
      `${reports.length} reports`,
    );
    // Only the watched stage Transient modulates is reported.
    for (const report of reports) {
      assert.equal(report.type, "transients");
      assert.deepEqual(
        report.levels.map(([id]) => id),
        ["filter"],
      );
    }
    const levels = reports.map((report) => report.levels[0][1]);
    assert.ok(Math.max(...levels) > 0.1, `${Math.max(...levels)}`);
    assert.ok(levels.some((level) => level === 0));

    // Unwatching stops the reports.
    send(processor, { type: "watch", ids: [] });
    reports.length = 0;
    play(processor, 0.5);
    assert.deepEqual(reports, []);
  });
});
