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
import { quantizeWhole } from "./bitcrush.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = { Bits: 8, Downsample: 1, Mix: 1 };

type CrushNumbers = Partial<typeof DEFAULTS>;

function crush(numbers: CrushNumbers = {}, enabled = true): AudioStage {
  return {
    id: "crush",
    effectName: "Bitcrush",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: {},
  };
}

function gainStage(db: number): AudioStage {
  return {
    id: "gain",
    effectName: "Gain",
    enabled: true,
    numbers: { Gain: db },
    switches: {},
  };
}

function sine(seconds = 0.5, frequency = 440, level = 0.5) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = level * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return samples;
}

function noise(seconds = 0.5) {
  // A fixed LCG, so the signal is the same every run.
  let seed = 12345;
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (seed / 2 ** 32 - 0.5) * 1.6;
  }
  return samples;
}

function impulse(frames = 4096) {
  const samples = new Float32Array(frames);
  samples[0] = 1;
  return samples;
}

function constant(value: number, seconds = 0.5) {
  return new Float32Array(Math.round(seconds * RATE)).fill(value);
}

// Renders `input` (mono) through a chain of `stages`, applying `changes` at
// their frames, block by block like the hosts, from timeline frame
// `fromFrame`.
function render(
  stages: readonly AudioStage[],
  input: Float32Array,
  changes: { frame: number; stages: readonly AudioStage[] }[] = [],
  fromFrame = 0,
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
    chain.process([source], block, frames, (fromFrame + start) / RATE);
    output.set(block[0].subarray(0, frames), start);
  }
  return output;
}

// The largest sample-to-sample change over frames `from` to `to`.
function maxStep(samples: Float32Array, from = 0, to = samples.length - 1) {
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
  }
  return max;
}

// Asserts `actual` is bit-identical to `expected`, naming the first frame
// that differs (deepEqual's diff of long arrays is very slow).
function same(actual: Float32Array, expected: Float32Array, message = "") {
  assert.equal(actual.length, expected.length);
  const index = actual.findIndex(
    (sample, i) => !Object.is(sample, expected[i]),
  );
  assert.equal(
    index,
    -1,
    `${message} frame ${index}: ${actual[index]} != ${expected[index]}`,
  );
}

describe("Bitcrush stage quantization", () => {
  it("keeps 16 bits at 1× within 1 LSB of the input", () => {
    const lsb = 2 / (2 ** 16 - 1);
    for (const input of [sine(), noise(), impulse()]) {
      const output = render([crush({ Bits: 16 })], input);
      for (let i = 0; i < input.length; i++) {
        assert.ok(
          Math.abs(output[i] - input[i]) <= lsb,
          `frame ${i}: ${output[i]} vs ${input[i]}`,
        );
      }
    }
  });

  it("leaves 1 bit only ±full-scale values", () => {
    const output = render([crush({ Bits: 1 })], noise());
    for (const sample of output) {
      assert.ok(sample === 1 || sample === -1, `${sample}`);
    }
    // A sine becomes a square wave of the same sign.
    const input = sine();
    const square = render([crush({ Bits: 1 })], input);
    for (let i = 0; i < input.length; i++) {
      assert.equal(square[i], Math.sign(input[i]));
    }
  });

  it("puts each sample on one of 2^Bits levels", () => {
    const input = noise();
    for (const bits of [2, 4, 8]) {
      const output = render([crush({ Bits: bits })], input);
      for (let i = 0; i < input.length; i++) {
        assert.equal(output[i], Math.fround(quantizeWhole(input[i], bits)));
      }
    }
  });

  it("keeps silence silent", () => {
    const input = new Float32Array(RATE / 4);
    same(render([crush({ Bits: 1, Downsample: 64 })], input), input);
  });

  it("holds each value for Downsample samples", () => {
    const input = noise();
    for (const factor of [2, 4, 7, 64]) {
      const output = render([crush({ Bits: 16, Downsample: factor })], input);
      for (let i = 0; i < input.length; i++) {
        const taken = i - (i % factor);
        assert.equal(
          output[i],
          Math.fround(quantizeWhole(input[taken], 16)),
          `${factor}× frame ${i}`,
        );
      }
    }
  });

  it("holds on the timeline's Downsample grid wherever it starts", () => {
    const input = noise();
    const factor = 8;
    // Starting 5 frames into a stretch, it holds the first frame until the
    // next multiple of Downsample on the timeline, then every 8 frames.
    const from = RATE + 5;
    const output = render(
      [crush({ Bits: 16, Downsample: factor })],
      input,
      [],
      from,
    );
    for (let i = 0; i < input.length; i++) {
      const timeline = from + i;
      const taken = Math.max(0, timeline - (timeline % factor) - from);
      assert.equal(
        output[i],
        Math.fround(quantizeWhole(input[taken], 16)),
        `frame ${i}`,
      );
    }
  });

  it("is the input at Mix 0", () => {
    for (const input of [sine(), noise(), impulse()]) {
      const stage = crush({ Bits: 1, Downsample: 16, Mix: 0 });
      same(render([stage], input), input);
    }
  });

  it("blends dry and wet at a half Mix", () => {
    const input = noise();
    const wet = render([crush({ Bits: 2 })], input);
    const half = render([crush({ Bits: 2, Mix: 0.5 })], input);
    for (let i = 0; i < input.length; i++) {
      assert.ok(Math.abs(half[i] - (wet[i] + input[i]) / 2) < 1e-6);
    }
  });
});

