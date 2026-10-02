import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioChain, BLOCK_FRAMES } from "../../../audio-mix/chain.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor as gain } from "../gain/processor.ts";
import { type LowCutSlope, lowCutResponseDb } from "./low-cut.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

type LowCutNumbers = { Frequency?: number; Resonance?: number };

function lowCut(
  numbers: LowCutNumbers = {},
  slope: LowCutSlope = "12 dB/oct",
  enabled = true,
): AudioStage {
  return {
    id: "low-cut",
    effectName: "Low Cut",
    enabled,
    numbers: { Frequency: 80, Resonance: Math.SQRT1_2, ...numbers },
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
  frequency: number,
  numbers: LowCutNumbers = {},
  slope: LowCutSlope = "12 dB/oct",
) {
  const input = sine(frequency);
  return levelDb(render([lowCut(numbers, slope)], input)) - levelDb(input);
}

// The largest sample-to-sample change from frame `from` to `to`.
function maxStep(samples: Float32Array, from = 0, to = samples.length - 1) {
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
  }
  return max;
}

// The largest second difference: a kink in the waveform.
function maxCurvature(samples: Float32Array) {
  let max = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    max = Math.max(
      max,
      Math.abs(samples[i + 1] - 2 * samples[i] + samples[i - 1]),
    );
  }
  return max;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

for (const slope of ["12 dB/oct", "24 dB/oct"] as const) {
  const octaveDb = slope === "12 dB/oct" ? -12 : -24;

  describe(`Low Cut stage at ${slope}`, () => {
    it("is −3 dB at the default 80 Hz cutoff", () => {
      near(gainDb(80, {}, slope), -3, 0.5);
    });

    it("is −3 dB at a 1 kHz cutoff", () => {
      near(gainDb(1000, { Frequency: 1000 }, slope), -3, 0.5);
    });

    it(`is about ${octaveDb} dB an octave below the cutoff`, () => {
      near(gainDb(500, { Frequency: 1000 }, slope), octaveDb, 0.5);
      near(gainDb(40, {}, slope), octaveDb, 0.5);
    });

    it("passes a decade above the cutoff within 0.5 dB", () => {
      near(gainDb(800, {}, slope), 0, 0.5);
      near(gainDb(10_000, { Frequency: 1000 }, slope), 0, 0.5);
    });

    it("matches its analytic response", () => {
      const settings = { frequency: 300, resonance: 4, slope };
      for (const frequency of [100, 300, 600, 5000]) {
        near(
          gainDb(frequency, { Frequency: 300, Resonance: 4 }, slope),
          lowCutResponseDb(settings, frequency, RATE),
          0.2,
        );
      }
    });

    it("removes a DC offset", () => {
      const input = new Float32Array(RATE).fill(0.5);
      const output = render([lowCut({}, slope)], input);
      assert.ok(Math.abs(output[output.length - 1]) < 1e-4);
    });
  });
}

describe("Low Cut stage resonance", () => {
  it("peaks at the cutoff above 0.707", () => {
    near(
      gainDb(1000, { Frequency: 1000, Resonance: 4 }),
      20 * Math.log10(4),
      0.5,
    );
  });
});

describe("Low Cut stage bypass", () => {
  it("passes sine, noise and an impulse bit-identically when bypassed", () => {
    for (const input of [sine(40), noise(), impulse()]) {
      assert.deepEqual(
        render([lowCut({ Frequency: 2000 }, "24 dB/oct", false)], input),
        input,
      );
    }
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise();
    const output = render([lowCut({ Frequency: 2000 })], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    assert.deepEqual(
      output.subarray(BLOCK_FRAMES * 10),
      input.subarray(BLOCK_FRAMES * 10),
    );
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const input = sine(1000);
    const half: AudioStage = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const both = render([lowCut({ Frequency: 1000 }), half], input);
    near(
      levelDb(both) - levelDb(input),
      gainDb(1000, { Frequency: 1000 }) - 6,
      0.1,
    );
  });
});

describe("Low Cut stage parameter changes", () => {
  // A 0.5 amplitude sine at `frequency` moves by at most this much per
  // sample when the filter's gain is at most `gain`.
  const sineBound = (frequency: number, gain = 1) =>
    (2 * Math.PI * frequency * 0.5 * gain) / RATE;

  it("sweeps the frequency without discontinuities", () => {
    const input = sine(1000);
    const output = render([lowCut({ Frequency: 20 })], input, [
      { frame: BLOCK_FRAMES * 50, stages: [lowCut({ Frequency: 2000 })] },
      { frame: BLOCK_FRAMES * 200, stages: [lowCut({ Frequency: 20 })] },
    ]);
    assert.ok(maxStep(output) <= sineBound(1000) * 1.1);
    // The sine's curvature, its largest second difference, bounds that of
    // the output to within the sweep's own transient. Coefficients that
    // only followed the ramp once a block would kink it about 3× past this.
    const curvature = ((2 * Math.PI * 1000) ** 2 * 0.5) / RATE ** 2;
    assert.ok(maxCurvature(output) <= curvature * 1.3);
  });

  it("ramps a jump in resonance instead of stepping", () => {
    const input = sine(1000);
    const at = BLOCK_FRAMES * 100;
    const resonant = { Frequency: 1000, Resonance: 8 };
    const output = render([lowCut({ Frequency: 1000 })], input, [
      { frame: at, stages: [lowCut(resonant)] },
    ]);
    const steady = render([lowCut(resonant)], input);
    const bound = maxStep(steady, RATE / 2, RATE - 1) * 1.05;
    assert.ok(maxStep(output, at - 64, at + RATE * 0.05) <= bound);
    near(levelDb(output), levelDb(steady), 0.05);
  });

  it("crossfades a Slope change without a click", () => {
    const input = sine(1000);
    const at = BLOCK_FRAMES * 100;
    const output = render([lowCut({}, "12 dB/oct")], input, [
      { frame: at, stages: [lowCut({}, "24 dB/oct")] },
      { frame: at * 2, stages: [lowCut({}, "12 dB/oct")] },
    ]);
    assert.ok(maxStep(output) <= sineBound(1000) * 1.1);
  });
});
