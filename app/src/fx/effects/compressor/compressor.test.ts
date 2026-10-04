import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import { testStage } from "../../../audio-mix/chain-test-utils.ts";
import {
  type AudioEffectProcessor,
  type AudioParameterBlock,
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import {
  ATTACK_KEY,
  COMPRESSOR_EFFECT_NAME,
  COMPRESSOR_RANGES,
  compressedLevelDb,
  KNEE_KEY,
  MAKEUP_KEY,
  MIX_KEY,
  RATIO_KEY,
  RELEASE_KEY,
  SILENCE_DB,
  smoothingCoefficient,
  THRESHOLD_KEY,
} from "./compressor.ts";
import { definition } from "./definition.ts";
import { processor } from "./processor.ts";

const SAMPLE_RATE = 48000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Numbers = Record<string, number>;

function compressor(numbers: Numbers = {}, enabled = true): AudioStage {
  const defaults = Object.fromEntries(
    Object.entries(COMPRESSOR_RANGES).map(([key, range]) => [
      key,
      range.defaultValue,
    ]),
  );
  return testStage(
    COMPRESSOR_EFFECT_NAME,
    { ...defaults, ...numbers },
    { id: "compressor", enabled },
  );
}

type Render = {
  stages: AudioStage[];
  // Settings applied live from the first block at or after `atSeconds`.
  change?: { atSeconds: number; stages: AudioStage[] };
};

// Renders `input` (one array per channel) through a chain block by block,
// as both the preview worklet and the offline render do.
function render(input: Float32Array[], options: Render) {
  const frames = input[0].length;
  const chain = new AudioChain(registry, SAMPLE_RATE, input.length);
  chain.configure(
    { stages: options.stages, inputGain: 1, delayFrames: 0 },
    TEMPO,
  );
  const output = input.map(() => new Float32Array(frames));
  let changed = false;
  for (let at = 0; at < frames; at += BLOCK_FRAMES) {
    const count = Math.min(BLOCK_FRAMES, frames - at);
    if (
      options.change &&
      !changed &&
      at / SAMPLE_RATE >= options.change.atSeconds
    ) {
      chain.configure(
        { stages: options.change.stages, inputGain: 1, delayFrames: 0 },
        TEMPO,
      );
      changed = true;
    }
    chain.process(
      input.map((channel) => channel.subarray(at, at + count)),
      output.map((channel) => channel.subarray(at, at + count)),
      count,
      at / SAMPLE_RATE,
    );
  }
  return output;
}

const dbToAmplitude = (db: number) => 10 ** (db / 20);

// A 1 kHz sine whose peak is `peakDb` until `switchSeconds`, then
// `laterDb`.
function tone(seconds: number, peakDb: number, switchAt?: number, laterDb = 0) {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const signal = new Float32Array(frames);
  for (let index = 0; index < frames; index++) {
    const later = switchAt !== undefined && index >= switchAt * SAMPLE_RATE;
    signal[index] =
      dbToAmplitude(later ? laterDb : peakDb) *
      Math.sin((2 * Math.PI * 1000 * index) / SAMPLE_RATE);
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

function peakDb(signal: Float32Array, from = 0, to = signal.length) {
  let peak = 0;
  for (let index = from; index < to; index++) {
    peak = Math.max(peak, Math.abs(signal[index]));
  }
  return 20 * Math.log10(peak);
}

// The gain reduction in dB at each frame where the input is far enough
// from zero to read it, else NaN.
function reductionDb(input: Float32Array, output: Float32Array) {
  return Array.from(input, (sample, index) =>
    Math.abs(sample) > 1e-3
      ? -20 * Math.log10(output[index] / sample)
      : Number.NaN,
  );
}

// The seconds after `from` until the reduction first passes `level`
// (rising when `rising`, else falling).
function crossingSeconds(
  reduction: number[],
  from: number,
  level: number,
  rising: boolean,
) {
  const start = Math.round(from * SAMPLE_RATE);
  for (let index = start; index < reduction.length; index++) {
    const value = reduction[index];
    if (rising ? value >= level : value <= level) {
      return (index - start) / SAMPLE_RATE;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function maxStep(values: Float32Array, from = 1) {
  let max = 0;
  for (let index = Math.max(1, from); index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

const SETTLED = 0.5 * SAMPLE_RATE;

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
      {
        ...TEMPO,
        sampleRate: SAMPLE_RATE,
        timeSeconds: fromSeconds + at / SAMPLE_RATE,
      },
    );
  }
  return output;
}

describe("compressedLevelDb", () => {
  it("leaves levels below the knee and divides the excess above it", () => {
    assert.equal(compressedLevelDb(-30, -18, 4, 6), -30);
    assert.equal(compressedLevelDb(-21, -18, 4, 6), -21);
    assert.equal(compressedLevelDb(-6, -18, 4, 6), -15);
    assert.equal(compressedLevelDb(-6, -18, 1, 6), -6);
  });

  it("joins the two smoothly across the knee", () => {
    // At Threshold, a quarter of the knee's reduction: (1/4 − 1)·3²/12.
    near(compressedLevelDb(-18, -18, 4, 6), -18 - 0.5625, 1e-12);
    // Continuous at both edges.
    near(compressedLevelDb(-15 + 1e-9, -18, 4, 6), -17.25, 1e-6);
    near(compressedLevelDb(-15 - 1e-9, -18, 4, 6), -17.25, 1e-6);
  });

  it("is a hard knee at Knee 0", () => {
    assert.equal(compressedLevelDb(-18, -18, 4, 0), -18);
    assert.equal(compressedLevelDb(-10, -18, 4, 0), -16);
  });
});

describe("Compressor", () => {
  it("settles a tone 12 dB over Threshold 9 dB down at 4:1", () => {
    const input = tone(1, -6);
    const [output] = render([input], { stages: [compressor()] });
    near(peakDb(input, SETTLED) - peakDb(output, SETTLED), 9, 0.5);
  });

  it("leaves a tone below Threshold minus the knee unchanged", () => {
    const input = tone(1, -25);
    const [output] = render([input], { stages: [compressor()] });
    for (let index = 0; index < input.length; index++) {
      near(output[index], input[index], 1e-6);
    }
  });

  it("rises with the Attack time constant", () => {
    for (const attack of [5, 10, 40]) {
      const input = tone(1, -40, 0.25, -6);
      const [output] = render([input], {
        stages: [compressor({ [ATTACK_KEY]: attack })],
      });
      const reduction = reductionDb(input, output);
      const final = 9;
      const seconds = crossingSeconds(
        reduction,
        0.25,
        final * (1 - Math.exp(-1)),
        true,
      );
      near(seconds * 1000, attack, attack * 0.1);
    }
  });

  it("falls with the Release time constant", () => {
    for (const release of [50, 100, 400]) {
      const input = tone(2, -6, 1, -40);
      const [output] = render([input], {
        stages: [compressor({ [ATTACK_KEY]: 0.1, [RELEASE_KEY]: release })],
      });
      const reduction = reductionDb(input, output);
      const before = peakDb(input, SETTLED, SAMPLE_RATE);
      const held = before - peakDb(output, SETTLED, SAMPLE_RATE);
      const seconds = crossingSeconds(reduction, 1, held * Math.exp(-1), false);
      near(seconds * 1000, release, release * 0.1);
    }
  });

  it("adds Makeup to the output", () => {
    const input = tone(1, -30);
    const [output] = render([input], {
      stages: [compressor({ [MAKEUP_KEY]: 6 })],
    });
    near(peakDb(output, SETTLED) - peakDb(input, SETTLED), 6, 1e-3);
  });

  it("blends dry and compressed signal by Mix", () => {
    const input = tone(1, -6);
    const [half] = render([input], {
      stages: [compressor({ [MIX_KEY]: 0.5, [RATIO_KEY]: 20, [KNEE_KEY]: 0 })],
    });
    // Half of the dry tone plus half of it 11.4 dB down.
    const wet = dbToAmplitude(-(12 - 12 / 20));
    near(
      peakDb(input, SETTLED) - peakDb(half, SETTLED),
      -20 * Math.log10(0.5 + 0.5 * wet),
      0.1,
    );
  });

  it("is the identity at Mix 0 %", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const output = render(input, {
      stages: [compressor({ [THRESHOLD_KEY]: -60, [MIX_KEY]: 0 })],
    });
    assert.deepEqual(output, input);
  });

  it("reduces both channels by the same gain", () => {
    const loud = tone(1, -6);
    const quiet = tone(1, -30);
    const [left, right] = render([loud, quiet], { stages: [compressor()] });
    near(
      peakDb(loud, SETTLED) - peakDb(left, SETTLED),
      peakDb(quiet, SETTLED) - peakDb(right, SETTLED),
      1e-3,
    );
  });

  it("passes audio bit-identically when bypassed or removed", () => {
    const input = [noise(1, 5), noise(1, 6)];
    const loud = { [THRESHOLD_KEY]: -60, [MAKEUP_KEY]: 12 };
    assert.deepEqual(
      render(input, { stages: [compressor(loud, false)] }),
      input,
    );
    const removed = render(input, {
      stages: [compressor(loud)],
      change: { atSeconds: 0.5, stages: [] },
    });
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("ramps a live Makeup change instead of jumping", () => {
    const amplitude = dbToAmplitude(-30);
    const input = tone(1, -30);
    const [output] = render([input], {
      stages: [compressor()],
      change: { atSeconds: 0.5, stages: [compressor({ [MAKEUP_KEY]: 24 })] },
    });
    // The sine's own slope at the final level, plus the dB ramp's fastest
    // change in amplitude, at its end.
    const final = amplitude * dbToAmplitude(24);
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const natural = 2 * Math.PI * (1000 / SAMPLE_RATE) * final;
    const bound = natural + (final * Math.log(10) * 24) / 20 / rampFrames;
    assert.ok(maxStep(output) <= bound, `${maxStep(output)} > ${bound}`);
    // An unsmoothed jump would be far bigger than the bound.
    assert.ok(final - amplitude > 2 * bound);
    near(peakDb(output, 0.75 * SAMPLE_RATE), -6, 0.01);
  });

  it("ramps a live Threshold change instead of jumping", () => {
    const amplitude = dbToAmplitude(-6);
    const input = tone(1, -6);
    const fast = { [ATTACK_KEY]: 0.1, [RATIO_KEY]: 20, [KNEE_KEY]: 0 };
    const [output] = render([input], {
      stages: [compressor({ ...fast, [THRESHOLD_KEY]: 0 })],
      change: {
        atSeconds: 0.5,
        stages: [compressor({ ...fast, [THRESHOLD_KEY]: -36 })],
      },
    });
    // The reduction follows the 36 dB ramp at most (1 − 1/20) dB per dB.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const natural = 2 * Math.PI * (1000 / SAMPLE_RATE) * amplitude;
    const bound =
      natural + (amplitude * Math.log(10) * 36 * 0.95) / 20 / rampFrames;
    assert.ok(maxStep(output) <= bound, `${maxStep(output)} > ${bound}`);
    near(peakDb(output, 0.75 * SAMPLE_RATE), -36 + 30 / 20, 0.1);
  });
});

describe("Compressor processing", () => {
  const numbers = {
    [THRESHOLD_KEY]: -20,
    [RATIO_KEY]: 6,
    [ATTACK_KEY]: 2,
    [RELEASE_KEY]: 40,
    [KNEE_KEY]: 6,
    [MAKEUP_KEY]: 6,
    [MIX_KEY]: 0.7,
  };

  // The compressor as it was before it skipped any math: a log and a 10^x
  // every frame.
  function reference(input: Float32Array) {
    const attack = smoothingCoefficient(numbers[ATTACK_KEY], SAMPLE_RATE);
    const release = smoothingCoefficient(numbers[RELEASE_KEY], SAMPLE_RATE);
    const mix = Math.fround(numbers[MIX_KEY]);
    const output = new Float32Array(input.length);
    let held = 0;
    let reduction = 0;
    for (let index = 0; index < input.length; index++) {
      const peak = Math.abs(input[index]);
      const levelDb = peak > 0 ? 20 * Math.log10(peak) : SILENCE_DB;
      const target =
        levelDb -
        compressedLevelDb(
          levelDb,
          numbers[THRESHOLD_KEY],
          numbers[RATIO_KEY],
          numbers[KNEE_KEY],
        );
      held = Math.max(target, release * held + (1 - release) * target);
      reduction = attack * reduction + (1 - attack) * held;
      const wet = 10 ** ((numbers[MAKEUP_KEY] - reduction) / 20) * mix;
      output[index] = input[index] * (1 - mix) + input[index] * wet;
    }
    return output;
  }

  it("matches computing the gain in full every frame", () => {
    // Loud, then quiet for long enough that the reduction settles to none.
    const input = tone(4, -6, 0.5, -40);
    const [output] = runSettled(
      processor.createProcessor(SAMPLE_RATE, 1),
      [input],
      numbers,
    );
    const expected = reference(input);
    for (let index = 0; index < input.length; index++) {
      assert.ok(Math.abs(output[index] - expected[index]) <= 1e-6, `${index}`);
    }
  });

  it("sounds exactly like a fresh processor after a reset", () => {
    const used = processor.createProcessor(SAMPLE_RATE, 2);
    runSettled(used, [noise(0.3, 2), noise(0.3, 3)], numbers);
    used.reset();
    const fresh = processor.createProcessor(SAMPLE_RATE, 2);
    const test = [tone(0.5, -6, 0.25, -30), tone(0.5, -12)];
    assert.deepEqual(
      runSettled(used, test, numbers),
      runSettled(fresh, test, numbers),
    );
  });
});

describe("Compressor definition", () => {
  it("has the specified ranges and defaults", () => {
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
              parameter.taper ?? "linear",
            ]
          : [parameter.key],
      ),
      [
        ["Threshold", -60, 0, -18, "linear"],
        ["Ratio", 1, 20, 4, "log"],
        ["Attack", 0.1, 100, 10, "log"],
        ["Release", 10, 1000, 100, "log"],
        ["Knee", 0, 30, 6, "linear"],
        ["Makeup", 0, 24, 0, "linear"],
        ["Mix", 0, 1, 1, "linear"],
      ],
    );
  });

  it("shows readable values", () => {
    const shown = definition.parameters.map((parameter) =>
      parameter.kind === "number"
        ? parameter.format(parameter.defaultValue)
        : "",
    );
    assert.deepEqual(shown, [
      "−18.0 dB",
      "4.0:1",
      "10.0 ms",
      "100 ms",
      "6.0 dB",
      "0.0 dB",
      "100%",
    ]);
  });

  it("is offered in the Audio group of the clip, layer and Global menus", () => {
    for (const group of ["clip", "layer", "global"] as const) {
      const audio = groupAddableEffects(addableEffectsFor(group)).find(
        (entry) => entry.domain === "audio",
      );
      assert.ok(
        audio?.effects.some(
          (effect) => effect.effectName === COMPRESSOR_EFFECT_NAME,
        ),
        `Compressor is missing from the ${group} menu`,
      );
    }
  });
});
