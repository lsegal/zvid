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
import { type HighCutSlope, highCutResponseDb } from "./high-cut.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = { Frequency: 8000, Resonance: Math.SQRT1_2 };

type HighCutNumbers = Partial<typeof DEFAULTS>;

function highCut(
  numbers: HighCutNumbers = {},
  slope: HighCutSlope = "12 dB/oct",
  enabled = true,
): AudioStage {
  return {
    id: "high-cut",
    effectName: "High Cut",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: { Slope: slope },
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

function gainDb(
  numbers: HighCutNumbers,
  frequency: number,
  slope: HighCutSlope = "12 dB/oct",
) {
  const input = sine(frequency);
  return levelDb(render([highCut(numbers, slope)], input)) - levelDb(input);
}

// The largest sample-to-sample change over frames `from` to `to`.
function maxStep(samples: Float32Array, from: number, to: number) {
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
  }
  return max;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

for (const slope of ["12 dB/oct", "24 dB/oct"] as const) {
  describe(`High Cut stage at ${slope}`, () => {
    const octaveDb = slope === "12 dB/oct" ? -12 : -24;

    it("is −3 dB (±0.5) at the cutoff with Q 0.707", () => {
      near(gainDb({ Frequency: 1000 }, 1000, slope), -3, 0.5);
    });

    it(`is about ${octaveDb} dB an octave above the cutoff`, () => {
      near(gainDb({ Frequency: 1000 }, 2000, slope), octaveDb, 1);
    });

    it("passes a decade below the cutoff within 0.5 dB", () => {
      near(gainDb({ Frequency: 1000 }, 100, slope), 0, 0.5);
    });

    it("matches its analytic response with a resonant peak", () => {
      const settings = { frequency: 2000, resonance: 4, slope };
      for (const frequency of [500, 2000, 6000]) {
        near(
          gainDb({ Frequency: 2000, Resonance: 4 }, frequency, slope),
          highCutResponseDb(settings, frequency, RATE),
          0.2,
        );
      }
    });

    it("darkens noise and rings out an impulse", () => {
      const input = noise();
      assert.ok(
        levelDb(render([highCut({ Frequency: 500 }, slope)], input)) <
          levelDb(input) - 10,
      );
      const ring = render(
        [highCut({ Frequency: 500, Resonance: 18 }, slope)],
        impulse(),
      );
      assert.ok(ring.every(Number.isFinite));
      assert.ok(Math.abs(ring[ring.length - 1]) < 1e-3);
    });
  });
}

describe("High Cut stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    const input = noise();
    assert.deepEqual(
      render([highCut({ Frequency: 200 }, "24 dB/oct", false)], input),
      input,
    );
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise();
    const output = render([highCut({ Frequency: 200 })], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    assert.deepEqual(
      output.subarray(BLOCK_FRAMES * 10),
      input.subarray(BLOCK_FRAMES * 10),
    );
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const input = sine(2000);
    const half = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const both = render([highCut({ Frequency: 1000 }), half], input);
    near(
      levelDb(both) - levelDb(input),
      gainDb({ Frequency: 1000 }, 2000) - 6,
      0.1,
    );
  });
});

describe("High Cut stage parameter changes", () => {
  it("sweeps the cutoff without discontinuities", () => {
    const input = sine(200);
    const at = BLOCK_FRAMES * 50;
    const output = render([highCut({ Frequency: 20_000 })], input, [
      { frame: at, stages: [highCut({ Frequency: 150, Resonance: 4 })] },
    ]);
    // A 200 Hz sine raised by at most the resonant peak moves by at most
    // this much per sample, ramp or not.
    const peak = 10 ** (12 / 20);
    const bound = (2 * Math.PI * 200 * 0.5 * peak) / RATE;
    assert.ok(maxStep(output, 0, output.length - 1) <= bound * 1.1);
  });

  it("ramps a jump in Resonance instead of stepping", () => {
    const input = sine(1000);
    const at = BLOCK_FRAMES * 100;
    const output = render([highCut({ Frequency: 1000 })], input, [
      { frame: at, stages: [highCut({ Frequency: 1000, Resonance: 8 })] },
    ]);
    const settled = render([highCut({ Frequency: 1000, Resonance: 8 })], input);
    const bound = maxStep(settled, RATE / 2, RATE - 1) * 1.05;
    assert.ok(maxStep(output, at - 64, at + RATE * 0.05) <= bound);
    near(levelDb(output), levelDb(settled), 0.05);
  });

  it("crossfades a Slope change without a click", () => {
    const input = sine(300);
    const at = BLOCK_FRAMES * 100;
    const output = render([highCut({ Frequency: 2000 })], input, [
      { frame: at, stages: [highCut({ Frequency: 2000 }, "24 dB/oct")] },
    ]);
    // Both slopes pass 300 Hz at nearly full level, so the output moves
    // no faster than the sine itself.
    const bound = (2 * Math.PI * 300 * 0.5) / RATE;
    assert.ok(maxStep(output, at - 64, at + RATE * 0.05) <= bound * 1.05);
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

describe("High Cut reset", () => {
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
    const numbers = { Frequency: 2000, Resonance: 2 };
    const switches: Record<string, string> = { Slope: "24 dB/oct" };
    const used = processor.createProcessor(RATE, 2);
    renderDirect(
      used,
      loud,
      { Frequency: 300, Resonance: 12 },
      { Slope: "12 dB/oct" },
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
