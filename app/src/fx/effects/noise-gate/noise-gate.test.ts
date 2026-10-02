import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDb,
  formatMilliseconds,
  NOISE_GATE_RANGES,
  type NoiseGateBlock,
  NoiseGateDsp,
} from "./noise-gate.ts";

const RATE = 48_000;

// A block with every parameter at its default, `frames` long.
function defaults(frames: number): NoiseGateBlock {
  const fill = (key: keyof typeof NOISE_GATE_RANGES) =>
    new Float32Array(frames).fill(NOISE_GATE_RANGES[key].defaultValue);
  return {
    frames,
    threshold: fill("Threshold"),
    attack: fill("Attack"),
    hold: fill("Hold"),
    release: fill("Release"),
    range: fill("Range"),
  };
}

// Bursts of a 1 kHz tone at −20 dB between stretches of −70 dB.
function bursts(frames: number) {
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const loud = Math.floor(i / (RATE / 8)) % 2 === 0;
    samples[i] =
      (loud ? 0.1 : 0.0003) * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  }
  return samples;
}

// Runs `channels` through a fresh gate in blocks of `blockFrames`.
function run(channels: Float32Array[], blockFrames: number) {
  const dsp = new NoiseGateDsp(RATE);
  const frames = channels[0].length;
  const output = channels.map(() => new Float32Array(frames));
  for (let start = 0; start < frames; start += blockFrames) {
    const length = Math.min(blockFrames, frames - start);
    const blockOut = channels.map(() => new Float32Array(length));
    dsp.process(
      channels.map((channel) => channel.subarray(start, start + length)),
      blockOut,
      defaults(length),
    );
    for (const [index, samples] of blockOut.entries()) {
      output[index].set(samples, start);
    }
  }
  return output;
}

describe("Noise Gate readouts", () => {
  it("shows levels in dB", () => {
    assert.equal(formatDb(-50), "−50.0 dB");
    assert.equal(formatDb(-3.26), "−3.3 dB");
    assert.equal(formatDb(0), "0.0 dB");
    assert.equal(formatDb(-0.01), "0.0 dB");
  });

  it("shows times in milliseconds", () => {
    assert.equal(formatMilliseconds(0.1), "0.10 ms");
    assert.equal(formatMilliseconds(1), "1.0 ms");
    assert.equal(formatMilliseconds(7.25), "7.3 ms");
    assert.equal(formatMilliseconds(20), "20 ms");
    assert.equal(formatMilliseconds(1000), "1000 ms");
  });
});

describe("NoiseGateDsp", () => {
  it("sounds the same whatever the block size", () => {
    const input = bursts(RATE);
    const [whole] = run([input], RATE);
    for (const blockFrames of [1, 128, 1000]) {
      assert.ok(
        run([input], blockFrames)[0].every((sample, i) => sample === whole[i]),
        `${blockFrames}`,
      );
    }
  });

  it("gates every channel together, keyed by the loudest", () => {
    // The left channel bursts; the right is a steady quiet tone that would
    // stay gated on its own.
    const left = bursts(RATE);
    const right = new Float32Array(RATE).map(
      (_, i) => 0.0003 * Math.sin((2 * Math.PI * 300 * i) / RATE),
    );
    const [gatedLeft, gatedRight] = run([left, right], 128);
    const gain = (input: Float32Array, output: Float32Array, i: number) =>
      output[i] / input[i];
    for (let i = 0; i < RATE; i += 997) {
      if (left[i] !== 0 && right[i] !== 0) {
        const l = gain(left, gatedLeft, i);
        const r = gain(right, gatedRight, i);
        assert.ok(Math.abs(l - r) <= 1e-6 * Math.max(l, r), `${i}`);
      }
    }
    // The right channel is let through while the left bursts open the gate.
    assert.equal(gatedRight[RATE / 16], right[RATE / 16]);
  });
});
