import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { CHAIN_WORKLET_URL } from "../../audio-mix/chain-worklet-url.ts";
import {
  GAIN_EFFECT_NAME,
  GAIN_KEY,
  MUTE_KEY,
} from "../../fx/effects/gain/gain.ts";
import { MUTE_ON } from "../../fx/effects/gain/processor.ts";
import {
  clipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../../fx/stack/clip-stacks.ts";
import { createEffect } from "../../fx/stack/ops.ts";
import {
  createDefaultModulation,
  type EffectModulation,
} from "../../fx-modulation-defaults.ts";
import { setAuditionWorkletUrl } from "../../midi-audition.ts";
import { DEFAULT_SYNTH_PARAMS } from "../../midi-clip.ts";
import { createSynthEffect } from "../../midi-effects.ts";
import {
  type ArmedAuditionSession,
  auditionTracks,
  setArmedAuditionSource,
} from "../../recording/armed-audition.ts";

// A paused key sounds through its track's whole stack, and LFOs there keep
// moving on the audio clock with the playhead standing still (#1627).
const TRACK = "track";
const CLIP = "clip";
const trackStack = sourceTrackEffectTrackId(TRACK);

const gain = (db: number, lfo = false, mute = false) => {
  const effect = createEffect(trackStack, GAIN_EFFECT_NAME);
  const modulation = createDefaultModulation(
    GAIN_EFFECT_NAME,
  ) as EffectModulation;
  return {
    ...effect,
    parameters: effect.parameters.map((parameter) => {
      if (parameter.key === GAIN_KEY) {
        return { ...parameter, value: String(db), numericValue: db };
      }
      return parameter.key === MUTE_KEY && mute
        ? { ...parameter, value: MUTE_ON, numericValue: 1 }
        : parameter;
    }),
    ...(lfo
      ? {
          modulation: {
            ...modulation,
            enabled: true,
            mode: "lfo" as const,
            lfo: {
              ...modulation.lfo,
              shape: "Sine" as const,
              sync: false,
              rate: 2,
              depth: 1,
              phase: 0,
              parameters: [GAIN_KEY],
            },
          },
        }
      : {}),
  };
};

// Keeps the key's attack and sustain out of what the level shows.
const synth = createSynthEffect(trackStack, {
  ...DEFAULT_SYNTH_PARAMS,
  attack: 0,
  decay: 0,
  sustain: 1,
  release: 0,
});

const hear = (effects: unknown[]) => {
  setArmedAuditionSource(
    {
      clips: [],
      lanes: [],
      mediaItems: [],
      sourceTracks: [{ id: TRACK }],
      sourceSpans: [{ id: CLIP, sourceTrackId: TRACK, startQ: 0, notes: [] }],
      effects: [synth, ...effects],
      bpm: 120,
      signatureId: "4/4",
    } as unknown as ArmedAuditionSession,
    () => 8,
  );
};

// Tees what reaches the audition context's speakers into an analyser, from
// before the first test, as a track's chain connects to them once.
let level: () => number;
beforeAll(() => {
  const connect = AudioNode.prototype.connect;
  let analyser: AnalyserNode | undefined;
  vi.spyOn(AudioNode.prototype, "connect").mockImplementation(function (
    this: AudioNode,
    ...args: unknown[]
  ) {
    if (args[0] instanceof AudioDestinationNode) {
      if (analyser?.context !== this.context) {
        analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
      }
      connect.call(this, analyser as never);
    }
    return connect.apply(this, args as Parameters<typeof connect>) as never;
  });
  level = () => {
    const data = new Float32Array(analyser?.fftSize ?? 0);
    analyser?.getFloatTimeDomainData(data);
    return data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  };
});

afterAll(() => {
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function levelsOverASecond() {
  const levels: number[] = [];
  for (let step = 0; step < 20; step++) {
    await wait(50);
    levels.push(level());
  }
  return levels;
}

beforeEach(async () => {
  setAuditionWorkletUrl(CHAIN_WORKLET_URL);
  // An AudioContext starts once the page has had a gesture.
  await userEvent.click(document.body);
});

test("a paused key sounds through its track's stack", async () => {
  hear([gain(0)]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.01);
  const unity = level();

  hear([gain(-24)]);
  await expect.poll(() => level()).toBeLessThan(unity / 4);
  expect(level()).toBeGreaterThan(0);
  voice?.release();
});

test("a track's muted stack silences a paused key", async () => {
  hear([gain(0, false, true)]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await wait(300);
  expect(level()).toBeLessThan(0.001);
  voice?.release();
});

test("an LFO keeps sweeping under a key held with the playhead paused", async () => {
  hear([gain(-6, true)]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.001);
  const levels = await levelsOverASecond();
  voice?.release();
  expect(Math.max(...levels)).toBeGreaterThan(Math.min(...levels) * 1.5);
});

test("without an LFO the same held key stays level", async () => {
  hear([gain(-6)]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.001);
  await wait(100);
  const levels = await levelsOverASecond();
  voice?.release();
  expect(Math.max(...levels)).toBeLessThan(Math.min(...levels) * 1.1);
});

// A session whose audio comes from a layer clip playing the MIDI clip (#1635).
const LANE = "lane";
const OTHER_LANE = "other-lane";
const LAYER_CLIP = "layer-clip";
const OTHER_LAYER_CLIP = "other-layer-clip";
const layerClip = (id: string, laneId: string) => ({
  id,
  laneId,
  sourceSpanId: CLIP,
  sourceTrackId: TRACK,
  mediaPath: "",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceSpanOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 2,
});
const hearThroughLayer = (
  effects: unknown[],
  clips = [layerClip(LAYER_CLIP, LANE)],
) => {
  setArmedAuditionSource(
    {
      clips,
      lanes: [{ id: LANE }, { id: OTHER_LANE }],
      mediaItems: [],
      sourceTracks: [{ id: TRACK }],
      sourceSpans: [
        {
          id: CLIP,
          sourceTrackId: TRACK,
          mediaPath: "",
          startQ: 0,
          durationSeconds: 2,
          trimStartSeconds: 0,
          notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
        },
      ],
      effects: [synth, ...effects],
      bpm: 120,
      signatureId: "4/4",
    } as unknown as ArmedAuditionSession,
    () => 0,
  );
};

const onStack = (stackId: string, effect: ReturnType<typeof gain>) => ({
  ...effect,
  trackId: stackId,
});

test("a paused key sounds through its layer's stack when the mix plays through it", async () => {
  hearThroughLayer([gain(0), onStack(LANE, gain(0))]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.01);
  // Past the moment the note reached the speakers, so this is its full level.
  await wait(300);
  const unity = level();

  hearThroughLayer([gain(0), onStack(LANE, gain(-24))]);
  await expect.poll(() => level()).toBeLessThan(unity / 4);
  expect(level()).toBeGreaterThan(0);
  voice?.release();
});

test("a paused key sounds through its layer clip's stack when the mix plays through it", async () => {
  const stack = clipEffectTrackId(LAYER_CLIP);
  hearThroughLayer([gain(0), onStack(stack, gain(0))]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.01);

  hearThroughLayer([gain(0), onStack(stack, gain(0, false, true))]);
  await expect.poll(() => level()).toBeLessThan(0.001);
  voice?.release();
});

// Two layer clips play the MIDI clip on different layers, and the mix sums them
// (#1646). Well under the limiter, so the sum shows in the level.
test("a paused key sums every layer clip overlapping at the playhead", async () => {
  const quiet = gain(-12);
  const both = [
    layerClip(LAYER_CLIP, LANE),
    layerClip(OTHER_LAYER_CLIP, OTHER_LANE),
  ];
  hearThroughLayer([quiet]);
  const voice = auditionTracks(new Set([TRACK]), 69, undefined);
  await expect.poll(() => level(), { timeout: 5000 }).toBeGreaterThan(0.001);
  await wait(300);
  const alone = level();

  hearThroughLayer([quiet], both);
  await expect.poll(() => level()).toBeGreaterThan(alone * 1.7);
  expect(level()).toBeLessThan(alone * 2.3);

  // Each chain stays its own: muting one leaves the other's level.
  const muted = onStack(
    clipEffectTrackId(OTHER_LAYER_CLIP),
    gain(0, false, true),
  );
  hearThroughLayer([quiet, muted], both);
  await expect.poll(() => level()).toBeLessThan(alone * 1.3);
  expect(level()).toBeGreaterThan(alone * 0.7);
  voice?.release();
});
