import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioChain, BLOCK_FRAMES } from "../../../audio-mix/chain.ts";
import {
  type AudioEffectProcessor,
  type AudioParameterBlock,
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor as gain } from "../gain/processor.ts";
import { notchFrequencies, phaserResponseDb, STAGE_OPTIONS } from "./phaser.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = {
  Rate: 0.5,
  Depth: 70,
  Center: 1000,
  Feedback: 30,
  Mix: 50,
};

type PhaserNumbers = Partial<typeof DEFAULTS>;

function phaser(
  numbers: PhaserNumbers = {},
  stages = "4",
  enabled = true,
): AudioStage {
  return {
    id: "phaser",
    effectName: "Phaser",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: { Stages: stages },
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

// Renders `input` (mono) through a chain of `stages` from timeline second
// `startSeconds`, applying `changes` at their frames, block by block like
// the hosts.
function render(
  stages: readonly AudioStage[],
  input: Float32Array,
  changes: { frame: number; stages: readonly AudioStage[] }[] = [],
  startSeconds = 0,
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
    chain.process([source], block, frames, startSeconds + start / RATE);
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

function gainDb(numbers: PhaserNumbers, frequency: number, stages = "4") {
  const input = sine(frequency);
  return levelDb(render([phaser(numbers, stages)], input)) - levelDb(input);
}

// The level in dB of `samples`' spectrum at `frequency`.
function spectrumDb(samples: Float32Array, frequency: number) {
  const w = (2 * Math.PI * frequency) / RATE;
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i++) {
    re += samples[i] * Math.cos(w * i);
    im -= samples[i] * Math.sin(w * i);
  }
  return 10 * Math.log10(re * re + im * im + 1e-30);
}

// The largest sample-to-sample change over frames `from` to `to`.
function maxStep(samples: Float32Array, from = 0, to = samples.length - 1) {
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

// Runs `input` straight through `effect` in chain-sized blocks from
// timeline second `fromSeconds`, with every parameter settled at `numbers`
// and `switches`.
function runSettled(
  effect: AudioEffectProcessor,
  input: Float32Array[],
  numbers: Record<string, number>,
  switches: Record<string, string> = {},
  fromSeconds = 0,
) {
  const values = new Map<string, Float32Array>();
  const params: AudioParameterBlock = {
    number(key) {
      let array = values.get(key);
      if (!array) {
        array = new Float32Array(BLOCK_FRAMES).fill(numbers[key] ?? 0);
        values.set(key, array);
      }
      return array;
    },
    value: (key) => numbers[key] ?? 0,
    changing: () => false,
    switch: (key) => switches[key] ?? "",
  };
  const frames = input[0].length;
  const output = input.map(() => new Float32Array(frames));
  for (let at = 0; at < frames; at += BLOCK_FRAMES) {
    const count = Math.min(BLOCK_FRAMES, frames - at);
    effect.process(
      input.map((channel) => channel.subarray(at, at + count)),
      output.map((channel) => channel.subarray(at, at + count)),
      count,
      params,
      { ...TEMPO, sampleRate: RATE, timeSeconds: fromSeconds + at / RATE },
    );
  }
  return output;
}

describe("Phaser stage at Mix 0", () => {
  it("passes sine, noise and an impulse through unchanged", () => {
    for (const input of [sine(440), noise(), impulse()]) {
      assert.deepEqual(
        render([phaser({ Mix: 0, Feedback: 90 })], input),
        input,
      );
    }
  });
});

describe("Phaser stage with the sweep still", () => {
  for (const stages of STAGE_OPTIONS) {
    it(`makes ${Number(stages) / 2} notches with ${stages} stages`, () => {
      const response = render(
        [phaser({ Depth: 0 }, stages)],
        impulse(RATE / 4),
      );
      // A log grid from 40 Hz to 16 kHz, 96 points an octave.
      const grid: number[] = [];
      for (let f = 40; f < 16_000; f *= 2 ** (1 / 96)) {
        grid.push(f);
      }
      const levels = grid.map((f) => spectrumDb(response, f));
      const notches = grid.filter(
        (_, i) =>
          i > 0 &&
          i < grid.length - 1 &&
          levels[i] < levels[i - 1] &&
          levels[i] < levels[i + 1] &&
          levels[i] < -20,
      );
      const expected = notchFrequencies(1000, Number(stages), RATE);
      assert.equal(notches.length, Number(stages) / 2);
      for (const [index, frequency] of expected.entries()) {
        // Within one grid step.
        near(notches[index] / frequency, 1, 2 ** (1 / 96) - 1);
        // A sine at the notch all but vanishes.
        assert.ok(gainDb({ Depth: 0 }, frequency, stages) < -30);
      }
    });
  }

  it("keeps the notches still over time", () => {
    const [notch] = notchFrequencies(1000, 4, RATE);
    const input = sine(notch, 2);
    const output = render([phaser({ Depth: 0 })], input);
    // Every quarter second after settling stays deep in the notch.
    for (let start = RATE / 4; start < input.length; start += RATE / 4) {
      const window = output.subarray(start, start + RATE / 4);
      assert.ok(levelDb(window) - levelDb(input) < -30, `${start}`);
    }
  });

  it("matches its analytic response", () => {
    for (const numbers of [
      { Feedback: 0, Mix: 50 },
      { Feedback: 60, Mix: 50 },
      { Feedback: 30, Mix: 100 },
    ]) {
      for (const frequency of [100, 700, 2500, 9000]) {
        near(
          gainDb({ ...numbers, Depth: 0 }, frequency),
          phaserResponseDb(
            {
              hz: 1000,
              stages: 4,
              feedback: numbers.Feedback,
              mix: numbers.Mix,
            },
            frequency,
            RATE,
          ),
          0.2,
        );
      }
    }
  });
});

describe("Phaser stage sweep", () => {
  // The level of `samples` in 10 ms windows.
  function envelope(samples: Float32Array) {
    const size = RATE / 100;
    const levels: number[] = [];
    for (let start = 0; start + size <= samples.length; start += size) {
      levels.push(levelDb(samples.subarray(start, start + size)));
    }
    return levels;
  }

  it("moves the notch periodically at Rate, in step with the timeline", () => {
    // Two stages notch at Center, so a sine there dips each time the sweep
    // crosses Center: twice a cycle, at phases 0 and ½.
    const rate = 2;
    const input = sine(1000, 3);
    const levels = envelope(render([phaser({ Rate: rate }, "2")], input));
    const dips = levels.flatMap((level, i) =>
      i > 0 &&
      i < levels.length - 1 &&
      level <= levels[i - 1] &&
      level < levels[i + 1] &&
      level < Math.max(...levels) - 20
        ? [(i + 0.5) / 100]
        : [],
    );
    assert.equal(dips.length, 3 * 2 * rate - 1);
    for (const [index, seconds] of dips.entries()) {
      near(seconds, (index + 1) / (2 * rate), 0.015);
    }
  });

  it("does not sweep at Depth 0 and sweeps further with more Depth", () => {
    const input = sine(1000, 2);
    const swing = (depth: number) => {
      const levels = envelope(
        render([phaser({ Rate: 2, Depth: depth })], input),
      ).slice(20);
      return Math.max(...levels) - Math.min(...levels);
    };
    assert.ok(swing(0) < 0.1);
    assert.ok(swing(20) > 3);
    assert.ok(swing(100) > swing(20));
  });

  it("sounds the same from any timeline start, as an export of part would", () => {
    const input = noise(2);
    const whole = render([phaser({ Rate: 3, Depth: 100 })], input);
    const from = RATE;
    const part = render(
      [phaser({ Rate: 3, Depth: 100 })],
      input.subarray(from),
      [],
      1,
    );
    // Once the filters' memory of the missed second has decayed.
    let max = 0;
    for (let i = RATE / 4; i < part.length; i++) {
      max = Math.max(max, Math.abs(part[i] - whole[from + i]));
    }
    assert.ok(max < 1e-4, `${max}`);
  });
});

describe("Phaser stage feedback", () => {
  it("deepens the notches and raises the peaks between them", () => {
    const [notch] = notchFrequencies(1000, 4, RATE);
    const shallow = { Depth: 0, Feedback: 0 };
    const deep = { Depth: 0, Feedback: 80 };
    for (const ratio of [0.9, 1.1]) {
      assert.ok(
        gainDb(deep, notch * ratio) < gainDb(shallow, notch * ratio) - 2,
        `${ratio}`,
      );
    }
    // The peak between the two notches is where the chain's phase is 360°:
    // at Center.
    const peak = 1000;
    near(gainDb(shallow, peak), 0, 0.1);
    assert.ok(gainDb(deep, peak) > 6);
  });
});

describe("Phaser stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    const input = noise();
    assert.deepEqual(
      render([phaser({ Feedback: 90, Mix: 100 }, "12", false)], input),
      input,
    );
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise();
    const output = render([phaser({ Feedback: 60 })], input, [
      { frame: BLOCK_FRAMES * 10, stages: [] },
    ]);
    // Past the removal's crossfade, if any.
    const settled = BLOCK_FRAMES * 20;
    assert.deepEqual(output.subarray(settled), input.subarray(settled));
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const input = sine(300);
    const half = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const both = render([phaser({ Depth: 0 }), half], input);
    near(levelDb(both) - levelDb(input), gainDb({ Depth: 0 }, 300) - 6, 0.1);
  });
});

