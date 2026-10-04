import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioChain, BLOCK_FRAMES } from "../../../audio-mix/chain.ts";
import type {
  AudioEffectProcessor,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor as gain } from "../gain/processor.ts";
import { eqResponseDb } from "./eq.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = {
  "Low Freq": 100,
  "Low Gain": 0,
  "Mid Freq": 1000,
  "Mid Gain": 0,
  "Mid Q": 1,
  "High Freq": 8000,
  "High Gain": 0,
};

type EqNumbers = Partial<typeof DEFAULTS>;

function eq(numbers: EqNumbers = {}, enabled = true): AudioStage {
  return {
    id: "eq",
    effectName: "EQ",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: {},
  };
}

function sine(frequency: number, seconds = 1, amplitude = 0.5) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return samples;
}

function noise(seconds = 0.5) {
  // A fixed LCG, so the signal is the same every run.
  let seed = 12345;
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (seed / 2 ** 32 - 0.5) * 0.8;
  }
  return samples;
}

function impulse(frames = 4096) {
  const samples = new Float32Array(frames);
  samples[0] = 1;
  return samples;
}

// Renders `input` (mono) through a chain of `stages`, applying `changes`
// at their frames, block by block like the hosts.
function render(
  stages: readonly AudioStage[],
  input: Float32Array,
  changes: { frame: number; stages: readonly AudioStage[] }[] = [],
) {
  const chain = new AudioChain(registry, RATE, 1);
  chain.configure({ stages, inputGain: 1, delayFrames: 0 }, TEMPO);
  const output = new Float32Array(input.length);
  const block = [new Float32Array(BLOCK_FRAMES)];
  const pending = [...changes];
  for (let start = 0; start < input.length; start += BLOCK_FRAMES) {
    while (pending.length && pending[0].frame <= start) {
      const change = pending.shift();
      if (change) {
        chain.configure(
          { stages: change.stages, inputGain: 1, delayFrames: 0 },
          TEMPO,
        );
      }
    }
    const frames = Math.min(BLOCK_FRAMES, input.length - start);
    const source = new Float32Array(BLOCK_FRAMES);
    source.set(input.subarray(start, start + frames));
    chain.process([source], block, frames, start / RATE);
    output.set(block[0].subarray(0, frames), start);
  }
  return output;
}

// RMS level in dB over the second half, past the filters' settling.
function levelDb(samples: Float32Array) {
  let sum = 0;
  const from = Math.floor(samples.length / 2);
  for (let i = from; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return 10 * Math.log10(sum / (samples.length - from));
}

function gainDb(numbers: EqNumbers, frequency: number) {
  const input = sine(frequency);
  return levelDb(render([eq(numbers)], input)) - levelDb(input);
}

function maxDifference(a: Float32Array, b: Float32Array) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

const settings = (numbers: EqNumbers) => {
  const all = { ...DEFAULTS, ...numbers };
  return {
    lowFreq: all["Low Freq"],
    lowGain: all["Low Gain"],
    midFreq: all["Mid Freq"],
    midGain: all["Mid Gain"],
    midQ: all["Mid Q"],
    highFreq: all["High Freq"],
    highGain: all["High Gain"],
  };
};

describe("EQ stage at 0 dB", () => {
  it("passes sine, noise and an impulse through unchanged", () => {
    for (const input of [sine(440), noise(), impulse()]) {
      assert.ok(maxDifference(render([eq()], input), input) <= 1e-6);
    }
  });
});

describe("EQ stage low shelf", () => {
  it("raises a 50 Hz sine by about 12 dB at +12 dB", () => {
    near(gainDb({ "Low Gain": 12 }, 50), 12, 1);
  });

  it("leaves 5 kHz within 0.5 dB", () => {
    near(gainDb({ "Low Gain": 12 }, 5000), 0, 0.5);
  });
});

describe("EQ stage high shelf", () => {
  it("raises a sine well above its corner by about 12 dB at +12 dB", () => {
    near(gainDb({ "High Gain": 12 }, 18_000), 12, 1);
  });

  it("leaves 100 Hz within 0.5 dB", () => {
    near(gainDb({ "High Gain": 12 }, 100), 0, 0.5);
  });

  it("cuts symmetrically", () => {
    near(gainDb({ "High Gain": -12 }, 18_000), -12, 1);
  });
});

describe("EQ stage mid peak", () => {
  it("boosts at its center frequency by its gain", () => {
    near(gainDb({ "Mid Gain": 6 }, 1000), 6, 0.1);
  });

  it("is within 0.5 dB at a tenth and ten times the center with Q 1", () => {
    near(gainDb({ "Mid Gain": 6 }, 100), 0, 0.5);
    near(gainDb({ "Mid Gain": 6 }, 10_000), 0, 0.5);
  });

  it("matches its analytic response with every band set", () => {
    const numbers = { "Low Gain": -9, "Mid Gain": 4, "High Gain": 7 };
    for (const frequency of [60, 1000, 12_000]) {
      near(
        gainDb(numbers, frequency),
        eqResponseDb(settings(numbers), frequency, RATE),
        0.2,
      );
    }
  });
});

describe("EQ stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    const input = noise();
    assert.deepEqual(
      render([eq({ "Low Gain": 12, "Mid Gain": -8 }, false)], input),
      input,
    );
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise();
    const output = render([eq({ "Low Gain": 12 })], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    assert.deepEqual(
      output.subarray(BLOCK_FRAMES * 10),
      input.subarray(BLOCK_FRAMES * 10),
    );
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const input = sine(50);
    const half = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const both = render([eq({ "Low Gain": 12 }), half], input);
    near(
      levelDb(both) - levelDb(input),
      gainDb({ "Low Gain": 12 }, 50) - 6,
      0.1,
    );
  });
});

