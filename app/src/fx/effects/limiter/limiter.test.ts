import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  chainLatencyFrames,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import {
  type AudioEffectProcessor,
  type AudioParameterBlock,
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import {
  formatDb,
  formatLookaheadMs,
  formatReleaseMs,
  LimiterGain,
  lookaheadFrames,
} from "./limiter.ts";
import { processor } from "./processor.ts";

const SAMPLE_RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);
// The default 5 ms lookahead.
const LATENCY = 240;

function limiter(
  settings: {
    ceiling?: number;
    release?: number;
    lookahead?: number;
    gain?: number;
    enabled?: boolean;
  } = {},
): AudioStage {
  return {
    id: "limiter",
    effectName: "Limiter",
    enabled: settings.enabled ?? true,
    numbers: {
      Ceiling: settings.ceiling ?? -1,
      Release: settings.release ?? 50,
      Lookahead: settings.lookahead ?? 5,
      Gain: settings.gain ?? 0,
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

const dbToAmplitude = (db: number) => 10 ** (db / 20);

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

function peak(channel: Float32Array, from = 0, to = channel.length) {
  let largest = 0;
  for (let index = from; index < to; index++) {
    largest = Math.max(largest, Math.abs(channel[index]));
  }
  return largest;
}

// The largest jump between neighboring samples.
function largestStep(channel: Float32Array, from = 1, to = channel.length) {
  let largest = 0;
  for (let index = Math.max(1, from); index < to; index++) {
    largest = Math.max(largest, Math.abs(channel[index] - channel[index - 1]));
  }
  return largest;
}

// Float32 rounding of the output samples.
const EPSILON = 1e-6;

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

describe("Limiter readouts", () => {
  it("formats its decibels and times", () => {
    assert.equal(formatDb(-1), "−1.0 dB");
    assert.equal(formatDb(6), "+6.0 dB");
    assert.equal(formatDb(0), "0.0 dB");
    assert.equal(formatReleaseMs(50), "50 ms");
    assert.equal(formatReleaseMs(2.5), "2.5 ms");
    assert.equal(formatReleaseMs(1000), "1.00 s");
    assert.equal(formatLookaheadMs(5), "5.0 ms");
  });
});

describe("LimiterGain", () => {
  it("never gives a frame more than its required gain", () => {
    const random = noise(3);
    const lookahead = 24;
    const gain = new LimiterGain(lookahead);
    const required: number[] = [];
    for (let frame = 0; frame < 20_000; frame++) {
      required.push(random() > 0.45 ? 0.1 + random() : 1);
      const value = gain.next(frame, Math.min(1, required[frame]), 0.99);
      if (frame >= lookahead) {
        assert.ok(value <= Math.min(1, required[frame - lookahead]) + 1e-12);
      }
    }
  });

  it("ramps down across the lookahead instead of stepping", () => {
    const lookahead = 100;
    const gain = new LimiterGain(lookahead);
    const values = [];
    for (let frame = 0; frame < 400; frame++) {
      values.push(gain.next(frame, frame === 200 ? 0.5 : 1, 0.999));
    }
    // It starts falling as the peak enters and reaches 0.5 as it leaves.
    assert.equal(values[199], 1);
    assert.ok(Math.abs(values[200] - (1 - 0.5 / 101)) < 1e-12);
    assert.ok(Math.abs(values[200 + lookahead] - 0.5) < 1e-12);
    for (let frame = 201; frame <= 200 + lookahead; frame++) {
      assert.ok(values[frame - 1] - values[frame] < 0.5 / 100);
    }
  });
});

describe("Limiter reset", () => {
  const numbers = { Ceiling: -3, Release: 30, Lookahead: 5, Gain: 12 };

  it("restarts a gain computer exactly as new at another lookahead", () => {
    const reused = new LimiterGain(480, 480);
    const input = noise(3);
    for (let frame = 0; frame < 2000; frame++) {
      reused.next(frame, Math.min(1, 0.2 / Math.abs(input())), 0.99);
    }
    reused.reset(100);
    const fresh = new LimiterGain(100);
    for (let frame = 0; frame < 2000; frame++) {
      const required = Math.min(1, 0.2 / Math.abs(input()));
      assert.equal(
        reused.next(frame, required, 0.99),
        fresh.next(frame, required, 0.99),
      );
    }
  });

  it("sounds exactly like a fresh processor after a reset", () => {
    const used = processor.createProcessor(SAMPLE_RATE, 2);
    runSettled(used, signal(0.3, noise(2)), numbers);
    // A Lookahead change, reset while it still fades.
    runSettled(used, signal(0.01, noise(3)), { ...numbers, Lookahead: 2 });
    used.reset();
    const fresh = processor.createProcessor(SAMPLE_RATE, 2);
    const test = signal(0.5, sine(440));
    assert.deepEqual(
      runSettled(used, test, numbers),
      runSettled(fresh, test, numbers),
    );
  });
});

describe("Limiter through the audio chain", () => {
  it("reports its lookahead as the chain's latency", () => {
    assert.equal(lookaheadFrames(5, SAMPLE_RATE), LATENCY);
    assert.equal(
      chainLatencyFrames(registry, [limiter()], SAMPLE_RATE),
      LATENCY,
    );
    assert.equal(
      chainLatencyFrames(registry, [limiter({ lookahead: 0 })], SAMPLE_RATE),
      0,
    );
    assert.equal(
      chainLatencyFrames(registry, [limiter({ enabled: false })], SAMPLE_RATE),
      0,
    );
  });

  it("holds a +6 dBFS sine's peaks at the Ceiling", () => {
    const input = signal(1, sine(997, dbToAmplitude(6)));
    for (const ceiling of [-1, -6, -20, 0]) {
      for (const lookahead of [5, 0, 10, 1.3]) {
        const output = render(input, [limiter({ ceiling, lookahead })]);
        for (const channel of output) {
          assert.ok(
            peak(channel) <= dbToAmplitude(ceiling) + EPSILON,
            `${peak(channel)} at ${ceiling} dB, ${lookahead} ms`,
          );
        }
        // It limits, rather than silencing: the peaks reach the Ceiling.
        assert.ok(peak(output[0]) > dbToAmplitude(ceiling) * 0.98);
      }
    }
  });

  it("holds loud noise and an impulse under the Ceiling", () => {
    const random = noise(17);
    const loud = Float32Array.from(
      { length: SAMPLE_RATE },
      (_, index) => random() * 6 * (1 + Math.sin(index / 900)),
    );
    const impulse = new Float32Array(SAMPLE_RATE / 2);
    impulse[12_345] = 8;
    for (const input of [
      [loud, Float32Array.from(loud, (sample) => -0.5 * sample)],
      [impulse, new Float32Array(impulse.length)],
    ]) {
      const output = render(input, [limiter({ release: 1 })]);
      for (const channel of output) {
        assert.ok(peak(channel) <= dbToAmplitude(-1) + EPSILON);
      }
    }
  });

  it("passes a signal 6 dB under the Ceiling unchanged, after the latency", () => {
    const input = signal(0.5, sine(440, dbToAmplitude(-7)));
    const output = render(input, [limiter()]);
    for (let channel = 0; channel < 2; channel++) {
      for (let index = 0; index < LATENCY; index++) {
        assert.equal(output[channel][index], 0);
      }
      for (let index = LATENCY; index < input[0].length; index++) {
        assert.equal(output[channel][index], input[channel][index - LATENCY]);
      }
    }
  });

  it("raises the level with Gain until it is limited", () => {
    const input = signal(0.5, sine(440, dbToAmplitude(-13)));
    const settledPeak = (gain: number) => {
      const [output] = render(input, [limiter({ gain })]);
      return peak(output, SAMPLE_RATE / 4);
    };
    assert.ok(Math.abs(settledPeak(0) - dbToAmplitude(-13)) < EPSILON);
    assert.ok(Math.abs(settledPeak(6) - dbToAmplitude(-7)) < 1e-4);
    // 24 dB of drive would take it to +11 dB; it stops at the Ceiling.
    const limited = settledPeak(24);
    assert.ok(limited <= dbToAmplitude(-1) + EPSILON);
    assert.ok(limited > dbToAmplitude(-1) * 0.98);
  });

  it("keeps a limited sound aligned with the dry one after the latency", () => {
    // A 100 Hz burst at +6 dBFS: limited, it keeps its zero crossings.
    const input = signal(0.5, (index) =>
      index >= 4800 && index < 14_400 ? sine(100, 2)(index) : 0,
    );
    const [output] = render(input, [limiter({ release: 1000 })]);
    assert.equal(peak(output, 0, 4800 + LATENCY), 0);
    for (let index = 5000; index < 14_000; index++) {
      const dry = input[0][index];
      const wet = output[index + LATENCY];
      if (Math.abs(dry) > 0.01) {
        assert.equal(Math.sign(wet), Math.sign(dry));
      }
    }
    assert.ok(peak(output, 14_400 + LATENCY) === 0);
  });

  it("gives every channel the same gain, so the stereo image holds", () => {
    const random = noise(5);
    const left = Float32Array.from(
      { length: SAMPLE_RATE / 2 },
      () => random() * 4,
    );
    const right = Float32Array.from(left, (sample) => sample * 0.25);
    const [outLeft, outRight] = render([left, right], [limiter()]);
    for (let index = 0; index < left.length; index++) {
      assert.ok(Math.abs(outRight[index] - outLeft[index] * 0.25) < 1e-6);
    }
  });

  it("is a bit-identical pass-through when bypassed or removed", () => {
    const input = signal(0.5, sine(440, 2));
    const bypassed = render(input, [
      limiter({ ceiling: -20, gain: 24, enabled: false }),
    ]);
    assert.deepEqual(bypassed, input);
    const removed = render(input, []);
    assert.deepEqual(removed, input);
  });

  it("smooths Ceiling and Gain changes without a discontinuity", () => {
    const input = signal(1, sine(100, dbToAmplitude(-6)));
    // A block boundary near the sine's peak.
    const change = 181 * BLOCK_FRAMES;
    for (const [before, after] of [
      [limiter({ ceiling: -20 }), limiter({ ceiling: 0 })],
      [limiter({ gain: 0, ceiling: 0 }), limiter({ gain: 24, ceiling: 0 })],
    ]) {
      const [output] = render(
        input,
        [before],
        [{ frame: change, stages: [after] }],
      );
      // The sine's own steepest step at full scale, plus the ramp spreading
      // a full-scale change over PARAMETER_RAMP_SECONDS.
      const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
      const bound = (2 * Math.PI * 100) / SAMPLE_RATE + 1 / rampFrames;
      const step = largestStep(output, LATENCY + 1);
      assert.ok(step <= bound, `${step} exceeds ${bound}`);
    }
  });

  it("crossfades a Lookahead change without a discontinuity", () => {
    const input = signal(1, sine(100, 2));
    const change = 181 * BLOCK_FRAMES;
    const [output] = render(
      input,
      [limiter({ lookahead: 0.5 })],
      [{ frame: change, stages: [limiter({ lookahead: 10 })] }],
    );
    assert.ok(peak(output) <= dbToAmplitude(-1) + EPSILON);
    // The settled sine's own steepest step, and a crossfade between two
    // delays of the same sine, which moves no faster.
    const around = largestStep(output, change - 2000, change + 4000);
    const settled = largestStep(output, change + 8000, change + 12_000);
    assert.ok(around <= settled * 1.6, `${around} against ${settled}`);
    // It settles at the new latency.
    const [expected] = render(input, [limiter({ lookahead: 10 })]);
    const end = input[0].length - 1;
    assert.ok(Math.abs(output[end] - expected[end]) < EPSILON);
  });
});
