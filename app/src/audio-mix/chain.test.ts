import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gainToAmplitude } from "../fx/effects/gain/gain.ts";
import { gainStageAt, MUTE_ON } from "../fx/effects/gain/processor.ts";
import {
  AudioChain,
  type AudioChainSettings,
  BLOCK_FRAMES,
  chainLatencyFrames,
  chainTailSeconds,
  createBuffers,
  PARAMETER_RAMP_SECONDS,
  Ramp,
  SWITCH_CROSSFADE_SECONDS,
} from "./chain.ts";
import {
  DELAY,
  ECHO,
  ONE_POLE,
  TEST_PROCESSORS,
  testStage,
} from "./chain-test-utils.ts";
import {
  type AudioEffectDsp,
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "./processor.ts";

const SAMPLE_RATE = 8000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };

function settings(
  stages: AudioStage[],
  overrides: Partial<AudioChainSettings> = {},
): AudioChainSettings {
  return { stages, inputGain: 1, delayFrames: 0, ...overrides };
}

function chainOf(
  stages: AudioStage[],
  overrides: Partial<AudioChainSettings> = {},
  registry = TEST_PROCESSORS,
) {
  const chain = new AudioChain(registry, SAMPLE_RATE, 1);
  chain.configure(settings(stages, overrides), TEMPO);
  return chain;
}

// Runs `input` through `chain` in blocks, calling `between(block)` before
// each block from `afterBlock` on.
function run(
  chain: AudioChain,
  input: Float32Array,
  between?: (block: number) => void,
) {
  const output = new Float32Array(input.length);
  const out = createBuffers(1, BLOCK_FRAMES);
  for (let block = 0; block < input.length; block += BLOCK_FRAMES) {
    between?.(block);
    const frames = Math.min(BLOCK_FRAMES, input.length - block);
    chain.process(
      [input.subarray(block, block + frames)],
      out,
      frames,
      block / SAMPLE_RATE,
    );
    output.set(out[0].subarray(0, frames), block);
  }
  return output;
}

function constant(length: number, value = 1) {
  return new Float32Array(length).fill(value);
}

function impulse(length: number, at = 0) {
  const data = new Float32Array(length);
  data[at] = 1;
  return data;
}

// The largest change between neighboring samples.
function largestStep(data: Float32Array, from = 1, to = data.length) {
  let step = 0;
  for (let index = Math.max(1, from); index < to; index++) {
    step = Math.max(step, Math.abs(data[index] - data[index - 1]));
  }
  return step;
}

describe("Ramp", () => {
  it("moves linearly to its target, then holds it exactly", () => {
    const ramp = new Ramp(0, 8);
    ramp.set(1, 4);
    assert.deepEqual([...ramp.fill(6)], [0.25, 0.5, 0.75, 1, 1, 1, 0, 0]);
    assert.equal(ramp.changing, false);
    assert.equal(ramp.value, 1);
  });

  it("jumps when given no frames", () => {
    const ramp = new Ramp(0, 4);
    ramp.set(2, 0);
    assert.equal(ramp.value, 2);
    assert.deepEqual([...ramp.fill(4)], [2, 2, 2, 2]);
  });
});

