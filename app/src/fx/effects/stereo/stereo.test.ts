import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor } from "./processor.ts";
import { formatPan, formatWidth, panAmplitudes } from "./stereo.ts";

const SAMPLE_RATE = 48000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Settings = { width?: number; pan?: number; enabled?: boolean };

function stage({ width = 100, pan = 0, enabled = true }: Settings): AudioStage {
  return {
    id: "stereo",
    effectName: "Stereo",
    enabled,
    numbers: { Width: width, Pan: pan },
    switches: {},
  };
}

function sine(frequency: number, seconds: number, amplitude = 0.5) {
  const signal = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < signal.length; index++) {
    signal[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return signal;
}

// Deterministic white noise in −0.5…0.5.
function noise(seconds: number, seed: number) {
  const signal = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let state = seed;
  for (let index = 0; index < signal.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    signal[index] = state / 2 ** 32 - 0.5;
  }
  return signal;
}

// Renders `input` through a chain of `stages` block by block, applying
// `changes[block]` before that block, as the offline render does.
function render(
  input: readonly Float32Array[],
  stages: readonly AudioStage[],
  changes: Record<number, readonly AudioStage[]> = {},
) {
  const chain = new AudioChain(registry, SAMPLE_RATE, input.length);
  chain.configure({ stages, inputGain: 1, delayFrames: 0 }, TEMPO);
  const length = input[0].length;
  const output = input.map(() => new Float32Array(length));
  const blockIn = input.map(() => new Float32Array(BLOCK_FRAMES));
  const blockOut = input.map(() => new Float32Array(BLOCK_FRAMES));
  for (let start = 0, block = 0; start < length; start += BLOCK_FRAMES) {
    const change = changes[block++];
    if (change) {
      chain.configure({ stages: change, inputGain: 1, delayFrames: 0 }, TEMPO);
    }
    const frames = Math.min(BLOCK_FRAMES, length - start);
    for (let channel = 0; channel < input.length; channel++) {
      blockIn[channel].fill(0);
      blockIn[channel].set(input[channel].subarray(start, start + frames));
    }
    chain.process(blockIn, blockOut, frames, start / SAMPLE_RATE);
    for (let channel = 0; channel < input.length; channel++) {
      output[channel].set(blockOut[channel].subarray(0, frames), start);
    }
  }
  return output;
}

function rms(signal: Float32Array) {
  let sum = 0;
  for (const sample of signal) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / signal.length);
}

function sideOf(left: Float32Array, right: Float32Array) {
  return left.map((value, index) => (value - right[index]) / 2);
}

function midOf(left: Float32Array, right: Float32Array) {
  return left.map((value, index) => (value + right[index]) / 2);
}

function largestStep(signal: Float32Array) {
  let largest = 0;
  for (let index = 1; index < signal.length; index++) {
    largest = Math.max(largest, Math.abs(signal[index] - signal[index - 1]));
  }
  return largest;
}

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not ${expected}`,
  );

// A wide stereo signal: a sine on the left, noise on the right.
function wideInput() {
  return [sine(440, 1), noise(1, 7)];
}

describe("Stereo formatting", () => {
  it("shows width as a percentage and pan by side", () => {
    assert.equal(formatWidth(100), "100%");
    assert.equal(formatPan(0), "C");
    assert.equal(formatPan(-40), "L 40");
    assert.equal(formatPan(100), "R 100");
  });
});

describe("Stereo pan law", () => {
  it("is unity at center and −3 dB per side from a hard pan", () => {
    assert.deepEqual(panAmplitudes(0), [1, 1]);
    const [hard, silent] = panAmplitudes(-100);
    assert.equal(silent, 0);
    // A side at center against the same side panned fully to it.
    near(20 * Math.log10(1 / hard), -3.0103, 1e-4);
  });

  it("keeps power constant across the range", () => {
    for (const pan of [-100, -73, -20, 0, 35, 90, 100]) {
      const [left, right] = panAmplitudes(pan);
      near(left * left + right * right, 2, 1e-12);
    }
  });
});

describe("Stereo processing", () => {
  it("is the identity at 100 % width and center pan", () => {
    const input = wideInput();
    const output = render(input, [stage({})]);
    assert.deepEqual(output, input);
  });

  it("folds to mono at 0 % width", () => {
    const input = wideInput();
    const [left, right] = render(input, [stage({ width: 0 })]);
    assert.deepEqual(left, right);
    const mid = midOf(input[0], input[1]);
    for (let index = 0; index < mid.length; index += 997) {
      near(left[index], mid[index]);
    }
  });

  it("doubles the side level at 200 % and keeps the mid", () => {
    const input = wideInput();
    const [left, right] = render(input, [stage({ width: 200 })]);
    near(rms(sideOf(left, right)) / rms(sideOf(input[0], input[1])), 2, 1e-5);
    near(rms(midOf(left, right)), rms(midOf(input[0], input[1])), 1e-6);
  });

  it("leaves the right silent for a centered source panned hard left", () => {
    const tone = sine(220, 0.5);
    const [left, right] = render([tone, tone.slice()], [stage({ pan: -100 })]);
    assert.ok(right.every((sample) => sample === 0));
    near(rms(left) / rms(tone), Math.SQRT2, 1e-5);
  });

  it("keeps a mono source centered whatever the width", () => {
    const tone = sine(330, 0.5);
    for (const width of [0, 100, 200]) {
      const [left, right] = render([tone, tone.slice()], [stage({ width })]);
      assert.deepEqual(left, right);
      near(rms(left), rms(tone));
    }
  });

  it("passes a single channel unchanged", () => {
    const tone = sine(330, 0.25);
    const [only] = render([tone], [stage({ width: 0, pan: 80 })]);
    assert.deepEqual(only, tone);
  });

  it("passes audio bit-identically when bypassed or removed", () => {
    const input = wideInput();
    assert.deepEqual(
      render(input, [stage({ width: 0, pan: -60, enabled: false })]),
      input,
    );
    assert.deepEqual(render(input, []), input);
  });

  it("smooths parameter changes without clicks", () => {
    // A pure side signal: an instant change from 200 % to 0 % width would
    // drop it from double level to silence in one frame.
    const tone = sine(440, 1, 0.25);
    const input = [tone, tone.map((sample) => -sample)];
    const changeBlock = 100;
    const [left] = render(input, [stage({ width: 200, pan: 0 })], {
      [changeBlock]: [stage({ width: 0, pan: 100 })],
    });
    // The sine's own slope at its peak level, plus the ramp's share of it.
    const natural = 2 * Math.PI * (440 / SAMPLE_RATE) * 0.5;
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const bound = natural + (0.5 * Math.SQRT2) / rampFrames;
    assert.ok(
      largestStep(left) <= bound,
      `step ${largestStep(left)} exceeds ${bound}`,
    );
    // And it settles at the new setting: mono, panned hard right.
    const settled = left.subarray((changeBlock + 10) * BLOCK_FRAMES);
    assert.ok(settled.every((sample) => sample === 0));
  });
});
