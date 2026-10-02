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
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import {
  CHORUS_EFFECT_NAME,
  chorusTailSeconds,
  DELAY_DEFAULT_MS,
  DELAY_KEY,
  DEPTH_DEFAULT,
  DEPTH_KEY,
  FEEDBACK_DEFAULT,
  FEEDBACK_KEY,
  MIX_DEFAULT,
  MIX_KEY,
  RATE_DEFAULT,
  RATE_KEY,
  SPREAD_DEFAULT,
  SPREAD_KEY,
} from "./chorus.ts";
import { definition } from "./definition.ts";
import { processor } from "./processor.ts";

// A low rate keeps a ramp signal's sample values small enough for Float32
// to hold their fractions, so the delay it reads back is precise.
const SAMPLE_RATE = 8000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Numbers = Record<string, number>;

function chorus(numbers: Numbers = {}, enabled = true): AudioStage {
  return {
    id: "chorus",
    effectName: CHORUS_EFFECT_NAME,
    enabled,
    numbers: {
      [RATE_KEY]: RATE_DEFAULT,
      [DEPTH_KEY]: DEPTH_DEFAULT,
      [DELAY_KEY]: DELAY_DEFAULT_MS,
      [FEEDBACK_KEY]: FEEDBACK_DEFAULT,
      [SPREAD_KEY]: SPREAD_DEFAULT,
      [MIX_KEY]: MIX_DEFAULT,
      ...numbers,
    },
    switches: {},
  };
}

type Render = {
  stages: AudioStage[];
  // Settings applied live once the render reaches `atSeconds`.
  change?: { atSeconds: number; stages: AudioStage[] };
  startSeconds?: number;
};

// Renders `input` (one array per channel) through a chain block by block,
// as both the preview worklet and the offline render do.
function render(input: Float32Array[], options: Render) {
  const channels = input.length;
  const frames = input[0].length;
  const chain = new AudioChain(registry, SAMPLE_RATE, channels);
  chain.configure(
    { stages: options.stages, inputGain: 1, delayFrames: 0 },
    TEMPO,
  );
  const output = input.map(() => new Float32Array(frames));
  const start = options.startSeconds ?? 0;
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
      start + at / SAMPLE_RATE,
    );
  }
  return output;
}

function signal(seconds: number, sample: (index: number) => number) {
  const frames = Math.round(seconds * SAMPLE_RATE);
  return Float32Array.from({ length: frames }, (_, index) => sample(index));
}

function noise(seconds: number, seed = 1) {
  let state = seed;
  return signal(seconds, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  });
}

function impulse(seconds: number) {
  return signal(seconds, (index) => (index === 0 ? 1 : 0));
}

// x[n] = n / 100. A linear interpolation of a ramp is exact, so a fully wet
// chorus's output reads back the delay it applied: n - 100 y[n] frames.
function ramp(seconds: number) {
  return signal(seconds, (index) => index / 100);
}

function delays(wet: Float32Array) {
  return Array.from(wet, (value, index) => index - value * 100);
}

const DELAY_FRAMES = (DELAY_DEFAULT_MS / 1000) * SAMPLE_RATE;

