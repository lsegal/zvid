import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allPassCoefficient,
  breakFrequency,
  formatFrequency,
  formatPercent,
  formatRate,
  notchFrequencies,
  PhaserDsp,
  phaserResponseDb,
  phaserTailSeconds,
  STAGE_OPTIONS,
  stageCount,
} from "./phaser.ts";

const RATE = 48_000;

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

function constant(value: number, frames: number) {
  return new Float32Array(frames).fill(value);
}

// Runs `input` through a fresh PhaserDsp in blocks of `blockFrames`.
function run(
  input: Float32Array[],
  blockFrames: number,
  numbers = { rate: 2, depth: 80, center: 800, feedback: 50, mix: 60 },
) {
  const dsp = new PhaserDsp(RATE, input.length);
  const output = input.map((channel) => new Float32Array(channel.length));
  for (let start = 0; start < input[0].length; start += blockFrames) {
    const frames = Math.min(blockFrames, input[0].length - start);
    dsp.process(
      input.map((channel) => channel.subarray(start, start + frames)),
      output.map((channel) => channel.subarray(start, start + frames)),
      {
        frames,
        timeSeconds: start / RATE,
        stages: 6,
        rate: constant(numbers.rate, frames),
        depth: constant(numbers.depth, frames),
        center: constant(numbers.center, frames),
        feedback: constant(numbers.feedback, frames),
        mix: constant(numbers.mix, frames),
      },
    );
  }
  return output;
}

function noise(frames: number, seed: number) {
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (seed / 2 ** 32 - 0.5) * 0.8;
  }
  return samples;
}

describe("Phaser readouts", () => {
  it("formats rates, frequencies and percentages", () => {
    assert.equal(formatRate(0.05), "0.05 Hz");
    assert.equal(formatRate(2.5), "2.5 Hz");
    assert.equal(formatFrequency(200), "200 Hz");
    assert.equal(formatFrequency(5000), "5.00 kHz");
    assert.equal(formatPercent(29.6), "30%");
  });

  it("reads a stored stage count, or the default", () => {
    assert.deepEqual(STAGE_OPTIONS.map(stageCount), [2, 4, 6, 8, 12]);
    assert.equal(stageCount(undefined), 4);
    assert.equal(stageCount("5"), 4);
  });
});

describe("Phaser sweep", () => {
  it("stays at Center at Depth 0 and spans two octaves either side at 100 %", () => {
    assert.equal(breakFrequency(1000, 0, 0.25), 1000);
    near(breakFrequency(1000, 100, 0.25), 4000, 1e-9);
    near(breakFrequency(1000, 100, 0.75), 250, 1e-9);
  });

  it("turns each stage's phase by 90° at its break frequency", () => {
    const c = allPassCoefficient(1000, RATE);
    const w = (2 * Math.PI * 1000) / RATE;
    const phase =
      Math.atan2(-Math.sin(w), c + Math.cos(w)) -
      Math.atan2(-c * Math.sin(w), 1 + c * Math.cos(w));
    near(phase, -Math.PI / 2, 1e-9);
  });

  it("places half as many notches as stages, where the response vanishes", () => {
    for (const stages of [2, 4, 6, 8, 12]) {
      const notches = notchFrequencies(1000, stages, RATE);
      assert.equal(notches.length, stages / 2);
      for (const notch of notches) {
        assert.ok(
          phaserResponseDb(
            { hz: 1000, stages, feedback: 30, mix: 50 },
            notch,
            RATE,
          ) < -80,
        );
      }
    }
    // Two stages notch at the break frequency itself.
    near(notchFrequencies(1000, 2, RATE)[0], 1000, 1e-6);
  });
});

describe("PhaserDsp", () => {
  it("gives the same output for any block size", () => {
    const input = [noise(RATE / 4, 1), noise(RATE / 4, 2)];
    const whole = run(input, RATE / 4);
    for (const size of [1, 37, 128]) {
      const blocks = run(input, size);
      for (let channel = 0; channel < 2; channel++) {
        assert.deepEqual(blocks[channel], whole[channel]);
      }
    }
  });

  it("keeps its channels independent", () => {
    const left = noise(RATE / 4, 1);
    const [stereo] = run([left, new Float32Array(left.length)], 128);
    const [mono] = run([left], 128);
    assert.deepEqual(stereo, mono);
  });

  it("stays bounded at the most feedback", () => {
    const [output] = run([noise(RATE, 3)], 128, {
      rate: 10,
      depth: 100,
      center: 5000,
      feedback: 90,
      mix: 100,
    });
    assert.ok(output.every((sample) => Math.abs(sample) < 20));
  });
});

describe("Phaser tail", () => {
  it("is short without feedback and longer with it", () => {
    const dry = phaserTailSeconds(1000, 70, 4, 0);
    const wet = phaserTailSeconds(1000, 70, 4, 90);
    assert.ok(dry > 0 && dry < 0.05);
    assert.ok(wet > dry * 10);
  });
});
