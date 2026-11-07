import { expect, test } from "vitest";
import { GRANULAR_KEYS } from "../fx/effects/granular/granular.ts";
import { CUTOFF_KEY } from "../fx/effects/synth/synth.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_SYNTH_PARAMS,
  type MidiInstrument,
} from "../midi-clip.ts";
import type { MidiModulation } from "./midi-modulation.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import { renderSynthClip } from "./synth.ts";

const SAMPLE_RATE = 48_000;
const SECONDS = 2;

// A 1 Hz square LFO on the Cutoff: open for half a second, shut for the next.
const cutoffLfo: MidiModulation = {
  mode: "lfo",
  seed: "effect",
  shape: "Square",
  sync: false,
  rate: 1,
  syncRate: "1/8",
  depth: 2,
  phase: 0,
  parameters: [{ key: CUTOFF_KEY, min: 20, max: 20_000, taper: "log" }],
};

async function render(instrument: MidiInstrument) {
  const { channels } = await renderSynthClip(
    {
      notes: [{ pitch: 48, start: 0, length: SECONDS, velocity: 127 }],
      instrument,
      durationSeconds: SECONDS,
      modulationClock: { offsetSeconds: 0, signature: DEFAULT_TIME_SIGNATURE },
    },
    60,
    SAMPLE_RATE,
  );
  return channels[0];
}

function rms(samples: Float32Array, from: number, to: number) {
  const slice = samples.subarray(from * SAMPLE_RATE, to * SAMPLE_RATE);
  return Math.sqrt(
    slice.reduce((sum, sample) => sum + sample * sample, 0) / slice.length,
  );
}

// How much brighter the LFO's open half-cycle is than its shut one, measured by
// how much the signal moves from one sample to the next.
function openOverShut(samples: Float32Array) {
  const edges = samples.map((sample, index) =>
    index ? sample - samples[index - 1] : 0,
  );
  return rms(edges, 0.1, 0.45) / rms(edges, 0.6, 0.95);
}

const synthParams = {
  ...DEFAULT_SYNTH_PARAMS,
  wave: "sawtooth" as const,
  cutoff: 800,
  attack: 0,
  decay: 0,
  sustain: 1,
  release: 0,
};

test("a Synth's LFO sweeps its Cutoff in the render playback and export share", async () => {
  const swept = await render({
    kind: "synth",
    params: synthParams,
    modulation: cutoffLfo,
  });
  expect(openOverShut(swept)).toBeGreaterThan(2);
  const steady = await render({ kind: "synth", params: synthParams });
  expect(openOverShut(steady)).toBeCloseTo(1, 1);
});

test("a Granular's LFO sweeps its Cutoff in the render too", async () => {
  const params = {
    ...DEFAULT_GRANULAR_PARAMS,
    cutoff: 800,
    attack: 0,
    release: 0,
  };
  const swept = await render({
    kind: "granular",
    params,
    modulation: {
      ...cutoffLfo,
      parameters: [
        { key: GRANULAR_KEYS.cutoff, min: 20, max: 20_000, taper: "log" },
      ],
    },
  });
  expect(openOverShut(swept)).toBeGreaterThan(1.5);
});
