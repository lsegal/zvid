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
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = {
  Threshold: -50,
  Attack: 1,
  Hold: 20,
  Release: 100,
  Range: -80,
};

type GateNumbers = Partial<typeof DEFAULTS>;

function gate(numbers: GateNumbers = {}, enabled = true): AudioStage {
  return {
    id: "gate",
    effectName: "Noise Gate",
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

const amplitude = (db: number) => 10 ** (db / 20);

// Frames in `milliseconds`.
const ms = (milliseconds: number) => Math.round((milliseconds / 1000) * RATE);

// A sine whose peak is `levels(seconds)` dBFS at each frame.
function tone(
  seconds: number,
  levels: (seconds: number) => number,
  frequency = 1000,
) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] =
      amplitude(levels(i / RATE)) *
      Math.sin((2 * Math.PI * frequency * i) / RATE);
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

// Renders `input` (mono) through a chain of `stages`, applying `changes` at
// their frames, block by block like the hosts.
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

// The gain in dB `output` has over `input` across frames `from` to `to`.
function gainDb(
  input: Float32Array,
  output: Float32Array,
  from: number,
  to = input.length,
) {
  let inSum = 0;
  let outSum = 0;
  for (let i = from; i < to; i++) {
    inSum += input[i] * input[i];
    outSum += output[i] * output[i];
  }
  return 10 * Math.log10(outSum / inSum);
}

// The first frame from `from` where the output is quieter than the input.
function firstAttenuated(
  input: Float32Array,
  output: Float32Array,
  from: number,
) {
  for (let i = from; i < input.length; i++) {
    if (Math.abs(output[i]) < Math.abs(input[i])) {
      return i;
    }
  }
  return -1;
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

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

// A tone at -20 dB for half a second, then at -60 dB, below Threshold.
const dropping = () => tone(1.5, (seconds) => (seconds < 0.5 ? -20 : -60));
const DROP = ms(500);

describe("Noise Gate stage levels", () => {
  it("passes a tone above Threshold unchanged once open", () => {
    const input = tone(1, () => -20);
    const output = render([gate()], input);
    // Within a few milliseconds the gate is fully open, and it stays open.
    const open = ms(5);
    same(output.subarray(open), input.subarray(open));
  });

  it("attenuates a tone below Threshold by Range", () => {
    for (const range of [-80, -30, -6]) {
      const input = tone(1, () => -60);
      const output = render([gate({ Range: range })], input);
      near(gainDb(input, output, 0), range, 0.01);
    }
  });

  it("closes to Range over Release once the tone falls below Threshold", () => {
    const input = dropping();
    for (const release of [20, 100, 400]) {
      const output = render([gate({ Hold: 0, Release: release })], input);
      near(gainDb(input, output, ms(100), DROP), 0, 1e-6);
      // The detector falls 3 dB below Threshold within a few tens of
      // milliseconds; then Release ramps the gain down to Range.
      const closing = firstAttenuated(input, output, DROP);
      assert.ok(closing > DROP && closing < DROP + ms(80), `${closing}`);
      // Halfway through Release the gain is halfway to Range, in dB.
      const mid = closing + ms(release / 2);
      near(gainDb(input, output, mid - ms(1), mid + ms(1)), -40, 2);
      near(gainDb(input, output, closing + ms(release) + 1), -80, 0.01);
    }
  });

  it("opens over Attack", () => {
    const input = tone(0.5, (seconds) => (seconds < 0.1 ? -70 : -20));
    const opening = ms(100);
    for (const attack of [0.1, 10, 50]) {
      const output = render([gate({ Attack: attack })], input);
      const open = opening + ms(attack) + ms(2);
      same(output.subarray(open), input.subarray(open), `${attack}`);
      // Through the first half of Attack the gain is still well down.
      if (attack >= 10) {
        assert.ok(
          gainDb(input, output, opening, opening + ms(attack / 2)) < -20,
        );
      }
    }
  });

  it("stays open for Hold after the signal drops", () => {
    const input = dropping();
    const closing = (hold: number) =>
      firstAttenuated(input, render([gate({ Hold: hold })], input), DROP);
    const unheld = closing(0);
    for (const hold of [20, 200, 500]) {
      const held = closing(hold);
      assert.ok(held - DROP > ms(hold), `${hold}`);
      near(held - unheld, ms(hold), 2);
    }
  });

  it("doesn't chatter for a signal hovering at Threshold", () => {
    // The tone's RMS swings 2 dB either side of Threshold four times a
    // second, inside the hysteresis. A 60 Hz tone ripples the detector too.
    const peakAt = (rmsDb: number) => rmsDb + 10 * Math.log10(2);
    const hover = (swingDb: number) =>
      tone(
        3,
        (seconds) =>
          peakAt(-50 + swingDb * Math.sin(2 * Math.PI * 4 * seconds)),
        60,
      );
    const hovering = hover(2);
    const open = ms(100);
    const output = render([gate({ Hold: 0 })], hovering);
    same(output.subarray(open), hovering.subarray(open));

    // Swinging further below Threshold than the hysteresis, it closes.
    const swinging = hover(6);
    const closed = render([gate({ Hold: 0 })], swinging);
    assert.ok(firstAttenuated(swinging, closed, open) > 0);
  });
});

describe("Noise Gate stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    for (const input of [tone(0.5, () => -60), noise(), impulse()]) {
      same(render([gate({ Threshold: 0 }, false)], input), input);
    }
  });

  it("passes audio bit-identically once removed", () => {
    const input = tone(1, () => -60);
    const output = render([gate()], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    // Past the removal's crossfade, if any.
    const settled = BLOCK_FRAMES * 20;
    same(output.subarray(settled), input.subarray(settled));
  });

  it("processes in rack order", () => {
    const input = tone(1, () => -55);
    // Gain ahead lifts the tone over Threshold, so the gate opens; after
    // the gate, Gain lifts what the closed gate let through.
    const before = render([gainStage(10), gate()], input);
    const after = render([gate(), gainStage(10)], input);
    near(gainDb(input, before, ms(500)), 10, 0.01);
    near(gainDb(input, after, ms(500)), 10 - 80, 0.01);
  });
});