describe("Phaser stage reset", () => {
  it("sounds exactly like a fresh processor after a reset", () => {
    const numbers = { ...DEFAULTS, Rate: 3, Feedback: 70 };
    const switches = { Stages: "8" };
    const used = processor.createProcessor(RATE, 2);
    runSettled(used, [noise(), noise()], numbers, switches);
    // A live Rate change leaves the LFO's phase off the timeline's.
    runSettled(
      used,
      [noise(0.1), noise(0.1)],
      { ...numbers, Rate: 6 },
      switches,
      0.5,
    );
    used.reset();
    const fresh = processor.createProcessor(RATE, 2);
    const test = [impulse(), impulse()];
    assert.deepEqual(
      runSettled(used, test, numbers, switches),
      runSettled(fresh, test, numbers, switches),
    );
  });
});

describe("Phaser stage parameter changes", () => {
  const input = sine(200, 2);
  const at = BLOCK_FRAMES * 300;
  // Steady, the phased 200 Hz sine moves at most this much per sample.
  const steadyBound = (stages: readonly AudioStage[]) =>
    maxStep(render(stages, input), RATE / 2);

  it("ramps a jump in Mix and Center instead of stepping", () => {
    const before = phaser({ Mix: 0, Center: 200 });
    const after = phaser({ Mix: 100, Center: 5000 });
    const output = render([before], input, [{ frame: at, stages: [after] }]);
    const bound = Math.max(steadyBound([before]), steadyBound([after])) * 1.5;
    const step = maxStep(output, at - 64, at + RATE * 0.05);
    assert.ok(step <= bound, `${step} > ${bound}`);
  });

  it("keeps the sweep continuous across a Rate change", () => {
    const before = phaser({ Rate: 0.05, Depth: 100, Feedback: 60 });
    const after = phaser({ Rate: 10, Depth: 100, Feedback: 60 });
    const output = render([before], input, [{ frame: at, stages: [after] }]);
    const bound = Math.max(steadyBound([before]), steadyBound([after])) * 1.5;
    const step = maxStep(output, at - 64, at + RATE * 0.05);
    assert.ok(step <= bound, `${step} > ${bound}`);
  });

  it("crossfades a change of Stages", () => {
    const before = phaser({ Depth: 0 }, "4");
    const after = phaser({ Depth: 0 }, "8");
    const output = render([before], input, [{ frame: at, stages: [after] }]);
    const bound = Math.max(steadyBound([before]), steadyBound([after])) * 1.5;
    const step = maxStep(output, at - 64, at + RATE * 0.05);
    assert.ok(step <= bound, `${step} > ${bound}`);
  });
});
