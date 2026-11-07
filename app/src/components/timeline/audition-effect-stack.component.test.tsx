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
  sourceClipEffectTrackId,
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
const clipStack = sourceClipEffectTrackId(CLIP);
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
const synth = createSynthEffect(clipStack, {
  ...DEFAULT_SYNTH_PARAMS,
  attack: 0,
  decay: 0,
  sustain: 1,
  release: 0,
});

const hear = (effects: unknown[]) => {
  setArmedAuditionSource(
    {
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