describe("Noise Gate stage parameter changes", () => {
  const at = BLOCK_FRAMES * 100;
  const input = tone(1, () => -20, 200);
  // Steady and open, the 200 Hz tone moves at most this much per sample.
  const bound = maxStep(render([gate()], input), ms(100)) * 1.5;

  it("ramps a jump in Range instead of stepping", () => {
    const output = render([gate({ Threshold: 0, Range: -80 })], input, [
      { frame: at, stages: [gate({ Threshold: 0, Range: 0 })] },
    ]);
    const step = maxStep(output, at - 64, at + ms(50));
    assert.ok(step <= bound, `${step} > ${bound}`);
    near(gainDb(input, output, at + ms(50)), 0, 1e-6);
  });

  it("closes smoothly when Threshold jumps above the signal", () => {
    const output = render([gate({ Release: 5 })], input, [
      { frame: at, stages: [gate({ Threshold: 0, Release: 5 })] },
    ]);
    const step = maxStep(output, at - 64, at + ms(100));
    assert.ok(step <= bound, `${step} > ${bound}`);
    near(gainDb(input, output, at + ms(100)), -80, 0.01);
  });

  it("opens smoothly over Attack when Threshold jumps below the signal", () => {
    const output = render([gate({ Threshold: 0, Attack: 10 })], input, [
      { frame: at, stages: [gate({ Threshold: -80, Attack: 10 })] },
    ]);
    const step = maxStep(output, at - 64, at + ms(100));
    assert.ok(step <= bound, `${step} > ${bound}`);
    near(gainDb(input, output, at + ms(100)), 0, 1e-6);
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

describe("Noise Gate reset", () => {
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
      Threshold: -25,
      Attack: 1,
      Hold: 5,
      Release: 20,
      Range: -60,
    };
    const switches: Record<string, string> = {};
    const used = processor.createProcessor(RATE, 2);
    renderDirect(
      used,
      loud,
      { Threshold: -10, Attack: 20, Hold: 300, Release: 800, Range: -20 },
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
