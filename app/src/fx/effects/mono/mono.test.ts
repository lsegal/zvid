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
import { blendToMono, monoSample } from "./mono.ts";
import { processor } from "./processor.ts";

const SAMPLE_RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

function mono(
  settings: { source?: string; amount?: number; enabled?: boolean } = {},
): AudioStage {
  return {
    id: "mono",
    effectName: "Mono",
    enabled: settings.enabled ?? true,
    numbers: { Amount: settings.amount ?? 1 },
    switches: { Source: settings.source ?? "Sum" },
  };
}

// A stereo test signal, `seconds` long, from a sample function per channel.
function signal(
  seconds: number,
  channels: readonly ((index: number) => number)[],
) {
  const frames = Math.round(seconds * SAMPLE_RATE);
  return channels.map((sample) => Float32Array.from({ length: frames }, (_, i) => sample(i)));
}

const sine = (hz: number, level = 0.5, phase = 0) => (index: number) =>
  level * Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE + phase);

// Deterministic noise, so failures reproduce.
function noise(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
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

function assertClose(
  actual: Float32Array,
  expected: (index: number) => number,
  tolerance = 1e-6,
) {
  for (let index = 0; index < actual.length; index++) {
    const want = expected(index);
    assert.ok(
      Math.abs(actual[index] - want) <= tolerance,
      `frame ${index}: ${actual[index]} is not ${want}`,
    );
  }
}

// The largest jump between neighbouring samples.
function largestStep(channel: Float32Array) {
  let largest = 0;
  for (let index = 1; index < channel.length; index++) {
    largest = Math.max(largest, Math.abs(channel[index] - channel[index - 1]));
  }
  return largest;
}

describe("monoSample", () => {
  it("halves the sum, so a full-scale stereo pair cannot clip", () => {
    assert.equal(monoSample("Sum", 1, 1), 1);
    assert.equal(monoSample("Sum", 0.5, -0.25), 0.125);
  });

  it("picks one side for Left and Right", () => {
    assert.equal(monoSample("Left", 0.3, -0.7), 0.3);
    assert.equal(monoSample("Right", 0.3, -0.7), -0.7);
  });
});

describe("blendToMono", () => {
  it("goes from the original at 0 to mono at 1, clamped", () => {
    assert.equal(blendToMono(1, 0, 0), 1);
    assert.equal(blendToMono(1, 0, 0.5), 0.5);
    assert.equal(blendToMono(1, 0, 1), 0);
    assert.equal(blendToMono(1, 0, 2), 0);
    assert.equal(blendToMono(1, 0, -1), 1);
  });
});

describe("Mono through the audio chain", () => {
  const left = sine(440);
  const right = sine(660, 0.3);
  const stereo = () => signal(1, [left, right]);

  it("makes a stereo signal identical on both channels at 100 %", () => {
    const [outLeft, outRight] = render(stereo(), [mono()]);
    assert.deepEqual(outLeft, outRight);
    assertClose(outLeft, (i) => (left(i) + right(i)) / 2);
  });

  it("takes the left or right side for Left and Right", () => {
    const fromLeft = render(stereo(), [mono({ source: "Left" })]);
    assertClose(fromLeft[0], left);
    assertClose(fromLeft[1], left);
    const fromRight = render(stereo(), [mono({ source: "Right" })]);
    assertClose(fromRight[0], right);
    assertClose(fromRight[1], right);
  });

  it("blends halfway at 50 %", () => {
    const [outLeft, outRight] = render(stereo(), [mono({ amount: 0.5 })]);
    const middle = (i: number) => (left(i) + right(i)) / 2;
    assertClose(outLeft, (i) => (left(i) + middle(i)) / 2);
    assertClose(outRight, (i) => (right(i) + middle(i)) / 2);
  });

  it("leaves a mono-compatible signal's level unchanged", () => {
    const random = noise(7);
    const shared = Float32Array.from(
      { length: SAMPLE_RATE },
      () => random() * 0.8,
    );
    const input = [shared, Float32Array.from(shared)];
    const [outLeft, outRight] = render(input, [mono()]);
    assert.deepEqual(outLeft, shared);
    assert.deepEqual(outRight, shared);
  });

  it("passes a one-channel input through unchanged", () => {
    const input = signal(0.5, [sine(220)]);
    const [output] = render(input, [mono({ source: "Right" })]);
    assert.deepEqual(output, input[0]);
  });

  it("is a bit-identical pass-through when bypassed or removed", () => {
    const random = noise(3);
    const input = signal(0.5, [() => random(), () => random()]);
    const bypassed = render(input, [mono({ enabled: false })]);
    assert.deepEqual(bypassed, input);
    const removed = render(input, []);
    assert.deepEqual(removed, input);
  });

  it("passes the impulse of either side to both channels", () => {
    const input = signal(0.1, [(i) => (i === 300 ? 1 : 0), () => 0]);
    const [outLeft, outRight] = render(input, [mono()]);
    assert.equal(outLeft[300], 0.5);
    assert.equal(outRight[300], 0.5);
    assert.equal(outLeft[301], 0);
  });

  // A block boundary where the 100 Hz test sine is near its peak, so an
  // unsmoothed change there would jump by about the full level.
  const PEAK_FRAME = 181 * BLOCK_FRAMES;

  // Opposite sides cancel at 100 %, so an unsmoothed Amount change would
  // jump by the full level in one frame.
  it("smooths Amount changes without a discontinuity", () => {
    const input = signal(1, [sine(100), sine(100, 0.5, Math.PI)]);
    const change = PEAK_FRAME;
    const [output] = render(
      input,
      [mono({ amount: 0 })],
      [{ frame: change, stages: [mono({ amount: 1 })] }],
    );
    // The sine's own steepest step plus the ramp spreading the 0.5 change
    // over PARAMETER_RAMP_SECONDS.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const bound = (2 * Math.PI * 100 * 0.5) / SAMPLE_RATE + 0.5 / rampFrames;
    assert.ok(
      largestStep(output) <= bound * 1.01,
      `${largestStep(output)} exceeds ${bound}`,
    );
    // It still reaches mono, where the two sides cancel.
    const settled = output.subarray(change + 2 * rampFrames);
    assert.ok(settled.every((sample) => Math.abs(sample) < 1e-6));
  });

  it("crossfades a Source change without a discontinuity", () => {
    const input = signal(1, [sine(100), sine(100, 0.5, Math.PI)]);
    const [output] = render(
      input,
      [mono({ source: "Left" })],
      [{ frame: PEAK_FRAME, stages: [mono({ source: "Right" })] }],
    );
    // Left to Right flips the sign; without the crossfade that is a jump of
    // up to twice the level.
    assert.ok(largestStep(output) < 0.015, `${largestStep(output)}`);
  });
});