function maxStep(values: ArrayLike<number>, from = 1) {
  let max = 0;
  for (let index = Math.max(1, from); index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

describe("Chorus", () => {
  it("passes the input through unchanged at Mix 0 %", () => {
    const input = [noise(1, 1), noise(1, 2)];
    const [left, right] = render(input, {
      stages: [chorus({ [MIX_KEY]: 0, [FEEDBACK_KEY]: 0.9 })],
    });
    assert.deepEqual(left, input[0]);
    assert.deepEqual(right, input[1]);
  });

  it("applies one constant delay at Depth 0 %, a comb filter", () => {
    const [output] = render([impulse(0.5)], {
      stages: [chorus({ [DEPTH_KEY]: 0 })],
    });
    // Half the impulse now, half one delay later, and nothing else.
    const nonzero = [...output.entries()].filter(([, value]) => value !== 0);
    assert.deepEqual(nonzero, [
      [0, 0.5],
      [DELAY_FRAMES, 0.5],
    ]);
  });

  it("sweeps the delay with the LFO's period at Rate 1 Hz", () => {
    const [wet] = render([ramp(3)], {
      stages: [chorus({ [RATE_KEY]: 1, [DEPTH_KEY]: 1, [MIX_KEY]: 1 })],
    });
    const delay = delays(wet);
    const swing = DELAY_FRAMES / 2;
    for (let index = DELAY_FRAMES * 2; index < delay.length; index += 97) {
      const seconds = index / SAMPLE_RATE;
      const expected = DELAY_FRAMES + swing * Math.sin(2 * Math.PI * seconds);
      assert.ok(
        Math.abs(delay[index] - expected) < 0.05,
        `delay at ${seconds}s is ${delay[index]}, not ${expected}`,
      );
      if (index + SAMPLE_RATE < delay.length) {
        assert.ok(Math.abs(delay[index + SAMPLE_RATE] - delay[index]) < 0.05);
      }
    }
  });

  it("follows the timeline time, so a render from any point agrees", () => {
    const stages = [chorus({ [DEPTH_KEY]: 1, [MIX_KEY]: 1 })];
    const offset = 2;
    const [whole] = render([ramp(3)], { stages });
    // The same ramp, rendered from timeline second 2 with its values
    // shifted so the delay reads the same way.
    const [late] = render(
      [signal(1, (index) => (index + offset * SAMPLE_RATE) / 100)],
      { stages, startSeconds: offset },
    );
    // Its values run offset seconds ahead of its frame numbers.
    const lateDelay = delays(late).map((value) => value + offset * SAMPLE_RATE);
    const wholeDelay = delays(whole);
    for (let index = DELAY_FRAMES * 2; index < late.length; index += 53) {
      assert.ok(
        Math.abs(lateDelay[index] - wholeDelay[index + offset * SAMPLE_RATE]) <
          0.05,
      );
    }
  });

  it("modulates left and right in opposite phase at Spread 100 %", () => {
    const [left, right] = render([ramp(2), ramp(2)], {
      stages: [chorus({ [DEPTH_KEY]: 1, [MIX_KEY]: 1, [SPREAD_KEY]: 1 })],
    });
    const leftDelay = delays(left);
    const rightDelay = delays(right);
    let swing = 0;
    for (let index = DELAY_FRAMES * 2; index < left.length; index++) {
      const l = leftDelay[index] - DELAY_FRAMES;
      const r = rightDelay[index] - DELAY_FRAMES;
      assert.ok(Math.abs(l + r) < 0.05, `${l} and ${r} are not opposite`);
      swing = Math.max(swing, Math.abs(l));
    }
    assert.ok(swing > DELAY_FRAMES / 2 - 0.5);
  });

  it("modulates left and right together at Spread 0 %", () => {
    const [left, right] = render([ramp(1), ramp(1)], {
      stages: [chorus({ [DEPTH_KEY]: 1, [MIX_KEY]: 1, [SPREAD_KEY]: 0 })],
    });
    assert.deepEqual(left, right);
  });

  it("recirculates nothing at Feedback 0 %", () => {
    const [output] = render([impulse(0.5)], {
      stages: [chorus({ [DEPTH_KEY]: 0, [MIX_KEY]: 1, [FEEDBACK_KEY]: 0 })],
    });
    const nonzero = [...output.entries()].filter(([, value]) => value !== 0);
    assert.deepEqual(nonzero, [[DELAY_FRAMES, 1]]);
  });

  it("repeats the delay at the Feedback level", () => {
    const [output] = render([impulse(0.5)], {
      stages: [chorus({ [DEPTH_KEY]: 0, [MIX_KEY]: 1, [FEEDBACK_KEY]: 0.5 })],
    });
    assert.equal(output[DELAY_FRAMES], 1);
    assert.equal(output[DELAY_FRAMES * 2], 0.5);
    assert.equal(output[DELAY_FRAMES * 3], 0.25);
  });

  it("passes the input through bit for bit when bypassed or removed", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const bypassed = render(input, {
      stages: [chorus({ [FEEDBACK_KEY]: 0.5 }, false)],
    });
    assert.deepEqual(bypassed, input);
    const removed = render(input, {
      stages: [chorus({ [FEEDBACK_KEY]: 0.5 })],
      change: { atSeconds: 0.5, stages: [] },
    });
    // The chain applies settings from the first block at or after 0.5 s.
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("ramps a live Mix change instead of jumping", () => {
    const sine = () =>
      signal(1, (index) => Math.sin((2 * Math.PI * 200 * index) / SAMPLE_RATE));
    const settled = render([sine()], { stages: [chorus({ [MIX_KEY]: 1 })] });
    const changed = render([sine()], {
      stages: [chorus({ [MIX_KEY]: 0 })],
      change: { atSeconds: 0.5, stages: [chorus({ [MIX_KEY]: 1 })] },
    });
    // Moving between dry and wet, both within ±1, adds at most 2 per ramp.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const steady = Math.max(
      maxStep(sine()),
      maxStep(settled[0], DELAY_FRAMES * 2),
    );
    assert.ok(maxStep(changed[0]) <= steady + 2 / rampFrames + 1e-6);
  });

  it("keeps the LFO phase continuous through a live Rate change", () => {
    const [wet] = render([ramp(8)], {
      startSeconds: 10,
      stages: [chorus({ [RATE_KEY]: 0.8, [DEPTH_KEY]: 1, [MIX_KEY]: 1 })],
      change: {
        atSeconds: 1,
        stages: [chorus({ [RATE_KEY]: 5, [DEPTH_KEY]: 1, [MIX_KEY]: 1 })],
      },
    });
    const delay = delays(wet);
    // At 5 Hz the delay moves at most 2π · 5 Hz · swing frames per second;
    // a phase jump would move it far faster.
    const swing = DELAY_FRAMES / 2;
    const fastest = (2 * Math.PI * 5 * swing) / SAMPLE_RATE;
    assert.ok(maxStep(delay, DELAY_FRAMES * 2) < fastest * 1.5);

    // Then it drifts back into step with the timeline.
    const index = delay.length - 1;
    const seconds = 10 + index / SAMPLE_RATE;
    const expected = DELAY_FRAMES + swing * Math.sin(2 * Math.PI * 5 * seconds);
    assert.ok(Math.abs(delay[index] - expected) < 0.05);
  });
});

describe("chorusTailSeconds", () => {
  it("is the longest delay without feedback", () => {
    assert.ok(Math.abs(chorusTailSeconds(20, 1, 0) - 0.03) < 1e-12);
  });

  it("grows with the feedback passes needed to fall 60 dB", () => {
    // 0.5^10 is the first power of 0.5 under 0.001.
    assert.equal(chorusTailSeconds(10, 0, 0.5), 0.01 * 11);
    assert.ok(chorusTailSeconds(10, 0, 0.9) > chorusTailSeconds(10, 0, 0.5));
  });
});

describe("Chorus definition", () => {
  it("has the specified ranges and defaults", () => {
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
            ]
          : [parameter.key],
      ),
      [
        ["Rate", 0.05, 5, 0.8],
        ["Depth", 0, 1, 0.5],
        ["Delay", 5, 30, 15],
        ["Feedback", 0, 0.9, 0],
        ["Spread", 0, 1, 0.5],
        ["Mix", 0, 1, 0.5],
      ],
    );
  });

  it("shows readable values", () => {
    const shown = definition.parameters.map((parameter) =>
      parameter.kind === "number"
        ? parameter.format(parameter.defaultValue)
        : "",
    );
    assert.deepEqual(shown, ["0.80 Hz", "50%", "15.0 ms", "0%", "50%", "50%"]);
  });

  it("is offered in the Audio group of the clip, layer and Global menus", () => {
    for (const group of ["clip", "layer", "global"] as const) {
      const audio = groupAddableEffects(addableEffectsFor(group)).find(
        (entry) => entry.domain === "audio",
      );
      assert.ok(
        audio?.effects.some((effect) => effect.effectName === "Chorus"),
        `Chorus is missing from the ${group} menu`,
      );
    }
    assert.ok(
      addableEffectsFor("clip", "audio").some(
        (effect) => effect.effectName === "Chorus",
      ),
    );
  });
});
