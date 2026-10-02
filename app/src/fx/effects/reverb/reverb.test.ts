import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import { testStage } from "../../../audio-mix/chain-test-utils.ts";
import { renderAudioMix } from "../../../audio-mix/mix.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import type { AudioMix } from "../../../audio-mix/resolve.ts";
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import { processor as gainProcessor, gainStageAt } from "../gain/processor.ts";
import { definition } from "./definition.ts";
import { processor } from "./processor.ts";
import {
  DAMPING_DEFAULT,
  DAMPING_KEY,
  DAMPING_MAX,
  DECAY_DEFAULT,
  DECAY_KEY,
  MIX_DEFAULT,
  MIX_KEY,
  PRE_DELAY_DEFAULT_MS,
  PRE_DELAY_KEY,
  REVERB_EFFECT_NAME,
  reverbTailSeconds,
  SIZE_DEFAULT,
  SIZE_KEY,
} from "./reverb.ts";

// 8 kHz keeps the renders quick, and puts Damping's 20 kHz maximum above
// Nyquist, so the full band decays at Decay.
const SAMPLE_RATE = 8000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([gainProcessor, processor]);

type Numbers = Record<string, number>;

function reverb(numbers: Numbers = {}, enabled = true): AudioStage {
  return testStage(
    REVERB_EFFECT_NAME,
    {
      [DECAY_KEY]: DECAY_DEFAULT,
      [PRE_DELAY_KEY]: PRE_DELAY_DEFAULT_MS,
      [SIZE_KEY]: SIZE_DEFAULT,
      [DAMPING_KEY]: DAMPING_DEFAULT,
      [MIX_KEY]: MIX_DEFAULT,
      ...numbers,
    },
    { id: "reverb", enabled },
  );
}

type Render = {
  stages: AudioStage[];
  // Settings applied live once the render reaches `atSeconds`.
  change?: { atSeconds: number; stages: AudioStage[] };
  sampleRate?: number;
};

// Renders `input` (one array per channel) through a chain block by block,
// as both the preview worklet and the offline render do.
function render(input: Float32Array[], options: Render) {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const channels = input.length;
  const frames = input[0].length;
  const chain = new AudioChain(registry, sampleRate, channels);
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
      at / sampleRate >= options.change.atSeconds
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
      at / sampleRate,
    );
  }
  return output;
}

function signal(
  seconds: number,
  sample: (index: number) => number,
  sampleRate = SAMPLE_RATE,
) {
  const frames = Math.round(seconds * sampleRate);
  return Float32Array.from({ length: frames }, (_, index) => sample(index));
}

function noise(seconds: number, seed = 1) {
  let state = seed;
  return signal(seconds, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  });
}

function impulse(seconds: number, sampleRate = SAMPLE_RATE) {
  return signal(seconds, (index) => (index === 0 ? 1 : 0), sampleRate);
}

function sine(seconds: number, hz = 200) {
  return signal(seconds, (index) =>
    Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE),
  );
}

// Two one-pole low-passes at `hz`, to measure a band of the response.
function lowPass(data: Float32Array, hz: number, sampleRate: number) {
  const a = Math.exp((-2 * Math.PI * hz) / sampleRate);
  const output = new Float32Array(data.length);
  let first = 0;
  let second = 0;
  for (let index = 0; index < data.length; index++) {
    first = data[index] + a * (first - data[index]);
    second = first + a * (second - first);
    output[index] = second;
  }
  return output;
}

// The second at which the energy still to come (Schroeder's backward
// integral) falls 60 dB below the whole response's.
function rt60(data: Float32Array, sampleRate: number) {
  const remaining = new Float64Array(data.length + 1);
  for (let index = data.length - 1; index >= 0; index--) {
    remaining[index] = remaining[index + 1] + data[index] ** 2;
  }
  const index = remaining.findIndex((energy) => energy <= remaining[0] * 1e-6);
  assert.ok(index > 0, "the response never fell 60 dB");
  return index / sampleRate;
}

function energy(data: Float32Array, from = 0, to = data.length) {
  let total = 0;
  for (let index = from; index < to; index++) {
    total += data[index] ** 2;
  }
  return total;
}

function firstNonzero(data: Float32Array) {
  return data.findIndex((value) => value !== 0);
}