describe("Bitcrush stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    for (const input of [sine(), noise(), impulse()]) {
      same(render([crush({ Bits: 1, Downsample: 8 }, false)], input), input);
    }
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise(1);
    const output = render([crush({ Bits: 1 })], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    // Past the removal's crossfade, if any.
    const settled = BLOCK_FRAMES * 20;
    same(output.subarray(settled), input.subarray(settled));
  });

  it("processes in rack order", () => {
    const input = noise();
    // Ahead of the crush, Gain scales what is quantized to ±1; after it,
    // Gain scales the ±1 the crush gives.
    const before = render([gainStage(-20), crush({ Bits: 1 })], input);
    const after = render([crush({ Bits: 1 }), gainStage(-20)], input);
    for (let i = 0; i < input.length; i++) {
      assert.equal(Math.abs(before[i]), 1);
      assert.ok(Math.abs(Math.abs(after[i]) - 0.1) < 1e-6);
    }
  });
});

describe("Bitcrush stage parameter changes", () => {
  const at = BLOCK_FRAMES * 100;
  // Unramped, the Mix and Bits changes below would each jump the output by
  // 0.7 or 0.67 in a single frame; the host's 15 ms ramp spreads that out.
  const bound = 0.05;

  it("ramps a jump in Mix instead of stepping", () => {
    const input = constant(0.3);
    const output = render([crush({ Bits: 1, Mix: 0 })], input, [
      { frame: at, stages: [crush({ Bits: 1, Mix: 1 })] },
    ]);
    assert.ok(Math.abs(output[at - 1] - 0.3) < 1e-6);
    const step = maxStep(output, at - 64);
    assert.ok(step <= bound, `${step} > ${bound}`);
    assert.equal(output.at(-1), 1);
  });

  it("ramps a jump in Bits through the depths between", () => {
    const input = constant(0.3);
    const output = render([crush({ Bits: 16 })], input, [
      { frame: at, stages: [crush({ Bits: 1 })] },
    ]);
    const step = maxStep(output, at - 64);
    assert.ok(step <= bound, `${step} > ${bound}`);
    assert.equal(output.at(-1), 1);
  });

  it("steps no further than the held signal while Downsample moves", () => {
    const input = sine(0.5, 200);
    const output = render([crush({ Bits: 16, Downsample: 1 })], input, [
      { frame: at, stages: [crush({ Bits: 16, Downsample: 64 })] },
    ]);
    // Settled at 64×, the held 200 Hz sine steps by this much at most.
    const held = render([crush({ Bits: 16, Downsample: 64 })], input);
    const steady = maxStep(held);
    const step = maxStep(output, at - 64);
    assert.ok(step <= steady * 1.01, `${step} > ${steady}`);
    // Once settled, it holds each value for 64 frames.
    const settled = output.subarray(at + RATE / 10);
    const first = settled.findIndex((sample, i) => sample !== settled[i + 1]);
    for (let i = first + 1; i + 64 <= settled.length; i += 64) {
      assert.equal(settled[i], settled[i + 63], `frame ${i}`);
      assert.notEqual(settled[i - 1], settled[i], `frame ${i}`);
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

describe("Bitcrush reset", () => {
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
    const numbers = { Bits: 6, Downsample: 3, Mix: 1 };
    const switches: Record<string, string> = {};
    const used = processor.createProcessor(RATE, 2);
    // Shorter than a hold, so it ends in the stretch the probe starts in:
    // only a reset makes the probe take a fresh sample there.
    renderDirect(
      used,
      loud.subarray(0, 2),
      { Bits: 3.5, Downsample: 7, Mix: 0.4 },
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
