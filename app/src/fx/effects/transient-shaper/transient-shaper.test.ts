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
import {
  DETECTION_DB,
  formatOutputDb,
  formatShapePercent,
  SHAPE_RANGE_DB,
  shapeGainDb,
} from "./transient-shaper.ts";

const SAMPLE_RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

function shaper(
  settings: {
    attack?: number;
    sustain?: number;
    output?: number;
    enabled?: boolean;
  } = {},
): AudioStage {
  return {
    id: "transient-shaper",
    effectName: "Transient Shaper",
    enabled: settings.enabled ?? true,
    numbers: {
      Attack: settings.attack ?? 0,
      Sustain: settings.sustain ?? 0,
      Output: settings.output ?? 0,
    },
    switches: {},
  };
}

// Deterministic noise, so failures reproduce.
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

const HIT_FRAME = Math.round(0.1 * SAMPLE_RATE);

// A drum hit at `level` peak: 100 ms of silence, then noise that starts at
// once and decays by 60 ms time constant, on two identical channels.
function drumHit(level = 0.5, seconds = 1) {
  const random = noise(11);
  const frames = Math.round(seconds * SAMPLE_RATE);
  const channel = Float32Array.from({ length: frames }, (_, index) => {
    if (index < HIT_FRAME) {
      return 0;
    }
    const age = (index - HIT_FRAME) / SAMPLE_RATE;
    return 2 * level * random() * Math.exp(-age / 0.06);
  });
  return [channel, Float32Array.from(channel)];
}

const sine =
  (hz: number, level = 0.5) =>
  (index: number) =>
    level * Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE);

function signal(seconds: number, sample: (index: number) => number) {
  const channel = Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    (_, index) => sample(index),
  );
  return [channel, Float32Array.from(channel)];
}

// Renders `input` offline through a chain of `stages`, block by block, as
// the export does. `changes` reconfigures the chain at a frame (rounded to
// its block).
function render(
  input: readonly Float32Array[],
  stages: readonly AudioStage[],
  changes: readonly { frame: number; stages: readonly AudioStage[] }[] = [],
) {
  const chain = new AudioChain(registry, SAMPLE_RATE, input.length);
  chain.configure({ stages, inputGain: 1, delayFrames: 0 }, TEMPO);
  const frames = input[0].length;
  const output = input.map(() => new Float32Array(frames));
  const pending = [...changes];
  for (let start = 0; start < frames; start += BLOCK_FRAMES) {
    while (pending.length && pending[0].frame <= start) {
      const change = pending.shift();
      if (change) {
        chain.configure(
          { stages: change.stages, inputGain: 1, delayFrames: 0 },
          TEMPO,
        );
      }
    }
    const count = Math.min(BLOCK_FRAMES, frames - start);
    chain.process(
      input.map((channel) => channel.subarray(start, start + count)),
      output.map((channel) => channel.subarray(start, start + count)),
      count,
      start / SAMPLE_RATE,
    );
  }
  return output;
}

// The RMS level in dB of `channel` from `fromSeconds` to `toSeconds`.
function levelDb(
  channel: Float32Array,
  fromSeconds: number,
  toSeconds: number,
) {
  const from = Math.round(fromSeconds * SAMPLE_RATE);
  const to = Math.round(toSeconds * SAMPLE_RATE);
  let total = 0;
  for (let index = from; index < to; index++) {
    total += channel[index] ** 2;
  }
  return 10 * Math.log10(total / (to - from));
}

// How much louder `output` is than `input` over a span, in dB.
function changeDb(
  output: Float32Array,
  input: Float32Array,
  fromSeconds: number,
  toSeconds: number,
) {
  return (
    levelDb(output, fromSeconds, toSeconds) -
    levelDb(input, fromSeconds, toSeconds)
  );
}

// When the hit's 5 ms RMS first falls `belowDb` under its first 5 ms.
function decaySeconds(channel: Float32Array, belowDb: number) {
  const start = HIT_FRAME / SAMPLE_RATE;
  const peak = levelDb(channel, start, start + 0.005);
  for (let at = start; at + 0.005 < channel.length / SAMPLE_RATE; at += 0.001) {
    if (levelDb(channel, at, at + 0.005) < peak - belowDb) {
      return at - start;
    }
  }
  return Number.POSITIVE_INFINITY;
}

