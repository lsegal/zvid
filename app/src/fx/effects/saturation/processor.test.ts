import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  chainLatencyFrames,
} from "../../../audio-mix/chain.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor as gain } from "../gain/processor.ts";
import { processor, SATURATION_LATENCY_FRAMES } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);
const LATENCY = SATURATION_LATENCY_FRAMES;

const DEFAULTS = { Drive: 6, Tone: 12_000, Output: 0, Mix: 1 };

type SaturationNumbers = Partial<typeof DEFAULTS>;

function saturation(
  numbers: SaturationNumbers = {},
  type = "Soft",
  enabled = true,
): AudioStage {
  return {
    id: "saturation",
    effectName: "Saturation",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: { Type: type },
  };
}

function sine(frequency: number, amplitude: number, seconds = 1) {
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

// The amplitude of `frequency` in the second half of `samples`, past the
// filters' settling, through a Hann window.
function amplitudeAt(samples: Float32Array, frequency: number) {
  const from = Math.floor(samples.length / 2);
  const count = samples.length - from;
  let re = 0;
  let im = 0;
  let weight = 0;
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / count);
    const phase = (2 * Math.PI * frequency * (from + i)) / RATE;
    re += samples[from + i] * window * Math.cos(phase);
    im += samples[from + i] * window * Math.sin(phase);
    weight += window;
  }
  return (2 * Math.hypot(re, im)) / weight;
}

// Each harmonic's level relative to the fundamental, in dB, from the 2nd.
function harmonicsDb(samples: Float32Array, fundamental: number, count = 5) {
  const base = amplitudeAt(samples, fundamental);
  return Array.from(
    { length: count - 1 },
    (_, n) =>
      20 * Math.log10(amplitudeAt(samples, fundamental * (n + 2)) / base),
  );
}

function thd(samples: Float32Array, fundamental: number) {
  let power = 0;
  for (let n = 2; n <= 9; n++) {
    power += amplitudeAt(samples, fundamental * n) ** 2;
  }
  return Math.sqrt(power) / amplitudeAt(samples, fundamental);
}

// The largest sample-to-sample change over frames from..to.
function maxStep(samples: Float32Array, from = 0, to = samples.length - 1) {
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
  }
  return max;
}