describe("AudioChain", () => {
  it("passes its input through without stages", () => {
    const input = Float32Array.from({ length: 300 }, (_, index) => index);
    assert.deepEqual(run(chainOf([]), input), input);
  });

  it("gates its input silent at input gain 0", () => {
    const output = run(chainOf([], { inputGain: 0 }), constant(300));
    assert.ok(output.every((sample) => sample === 0));
  });

  it("runs Gain as a stage, at its level's amplitude", () => {
    const output = run(chainOf([gainStageAt(0.5)]), constant(300));
    assert.ok(output.every((sample) => Math.abs(sample - 0.5) < 1e-7));
  });

  it("ramps a live parameter edit instead of jumping to it", () => {
    const chain = chainOf([gainStageAt(1)]);
    const turnedDown = {
      ...gainStageAt(gainToAmplitude(-20)),
    };
    const output = run(chain, constant(4 * BLOCK_FRAMES), (block) => {
      if (block === BLOCK_FRAMES) {
        chain.configure(settings([turnedDown]), TEMPO);
      }
    });
    const rampFrames = Math.round(PARAMETER_RAMP_SECONDS * SAMPLE_RATE);
    assert.equal(output[BLOCK_FRAMES - 1], 1);
    // No sample moves by more than a fraction of the change.
    assert.ok(largestStep(output) < 0.1, `${largestStep(output)}`);
    assert.ok(
      Math.abs(output[BLOCK_FRAMES + rampFrames + 1] - 0.1) < 1e-6,
      `${output[BLOCK_FRAMES + rampFrames + 1]}`,
    );
  });

  it("crossfades a switch, such as Mute, instead of cutting", () => {
    const chain = chainOf([gainStageAt(1)]);
    const muted = {
      ...gainStageAt(1),
      switches: { Mute: MUTE_ON },
    };
    const output = run(chain, constant(3 * BLOCK_FRAMES), (block) => {
      if (block === BLOCK_FRAMES) {
        chain.configure(settings([muted]), TEMPO);
      }
    });
    const fadeFrames = Math.round(SWITCH_CROSSFADE_SECONDS * SAMPLE_RATE);
    assert.ok(output[BLOCK_FRAMES] > 0.8);
    assert.ok(output[BLOCK_FRAMES + fadeFrames / 2] > 0.3);
    assert.ok(output[BLOCK_FRAMES + fadeFrames / 2] < 0.7);
    assert.equal(output[BLOCK_FRAMES + fadeFrames + 1], 0);
    assert.ok(largestStep(output) < 0.2);
  });

  it("crossfades to its dry input when a stage is bypassed live", () => {
    const chain = chainOf([gainStageAt(0)]);
    const bypassed = { ...gainStageAt(0), enabled: false };
    const output = run(chain, constant(3 * BLOCK_FRAMES), (block) => {
      if (block === BLOCK_FRAMES) {
        chain.configure(settings([bypassed]), TEMPO);
      }
    });
    assert.equal(output[BLOCK_FRAMES - 1], 0);
    assert.ok(largestStep(output) < 0.2);
    assert.equal(output.at(-1), 1);
  });

  it("delays its output by its latency compensation", () => {
    const output = run(chainOf([], { delayFrames: 5 }), impulse(300, 10));
    assert.equal(output[10], 0);
    assert.equal(output[15], 1);
  });

  it("keeps a tail ringing after its input stops, and a reset silences it", () => {
    const echoing = chainOf([testStage(ECHO)]);
    const output = run(echoing, impulse(SAMPLE_RATE));
    const echoFrames = 0.05 * SAMPLE_RATE;
    assert.equal(output[echoFrames], 0.5);
    assert.equal(output[2 * echoFrames], 0.25);

    const reset = chainOf([testStage(ECHO)]);
    const afterReset = run(reset, impulse(SAMPLE_RATE), (block) => {
      if (block === BLOCK_FRAMES * 2) {
        reset.reset();
      }
    });
    assert.ok(afterReset.subarray(BLOCK_FRAMES * 2).every((x) => x === 0));
  });

  it("skips a stage once its input has been silent longer than its tail", () => {
    let created = 0;
    let processed = 0;
    const counting: AudioEffectDsp = {
      effectName: "Counting",
      createProcessor: () => {
        created += 1;
        return {
          process(input, output, frames) {
            processed += 1;
            output[0].set(input[0].subarray(0, frames));
          },
        };
      },
      tailSeconds: () => BLOCK_FRAMES / SAMPLE_RATE,
    };
    const chain = chainOf(
      [testStage("Counting")],
      {},
      createProcessorRegistry([counting]),
    );
    run(chain, new Float32Array(10 * BLOCK_FRAMES));
    assert.equal(created, 0);
    assert.equal(processed, 0);

    // One block of sound, then its tail's block, then idle.
    const input = new Float32Array(10 * BLOCK_FRAMES);
    input[0] = 1;
    run(chain, input);
    assert.equal(created, 1);
    assert.equal(processed, 2);
  });
});

describe("chain timing", () => {
  it("adds up its enabled stages' latency and tails", () => {
    const stages = [
      testStage(DELAY, { Frames: 32 }, { id: "a" }),
      testStage(DELAY, { Frames: 16 }, { id: "b" }),
      testStage(DELAY, { Frames: 100 }, { id: "c", enabled: false }),
      testStage(ECHO),
      testStage(ONE_POLE, { Cutoff: 500 }),
    ];
    assert.equal(chainLatencyFrames(TEST_PROCESSORS, stages, SAMPLE_RATE), 48);
    assert.ok(
      Math.abs(chainTailSeconds(TEST_PROCESSORS, stages, TEMPO) - 1.05) < 1e-9,
    );
  });
});