// The largest jump between neighbouring samples.
function largestStep(channel: Float32Array) {
  let largest = 0;
  for (let index = 1; index < channel.length; index++) {
    largest = Math.max(largest, Math.abs(channel[index] - channel[index - 1]));
  }
  return largest;
}

const HIT = HIT_FRAME / SAMPLE_RATE;

describe("shapeGainDb", () => {
  it("applies Attack above the slow follower and Sustain below it", () => {
    assert.equal(shapeGainDb(DETECTION_DB, 1, -1), SHAPE_RANGE_DB);
    assert.equal(shapeGainDb(-DETECTION_DB, 1, -1), -SHAPE_RANGE_DB);
    assert.equal(shapeGainDb(DETECTION_DB / 2, -0.5, 1), -SHAPE_RANGE_DB / 4);
  });

  it("stays within ±12 dB however far apart the followers are", () => {
    assert.equal(shapeGainDb(80, 1, 0), 12);
    assert.equal(shapeGainDb(-80, 0, -1), -12);
  });

  it("is 0 dB at 0 %", () => {
    assert.equal(shapeGainDb(20, 0, 0), 0);
    assert.equal(shapeGainDb(-20, 0, 0), 0);
  });
});

describe("Transient Shaper readouts", () => {
  it("signs Attack, Sustain and Output", () => {
    assert.equal(formatShapePercent(0.4), "+40%");
    assert.equal(formatShapePercent(-1), "−100%");
    assert.equal(formatShapePercent(0), "0%");
    assert.equal(formatOutputDb(-6), "−6.0 dB");
    assert.equal(formatOutputDb(3.45), "+3.5 dB");
    assert.equal(formatOutputDb(0), "0.0 dB");
  });
});