describe("EQ stage parameter changes", () => {
  it("ramps a jump to +15 dB instead of stepping", () => {
    const input = sine(50);
    const at = BLOCK_FRAMES * 100;
    const output = render([eq()], input, [
      { frame: at, stages: [eq({ "Low Gain": 15 })] },
    ]);
    const stepped = render([eq({ "Low Gain": 15 })], input);
    // The largest sample-to-sample change around the edit stays within that
    // of the steady boosted sine, which an instant coefficient jump of a
    // resonant shelf would exceed.
    const maxStep = (samples: Float32Array, from: number, to: number) => {
      let max = 0;
      for (let i = from; i < to; i++) {
        max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
      }
      return max;
    };
    const bound = maxStep(stepped, RATE / 2, RATE - 1) * 1.05;
    assert.ok(maxStep(output, at - 64, at + RATE * 0.05) <= bound);
    near(levelDb(output), levelDb(stepped), 0.05);
  });

  it("sweeps a frequency without discontinuities", () => {
    const input = sine(200);
    const output = render([eq({ "Mid Gain": 12, "Mid Freq": 100 })], input, [
      {
        frame: BLOCK_FRAMES * 50,
        stages: [eq({ "Mid Gain": 12, "Mid Freq": 400 })],
      },
    ]);
    // A 200 Hz sine boosted by at most 12 dB moves by at most this much
    // per sample, ramp or not.
    const bound = (2 * Math.PI * 200 * 0.5 * 10 ** (12 / 20)) / RATE;
    for (let i = 0; i < output.length - 1; i++) {
      assert.ok(Math.abs(output[i + 1] - output[i]) <= bound * 1.1, `${i}`);
    }
  });
});

// Runs `dsp` directly, two channels in host-sized blocks, with `numbers`
// ramping in from `from` over the first two blocks, then holding.
function renderDirect(
  dsp: AudioEffectProcessor,
  input: Float32Array,
  numbers: Record<string, number>,
  switches: Record<string, string>,
  from: Record<string, number> = numbers,
) {
  const output = new Float32Array(input.length * 2);
  for (let start = 0; start < input.length; start += BLOCK_FRAMES) {
    const frames = Math.min(BLOCK_FRAMES, input.length - start);
    const block = start / BLOCK_FRAMES;
    const left = input.slice(start, start + frames);
    const right = left.map((sample) => -0.5 * sample);
    const out = [new Float32Array(frames), new Float32Array(frames)];
    const ramping = (key: string) =>
      block < 2 && from[key] !== undefined && from[key] !== numbers[key];
    const valueAt = (key: string, frame: number) =>
      ramping(key)
        ? from[key] +
          ((numbers[key] - from[key]) * (block * BLOCK_FRAMES + frame + 1)) /
            (2 * BLOCK_FRAMES)
        : (numbers[key] ?? 0);
    const params: AudioParameterBlock = {
      number: (key) =>
        Float32Array.from({ length: frames }, (_, frame) =>
          valueAt(key, frame),
        ),
      value: (key) => valueAt(key, frames - 1),
      changing: ramping,
      switch: (key) => switches[key] ?? "",
    };
    dsp.process([left, right], out, frames, params, {
      ...TEMPO,
      sampleRate: RATE,
      timeSeconds: start / RATE,
    });
    output.set(out[0], start * 2);
    output.set(out[1], start * 2 + frames);
  }
  return output;
}

describe("EQ reset", () => {
  it("processes exactly as a fresh processor would", () => {
    // A fixed LCG, so the signal is the same every run.
    let seed = 777;
    const loud = new Float32Array(RATE / 4).map(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 2 ** 32 - 0.5) * 1.8;
    });
    const probe = new Float32Array(RATE / 4).map(
      (_, i) =>
        (i < RATE / 8 ? 0.6 : 0.01) * Math.sin((2 * Math.PI * 5000 * i) / RATE),
    );
    const numbers = {
      "Low Freq": 100,
      "Low Gain": 4,
      "Mid Freq": 1000,
      "Mid Gain": -3,
      "Mid Q": 1,
      "High Freq": 8000,
      "High Gain": 2,
    };
    const switches: Record<string, string> = {};
    const used = processor.createProcessor(RATE, 2);
    renderDirect(
      used,
      loud,
      { "Low Gain": 9, "Mid Gain": -12, "Mid Q": 6, "High Gain": 12 },
      {},
      numbers,
    );
    used.reset();
    const fresh = processor.createProcessor(RATE, 2);
    const after = renderDirect(used, probe, numbers, switches);
    const expected = renderDirect(fresh, probe, numbers, switches);
    const mismatch = after.findIndex(
      (sample, i) => !Object.is(sample, expected[i]),
    );
    assert.equal(mismatch, -1, `first differs at ${mismatch}`);
  });
});