function levelDb(samples: Float32Array) {
  let sum = 0;
  const from = Math.floor(samples.length / 2);
  for (let i = from; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return 10 * Math.log10(sum / (samples.length - from));
}

describe("Saturation stage harmonics", () => {
  it("adds under 1% THD to a −20 dB sine with Soft at 0 dB Drive", () => {
    const output = render([saturation({ Drive: 0 })], sine(1000, 0.1));
    assert.ok(thd(output, 1000) < 0.01, `${thd(output, 1000)}`);
  });

  it("adds odd harmonics only with Soft and Hard at 24 dB", () => {
    for (const type of ["Soft", "Hard"]) {
      const output = render([saturation({ Drive: 24 }, type)], sine(1000, 0.1));
      const [second, third, fourth, fifth] = harmonicsDb(output, 1000);
      assert.ok(third > -30 && fifth > -50, `${type}: ${third}, ${fifth}`);
      assert.ok(second < -80 && fourth < -80, `${type}: ${second}, ${fourth}`);
    }
  });

  it("adds even harmonics with Tube at 24 dB", () => {
    const output = render([saturation({ Drive: 24 }, "Tube")], sine(1000, 0.1));
    const [second, , fourth] = harmonicsDb(output, 1000);
    assert.ok(second > -25 && fourth > -50, `${second}, ${fourth}`);
  });

  it("adds even harmonics with Tape once driven into its curve", () => {
    const output = render([saturation({ Drive: 24 }, "Tape")], sine(1000, 0.1));
    const [second] = harmonicsDb(output, 1000);
    assert.ok(second > -40, `${second}`);
  });

  it("keeps aliases from a 5 kHz sine at 24 dB at least 40 dB down", () => {
    for (const type of ["Soft", "Hard", "Tape", "Tube"]) {
      for (const amplitude of [0.1, 0.5]) {
        const output = render(
          [saturation({ Drive: 24, Tone: 20_000 }, type)],
          sine(5000, amplitude, 0.5),
        );
        const fundamental = amplitudeAt(output, 5000);
        // Every 100 Hz up to 20 kHz but the harmonics of 5 kHz, where
        // aliases folding off the oversampled rate's harmonics land.
        for (let frequency = 100; frequency <= 20_000; frequency += 100) {
          if (frequency % 5000 === 0) {
            continue;
          }
          const alias =
            20 * Math.log10(amplitudeAt(output, frequency) / fundamental);
          assert.ok(
            alias <= -40,
            `${type} ${amplitude} ${frequency}: ${alias}`,
          );
        }
      }
    }
  });
});

describe("Saturation stage mix and latency", () => {
  it("reports its oversampling filters' delay as latency", () => {
    assert.equal(
      chainLatencyFrames(registry, [saturation()], RATE),
      SATURATION_LATENCY_FRAMES,
    );
    assert.equal(
      chainLatencyFrames(registry, [saturation({}, "Soft", false)], RATE),
      0,
    );
  });

  // The Tone low-pass, open as it is, adds a fraction of a frame.
  it("delays an impulse by its latency", () => {
    const input = new Float32Array(4096);
    input[1000] = 0.1;
    const output = render(
      [saturation({ Drive: 0, Tone: 20_000 }, "Hard")],
      input,
    );
    const peak = output.reduce(
      (best, value, index) =>
        Math.abs(value) > Math.abs(output[best]) ? index : best,
      0,
    );
    assert.ok([0, 1].includes(peak - 1000 - LATENCY), `${peak}`);
  });

  it("is the input, delayed by its latency, at Mix 0", () => {
    const input = noise();
    const output = render([saturation({ Drive: 36, Mix: 0 }, "Hard")], input);
    // A fresh stage starts as if its first frame had been playing.
    assert.deepEqual(
      output.subarray(0, LATENCY),
      new Float32Array(LATENCY).fill(input[0]),
    );
    assert.deepEqual(
      output.subarray(LATENCY),
      input.subarray(0, input.length - LATENCY),
    );
  });

  it("blends dry and wet in phase, so a half Mix doesn't comb-filter", () => {
    // Clean (Hard below its knee, Tone open), so dry and wet only cancel
    // if their delays differ: off by the latency, 1 kHz would vanish.
    const input = sine(1000, 0.1);
    const wet = render([saturation({ Drive: 0, Tone: 20_000 }, "Hard")], input);
    const half = render(
      [saturation({ Drive: 0, Tone: 20_000, Mix: 0.5 }, "Hard")],
      input,
    );
    assert.ok(levelDb(half) > Math.min(levelDb(wet), levelDb(input)) - 0.1);
  });
});

describe("Saturation stage bypass", () => {
  it("passes audio bit-identically when bypassed", () => {
    const input = noise();
    assert.deepEqual(
      render([saturation({ Drive: 30 }, "Tube", false)], input),
      input,
    );
  });

  it("passes audio bit-identically once removed", () => {
    const input = noise();
    const at = BLOCK_FRAMES * 10;
    const output = render([saturation({ Drive: 30 })], input, [
      { frame: at, stages: [] },
    ]);
    assert.deepEqual(output.subarray(at), input.subarray(at));
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const input = sine(1000, 0.1);
    const half = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const alone = render([saturation({ Drive: 24 })], input);
    const both = render([saturation({ Drive: 24 }), half], input);
    assert.ok(Math.abs(levelDb(both) - levelDb(alone) + 6) < 0.05);
  });
});

describe("Saturation stage parameter changes", () => {
  const at = BLOCK_FRAMES * 100;

  // A jump from `from` to `to` moves the output by no more per frame than
  // the steady output at either setting does, as a ramp should; an instant
  // jump would step.
  function assertSmooth(input: Float32Array, from: AudioStage, to: AudioStage) {
    const output = render([from], input, [{ frame: at, stages: [to] }]);
    const bound =
      Math.max(
        maxStep(render([from], input), RATE / 4),
        maxStep(render([to], input), RATE / 4),
      ) * 1.05;
    const step = maxStep(output, at - 64, at + RATE * 0.05);
    assert.ok(step <= bound, `${step} > ${bound}`);
  }

  it("ramps Drive", () => {
    assertSmooth(
      sine(100, 0.1),
      saturation({ Drive: 0 }),
      saturation({ Drive: 36 }),
    );
  });

  it("ramps Output", () => {
    assertSmooth(
      sine(100, 0.1),
      saturation({ Output: -24 }),
      saturation({ Output: 6 }),
    );
  });

  it("ramps Mix", () => {
    assertSmooth(
      sine(100, 0.1),
      saturation({ Drive: 36, Mix: 0 }, "Hard"),
      saturation({ Drive: 36, Mix: 1 }, "Hard"),
    );
  });

  it("ramps Tone", () => {
    assertSmooth(
      sine(100, 0.1),
      saturation({ Drive: 36, Tone: 1000 }, "Hard"),
      saturation({ Drive: 36, Tone: 20_000 }, "Hard"),
    );
  });

  it("crossfades a Type change", () => {
    assertSmooth(
      sine(100, 0.1),
      saturation({ Drive: 24 }, "Soft"),
      saturation({ Drive: 24 }, "Tube"),
    );
  });

  it("settles on the new setting", () => {
    const input = sine(1000, 0.1);
    const output = render([saturation({ Output: -12 })], input, [
      { frame: at, stages: [saturation({ Output: 0 })] },
    ]);
    const settled = render([saturation({ Output: 0 })], input);
    assert.ok(Math.abs(levelDb(output) - levelDb(settled)) < 0.01);
  });
});