describe("Transient Shaper through the audio chain", () => {
  it("passes the sound unchanged with both at 0 %", () => {
    const input = drumHit();
    const output = render(input, [shaper()]);
    assert.deepEqual(output, input);
  });

  it("raises a hit's first 5 ms at +100 % Attack and leaves its tail", () => {
    const input = drumHit();
    const [output] = render(input, [shaper({ attack: 1 })]);
    const attack = changeDb(output, input[0], HIT, HIT + 0.005);
    assert.ok(attack > 6, `the attack rose by ${attack} dB`);
    const tail = changeDb(output, input[0], HIT + 0.15, HIT + 0.6);
    assert.ok(Math.abs(tail) < 1, `the tail moved by ${tail} dB`);
  });

  it("softens a hit's first 5 ms at −100 % Attack", () => {
    const input = drumHit();
    const [output] = render(input, [shaper({ attack: -1 })]);
    const attack = changeDb(output, input[0], HIT, HIT + 0.005);
    assert.ok(attack < -6, `the attack moved by ${attack} dB`);
  });

  it("shortens the tail's decay at −100 % Sustain and keeps the attack", () => {
    const input = drumHit();
    const [output] = render(input, [shaper({ sustain: -1 })]);
    const before = decaySeconds(input[0], 30);
    const after = decaySeconds(output, 30);
    assert.ok(after < before * 0.75, `decay went from ${before}s to ${after}s`);
    const attack = changeDb(output, input[0], HIT, HIT + 0.005);
    assert.ok(Math.abs(attack) < 1, `the attack moved by ${attack} dB`);
  });

  it("lengthens the tail at +100 % Sustain", () => {
    const input = drumHit();
    const [output] = render(input, [shaper({ sustain: 1 })]);
    const tail = changeDb(output, input[0], HIT + 0.15, HIT + 0.4);
    assert.ok(tail > 6, `the tail rose by ${tail} dB`);
  });

  it("shapes a hit the same at −20 dB and −6 dB", () => {
    const settings = shaper({ attack: 0.8, sustain: -0.6 });
    const quiet = drumHit(0.1);
    const loud = drumHit(0.5);
    const [quietOut] = render(quiet, [settings]);
    const [loudOut] = render(loud, [settings]);
    for (const [from, to] of [
      [HIT, HIT + 0.005],
      [HIT + 0.02, HIT + 0.05],
      [HIT + 0.1, HIT + 0.2],
      [HIT + 0.2, HIT + 0.4],
    ]) {
      const quietChange = changeDb(quietOut, quiet[0], from, to);
      const loudChange = changeDb(loudOut, loud[0], from, to);
      assert.ok(
        Math.abs(quietChange - loudChange) < 0.1,
        `${from}–${to}s: ${quietChange} dB at −20 dB, ${loudChange} dB at −6 dB`,
      );
    }
  });

  it("applies Output as a plain gain", () => {
    const input = signal(0.5, sine(440));
    const [output] = render(input, [shaper({ output: -6 })]);
    const amplitude = 10 ** (-6 / 20);
    for (let index = 0; index < output.length; index++) {
      assert.ok(Math.abs(output[index] - input[0][index] * amplitude) < 1e-6);
    }
  });

  it("gives every channel the same gain, so the stereo image holds", () => {
    const random = noise(5);
    const frames = SAMPLE_RATE / 2;
    const left = Float32Array.from({ length: frames }, (_, index) =>
      index < frames / 4 ? 0 : random() * 0.8,
    );
    const right = Float32Array.from(left, (sample) => sample * 0.25);
    const [outLeft, outRight] = render(
      [left, right],
      [shaper({ attack: 1, sustain: -1 })],
    );
    for (let index = 0; index < frames; index++) {
      assert.ok(Math.abs(outRight[index] - outLeft[index] * 0.25) < 1e-6);
    }
  });

  it("is a bit-identical pass-through when bypassed or removed", () => {
    const input = drumHit();
    const bypassed = render(input, [
      shaper({ attack: 1, sustain: -1, output: 6, enabled: false }),
    ]);
    assert.deepEqual(bypassed, input);
    const removed = render(input, []);
    assert.deepEqual(removed, input);
  });

  it("smooths Output changes without a discontinuity", () => {
    const input = signal(1, sine(100));
    // A block boundary near the sine's peak, where an unsmoothed change
    // would jump by most of the level.
    const change = 181 * BLOCK_FRAMES;
    const [output] = render(
      input,
      [shaper({ output: -24 })],
      [{ frame: change, stages: [shaper({ output: 12 })] }],
    );
    // The sine's own steepest step at the loudest Output, plus the ramp
    // spreading the change over PARAMETER_RAMP_SECONDS.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const loudest = 0.5 * 10 ** (12 / 20);
    const bound =
      (2 * Math.PI * 100 * loudest) / SAMPLE_RATE + loudest / rampFrames;
    assert.ok(
      largestStep(output) <= bound,
      `${largestStep(output)} exceeds ${bound}`,
    );
  });

  it("smooths a Sustain change during a tail", () => {
    const input = drumHit();
    // A block in the hit's tail, where Sustain alone sets the gain.
    const change = 70 * BLOCK_FRAMES;
    const window = {
      from: change - BLOCK_FRAMES,
      to: change + 8 * BLOCK_FRAMES,
    };
    const [output] = render(
      input,
      [shaper()],
      [{ frame: change, stages: [shaper({ sustain: 1 })] }],
    );
    const [settled] = render(input, [shaper({ sustain: 1 })]);
    // Unsmoothed, the gain would jump by several dB at the change; ramped,
    // it moves no faster than the settled effect's own envelope plus the
    // ramp spreading up to 12 dB over PARAMETER_RAMP_SECONDS.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const own = largestGainStepDb(settled, input[0], window);
    const changed = largestGainStepDb(output, input[0], window);
    assert.ok(
      changed <= own + SHAPE_RANGE_DB / rampFrames,
      `the gain moved ${changed} dB in one sample, against ${own} dB settled`,
    );
    // It does reach the settled gain.
    const end = change + 2 * rampFrames;
    assert.ok(Math.abs(output[end] - settled[end]) < 1e-6);
    assert.ok(Math.abs(settled[end]) > Math.abs(input[0][end]) * 2);
  });
});

// The largest change in `output`'s gain over `input` between neighbouring
// samples within `window`, in dB.
function largestGainStepDb(
  output: Float32Array,
  input: Float32Array,
  window: { from: number; to: number },
) {
  let largest = 0;
  let previous = Number.NaN;
  for (let index = window.from; index < window.to; index++) {
    const gainDb = 20 * Math.log10(Math.abs(output[index] / input[index]));
    if (Number.isFinite(previous)) {
      largest = Math.max(largest, Math.abs(gainDb - previous));
    }
    previous = gainDb;
  }
  return largest;
}