function maxStep(values: ArrayLike<number>, from = 1) {
  let max = 0;
  for (let index = Math.max(1, from); index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

describe("Reverb", () => {
  it("passes the input through unchanged at Mix 0 %", () => {
    const input = [noise(1, 1), noise(1, 2)];
    const output = render(input, {
      stages: [reverb({ [MIX_KEY]: 0, [DECAY_KEY]: 10 })],
    });
    assert.deepEqual(output, input);
  });

  it("falls 60 dB in Decay, within 10 %, at any Size", () => {
    for (const [decay, size] of [
      [0.5, 0],
      [1, 1],
      [2, 0.5],
    ]) {
      const [left, right] = render(
        [impulse(decay * 1.3 + 0.2), impulse(decay * 1.3 + 0.2)],
        {
          stages: [
            reverb({
              [DECAY_KEY]: decay,
              [SIZE_KEY]: size,
              [PRE_DELAY_KEY]: 0,
              [DAMPING_KEY]: DAMPING_MAX,
              [MIX_KEY]: 1,
            }),
          ],
        },
      );
      for (const side of [left, right]) {
        const measured = rt60(side, SAMPLE_RATE);
        assert.ok(
          Math.abs(measured - decay) <= decay * 0.1,
          `Decay ${decay} s at Size ${size} rang for ${measured} s`,
        );
      }
    }
  });

  it("decays its low band in Decay at 48 kHz with the default Damping", () => {
    const sampleRate = 48_000;
    const [wet] = render([impulse(2.8, sampleRate)], {
      sampleRate,
      stages: [reverb({ [PRE_DELAY_KEY]: 0, [MIX_KEY]: 1 })],
    });
    const measured = rt60(lowPass(wet, 300, sampleRate), sampleRate);
    assert.ok(
      Math.abs(measured - DECAY_DEFAULT) <= DECAY_DEFAULT * 0.1,
      `the low band rang for ${measured} s`,
    );
  });

  it("delays the first wet sample by the Pre-delay", () => {
    const first = (preDelay: number) => {
      const [wet] = render([impulse(0.5)], {
        stages: [reverb({ [PRE_DELAY_KEY]: preDelay, [MIX_KEY]: 1 })],
      });
      return firstNonzero(wet);
    };
    assert.equal(first(0), 0);
    assert.equal(first(100), 0.1 * SAMPLE_RATE);
    assert.equal(first(200), 0.2 * SAMPLE_RATE);
  });

  it("keeps more high-frequency energy late in the tail at a higher Damping", () => {
    const sampleRate = 48_000;
    // The share of the tail from 0.5 to 1 s above roughly 4 kHz.
    const brightness = (damping: number) => {
      const [wet] = render([impulse(1, sampleRate)], {
        sampleRate,
        stages: [reverb({ [DAMPING_KEY]: damping, [MIX_KEY]: 1 })],
      });
      const low = lowPass(wet, 4000, sampleRate);
      const high = wet.map((value, index) => value - low[index]);
      const from = sampleRate / 2;
      return energy(high, from) / energy(wet, from);
    };
    const dark = brightness(2000);
    const bright = brightness(16_000);
    assert.ok(bright > dark * 4, `${bright} is not well above ${dark}`);
  });

  it("renders identically every time, so the preview and an export agree", () => {
    const input = [noise(1, 5), noise(1, 6)];
    const stages = [reverb({ [MIX_KEY]: 0.7, [SIZE_KEY]: 0.8 })];
    assert.deepEqual(render(input, { stages }), render(input, { stages }));
  });

  it("passes the input through bit for bit when bypassed or removed", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const bypassed = render(input, {
      stages: [reverb({ [MIX_KEY]: 1 }, false)],
    });
    assert.deepEqual(bypassed, input);
    const removed = render(input, {
      stages: [reverb({ [MIX_KEY]: 1 })],
      change: { atSeconds: 0.5, stages: [] },
    });
    // The chain applies settings from the first block at or after 0.5 s.
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("ramps a live Mix change instead of jumping", () => {
    const settled = render([sine(1)], { stages: [reverb({ [MIX_KEY]: 1 })] });
    const changed = render([sine(1)], {
      stages: [reverb({ [MIX_KEY]: 0 })],
      change: { atSeconds: 0.5, stages: [reverb({ [MIX_KEY]: 1 })] },
    });
    // Moving between dry and wet adds at most their difference per ramp.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const swing = 1 + Math.max(...settled[0].map(Math.abs));
    const steady = Math.max(maxStep(sine(1)), maxStep(settled[0]));
    assert.ok(maxStep(changed[0]) <= steady + swing / rampFrames + 1e-6);
  });

  it("changes Decay, Size, Pre-delay and Damping live without a click", () => {
    const base = {
      [DECAY_KEY]: 0.5,
      [SIZE_KEY]: 0,
      [PRE_DELAY_KEY]: 0,
      [DAMPING_KEY]: 2000,
      [MIX_KEY]: 1,
    };
    for (const change of [
      { [DECAY_KEY]: 4 },
      { [SIZE_KEY]: 1 },
      { [PRE_DELAY_KEY]: 200 },
      { [DAMPING_KEY]: 16_000 },
    ]) {
      const from = reverb(base);
      const to = reverb({ ...base, ...change });
      const before = render([sine(1.5)], { stages: [from] });
      const after = render([sine(1.5)], { stages: [to] });
      const changed = render([sine(1.5)], {
        stages: [from],
        change: { atSeconds: 0.75, stages: [to] },
      });
      // No step larger than either setting's own, give or take.
      const steady = Math.max(maxStep(before[0]), maxStep(after[0]));
      assert.ok(
        maxStep(changed[0]) <= steady * 1.25,
        `${JSON.stringify(change)} jumps ${maxStep(changed[0])}, not ${steady}`,
      );
    }
  });
});

describe("Reverb tail", () => {
  it("lasts the pre-delay and the reflections, then Decay", () => {
    assert.ok(Math.abs(reverbTailSeconds(2, 0, 0) - 2.013225) < 1e-9);
    assert.ok(reverbTailSeconds(2, 200, 1) > reverbTailSeconds(2, 0, 1) + 0.19);
    assert.ok(reverbTailSeconds(10, 20, 0.5) > 10);
    assert.equal(
      processor.tailSeconds?.(
        {
          numbers: { [DECAY_KEY]: 3, [PRE_DELAY_KEY]: 50, [SIZE_KEY]: 0.2 },
          switches: {},
        },
        TEMPO,
      ),
      reverbTailSeconds(3, 50, 0.2),
    );
  });

  it("rings past the clip's end in an export, also from a later range", () => {
    const click = new Float32Array(2 * SAMPLE_RATE);
    click[Math.round(0.1 * SAMPLE_RATE)] = 0.5;
    const audioMix: AudioMix = {
      clips: [
        {
          id: "click",
          mediaId: "click",
          startSeconds: 0,
          durationSeconds: 0.5,
          sourceOffsetSeconds: 0,
          sourceWindowStartSeconds: 0,
          sourceWindowEndSeconds: 2,
          effects: [],
          amplitude: 1,
          hasGain: true,
          busId: "bus",
          stages: [gainStageAt(1), reverb({ [DECAY_KEY]: 1, [MIX_KEY]: 1 })],
        },
      ],
      buses: [{ id: "bus", stages: [] }],
      master: [],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 120,
      signature: DEFAULT_TIME_SIGNATURE,
    };
    const exportFrom = (startSeconds: number, seconds: number) => {
      const [output] = renderAudioMix(
        audioMix,
        new Map([["click", { sampleRate: SAMPLE_RATE, channels: [click] }]]),
        {
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          startSeconds,
          length: Math.round(seconds * SAMPLE_RATE),
        },
        registry,
      );
      return output;
    };
    const whole = exportFrom(0, 2);
    // Still ringing well after the clip ends at 0.5 s.
    const end = 0.5 * SAMPLE_RATE;
    assert.ok(energy(whole, end + 0.3 * SAMPLE_RATE, 1.0 * SAMPLE_RATE) > 1e-6);
    // And silent once Decay has passed.
    assert.ok(energy(whole, 1.4 * SAMPLE_RATE) < energy(whole) * 1e-6);
    // An export starting after the clip still renders its tail.
    const late = exportFrom(0.7, 1);
    const offset = 0.7 * SAMPLE_RATE;
    let difference = 0;
    for (let index = 0; index < late.length; index++) {
      difference = Math.max(
        difference,
        Math.abs(late[index] - whole[index + offset]),
      );
    }
    assert.ok(energy(late) > 1e-6);
    assert.ok(difference < 1e-6, `the ranged export differs by ${difference}`);
  });
});

describe("Reverb definition", () => {
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
        ["Decay", 0.2, 10, 2, "log"],
        ["Pre-delay", 0, 200, 20, "linear"],
        ["Size", 0, 1, 0.5, "linear"],
        ["Damping", 1000, 20_000, 8000, "log"],
        ["Mix", 0, 1, 0.25, "linear"],
      ],
    );
  });

  it("shows readable values", () => {
    const shown = definition.parameters.map((parameter) =>
      parameter.kind === "number"
        ? parameter.format(parameter.defaultValue)
        : "",
    );
    assert.deepEqual(shown, ["2.00 s", "20 ms", "50%", "8.00 kHz", "25%"]);
  });

  it("is offered in the Audio group of the clip, layer and Global menus", () => {
    for (const group of ["clip", "layer", "global"] as const) {
      const audio = groupAddableEffects(addableEffectsFor(group)).find(
        (entry) => entry.domain === "audio",
      );
      assert.ok(
        audio?.effects.some((effect) => effect.effectName === "Reverb"),
        `Reverb is missing from the ${group} menu`,
      );
    }
    assert.ok(
      addableEffectsFor("clip", "audio").some(
        (effect) => effect.effectName === "Reverb",
      ),
    );
  });
});
