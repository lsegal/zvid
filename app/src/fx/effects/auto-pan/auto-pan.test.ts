import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import { testStage } from "../../../audio-mix/chain-test-utils.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { NOTE_VALUE_OPTIONS } from "../../../audio-mix/tempo.ts";
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import { definition as gainDefinition } from "../gain/definition.ts";
import {
  AUTO_PAN_EFFECT_NAME,
  autoPanGains,
  autoPanLfo,
  autoPanShape,
  DEPTH_DEFAULT,
  DEPTH_KEY,
  NOTE_KEY,
  RATE_DEFAULT,
  RATE_KEY,
  SHAPE_KEY,
  SHAPE_OPTIONS,
  SQUARE_EDGE_SECONDS,
  SYNC_KEY,
} from "./auto-pan.ts";
import { definition } from "./definition.ts";
import { processor } from "./processor.ts";

const SAMPLE_RATE = 8000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Numbers = Record<string, number>;
type Switches = Record<string, string>;

// Free-running at 1 Hz unless `switches` say otherwise.
function autoPan(
  numbers: Numbers = {},
  switches: Switches = {},
  enabled = true,
): AudioStage {
  return testStage(
    AUTO_PAN_EFFECT_NAME,
    { [RATE_KEY]: RATE_DEFAULT, [DEPTH_KEY]: DEPTH_DEFAULT, ...numbers },
    {
      id: "auto-pan",
      enabled,
      switches: {
        [SYNC_KEY]: "Off",
        [NOTE_KEY]: "1 bar",
        [SHAPE_KEY]: "Sine",
        ...switches,
      },
    },
  );
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
  const frames = input[0].length;
  const chain = new AudioChain(registry, SAMPLE_RATE, input.length);
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

// A constant level reads each channel's gain straight off the output.
function level(seconds: number, value = 0.5) {
  return signal(seconds, () => value);
}

// A centered tone: the same 200 Hz sine on both channels.
function centeredTone(seconds: number) {
  const tone = () =>
    signal(seconds, (index) =>
      Math.sin((2 * Math.PI * 200 * index) / SAMPLE_RATE),
    );
  return [tone(), tone()];
}

function rms(values: Float32Array, from: number, to: number) {
  let total = 0;
  for (let index = from; index < to; index++) {
    total += values[index] * values[index];
  }
  return Math.sqrt(total / (to - from));
}

function maxStep(values: ArrayLike<number>, from = 1) {
  let max = 0;
  for (let index = Math.max(1, from); index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

// The pan position, -1 to 1, a pair of channel gains stands for.
function positionOf(leftGain: number, rightGain: number) {
  return (4 / Math.PI) * Math.atan2(rightGain, leftGain) - 1;
}

const frameAt = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

describe("Auto Pan", () => {
  it("passes the input through unchanged at Depth 0 %", () => {
    const input = [noise(1, 1), noise(1, 2)];
    for (const shape of SHAPE_OPTIONS) {
      const output = render(input, {
        stages: [autoPan({ [DEPTH_KEY]: 0 }, { [SHAPE_KEY]: shape })],
      });
      assert.deepEqual(output, input);
    }
  });

  it("moves a centered tone fully right and left once a cycle at Rate", () => {
    const [left, right] = render(centeredTone(3), {
      stages: [autoPan({ [RATE_KEY]: 2 })],
    });
    // At 2 Hz the sine is fully right an eighth of a second into each
    // cycle and fully left three eighths in.
    const window = SAMPLE_RATE / 100;
    for (let cycle = 0; cycle < 6; cycle++) {
      const start = cycle / 2;
      const rightAt = frameAt(start + 0.125);
      const leftAt = frameAt(start + 0.375);
      const centerAt = frameAt(start + 0.25);
      const span = (at: number) => [at - window / 2, at + window / 2] as const;
      assert.ok(rms(left, ...span(rightAt)) < 0.01, `left at ${start + 0.125}`);
      assert.ok(rms(right, ...span(rightAt)) > 0.99);
      assert.ok(rms(right, ...span(leftAt)) < 0.01, `right at ${start + 0.375}`);
      assert.ok(rms(left, ...span(leftAt)) > 0.99);
      const tolerance = 0.02;
      assert.ok(
        Math.abs(rms(left, ...span(centerAt)) - Math.SQRT1_2) < tolerance,
      );
      assert.ok(
        Math.abs(rms(right, ...span(centerAt)) - Math.SQRT1_2) < tolerance,
      );
    }
  });

  it("keeps a centered sound's total power within ±0.5 dB for every shape", () => {
    const input = centeredTone(2);
    const window = SAMPLE_RATE / 50;
    const inputPower =
      rms(input[0], 0, window) ** 2 + rms(input[1], 0, window) ** 2;
    for (const shape of SHAPE_OPTIONS) {
      const [left, right] = render(input, {
        stages: [autoPan({ [RATE_KEY]: 1.3 }, { [SHAPE_KEY]: shape })],
      });
      for (let at = 0; at + window <= left.length; at += window) {
        const power = rms(left, at, at + window) ** 2 + rms(right, at, at + window) ** 2;
        const db = 10 * Math.log10(power / inputPower);
        assert.ok(Math.abs(db) <= 0.5, `${shape} power is ${db} dB at ${at}`);
      }
    }
  });

  it("cycles once every 2 s, aligned to bar starts, synced to 1 bar at 120 BPM", () => {
    const stages = [autoPan({}, { [SYNC_KEY]: "On", [NOTE_KEY]: "1 bar" })];
    // Starting mid-bar checks the phase comes from the timeline time.
    const startSeconds = 1.25;
    const [left, right] = render([level(3), level(3)], {
      stages,
      startSeconds,
    });
    const positionAt = (seconds: number) => {
      const at = frameAt(seconds - startSeconds);
      return positionOf(left[at], right[at]);
    };
    // Bars start every 2 s: centered, then right, center, left, center.
    for (const [seconds, expected] of [
      [2, 0],
      [2.5, 1],
      [3, 0],
      [3.5, -1],
      [4, 0],
    ]) {
      assert.ok(
        Math.abs(positionAt(seconds) - expected) < 1e-3,
        `position at ${seconds}s is ${positionAt(seconds)}, not ${expected}`,
      );
    }
    for (let seconds = 1.3; seconds < 2.2; seconds += 0.037) {
      assert.ok(Math.abs(positionAt(seconds) - positionAt(seconds + 2)) < 1e-3);
    }
  });

  it("follows the timeline time, so a render from any point agrees", () => {
    const stages = [autoPan({ [RATE_KEY]: 0.7 })];
    const whole = render([level(3), level(3)], { stages });
    const late = render([level(1), level(1)], { stages, startSeconds: 2 });
    for (let index = 0; index < late[0].length; index += 41) {
      for (const channel of [0, 1]) {
        assert.ok(
          Math.abs(late[channel][index] - whole[channel][index + 2 * SAMPLE_RATE]) < 1e-6,
        );
      }
    }
  });

  it("sweeps the balance of a stereo sound", () => {
    const input = [noise(1, 5), noise(1, 6)];
    const [left, right] = render(input, { stages: [autoPan()] });
    const [leftGain, rightGain] = autoPanGains(Math.sin(2 * Math.PI * 0.6));
    const at = frameAt(0.6);
    assert.ok(Math.abs(left[at] - input[0][at] * leftGain) < 1e-4);
    assert.ok(Math.abs(right[at] - input[1][at] * rightGain) < 1e-4);
  });

  it("moves between sides over the square's edge instead of jumping", () => {
    const [left] = render([level(2, 1), level(2, 1)], {
      stages: [autoPan({ [RATE_KEY]: 4 }, { [SHAPE_KEY]: "Square" })],
    });
    // The left gain crosses its full √2 swing over one edge.
    const edgeFrames = SQUARE_EDGE_SECONDS * SAMPLE_RATE;
    assert.ok(maxStep(left) < (Math.SQRT2 / edgeFrames) * 1.6);
    // And it reaches both sides between edges.
    assert.ok(Math.abs(left[frameAt(0.0625)]) < 1e-6);
    assert.ok(Math.abs(left[frameAt(0.1875)] - Math.SQRT2) < 1e-6);
  });

  it("passes the input through bit for bit when bypassed or removed", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const bypassed = render(input, { stages: [autoPan({}, {}, false)] });
    assert.deepEqual(bypassed, input);
    const removed = render(input, {
      stages: [autoPan()],
      change: { atSeconds: 0.5, stages: [] },
    });
    // The chain applies settings from the first block at or after 0.5 s.
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("passes an impulse through a single channel untouched", () => {
    const input = [impulse(0.5)];
    assert.deepEqual(render(input, { stages: [autoPan()] }), input);
  });

  it("ramps a live Depth change instead of jumping", () => {
    const changed = render([level(1, 1), level(1, 1)], {
      stages: [autoPan({ [DEPTH_KEY]: 0, [RATE_KEY]: 0.05 })],
      change: {
        atSeconds: 0.5,
        stages: [autoPan({ [DEPTH_KEY]: 1, [RATE_KEY]: 0.05 })],
      },
    });
    // Moving Depth 0 → 1 while the slow LFO is a little right of center
    // shifts each gain by well under √2, spread over the ramp.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    for (const channel of changed) {
      assert.ok(maxStep(channel) <= Math.SQRT2 / rampFrames + 1e-4);
    }
    // The pan did move.
    assert.ok(Math.abs(changed[0].at(-1)! - changed[1].at(-1)!) > 0.2);
  });

  it("crossfades a live Shape or Sync change instead of jumping", () => {
    const [left] = render([level(1, 1), level(1, 1)], {
      stages: [autoPan({}, { [SHAPE_KEY]: "Sine" })],
      change: {
        atSeconds: 0.5,
        stages: [autoPan({}, { [SYNC_KEY]: "On", [NOTE_KEY]: "1/16" })],
      },
    });
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    assert.ok(maxStep(left) < (2 * Math.SQRT2) / rampFrames + 0.01);
  });

  it("keeps the LFO phase continuous through a live Rate change", () => {
    const [left, right] = render([level(8, 1), level(8, 1)], {
      startSeconds: 10,
      stages: [autoPan({ [RATE_KEY]: 0.8 })],
      change: { atSeconds: 1, stages: [autoPan({ [RATE_KEY]: 5 })] },
    });
    const position = Array.from(left, (value, index) =>
      positionOf(value, right[index]),
    );
    // At 5 Hz the position moves at most 2π · 5 per second; a phase jump
    // would move it far faster.
    const fastest = (2 * Math.PI * 5) / SAMPLE_RATE;
    assert.ok(maxStep(position) < fastest * 1.5);

    // Then it drifts back into step with the timeline.
    const index = position.length - 1;
    const seconds = 10 + index / SAMPLE_RATE;
    const expected = Math.sin(2 * Math.PI * 5 * seconds);
    assert.ok(Math.abs(position[index] - expected) < 1e-3);
  });
});

describe("autoPanLfo", () => {
  it("starts each shape at the center, heading right", () => {
    for (const shape of SHAPE_OPTIONS) {
      assert.ok(Math.abs(autoPanLfo(shape, 0, 0.01)) < 1e-12, shape);
      assert.ok(Math.abs(autoPanLfo(shape, 0.25, 0.01) - 1) < 1e-12, shape);
      assert.ok(Math.abs(autoPanLfo(shape, 0.75, 0.01) + 1) < 1e-12, shape);
    }
    assert.ok(Math.abs(autoPanLfo("Triangle", 0.125) - 0.5) < 1e-12);
  });

  it("reads Shape case-insensitively, falling back to Sine", () => {
    assert.equal(autoPanShape("square"), "Square");
    assert.equal(autoPanShape("Sawtooth"), "Sine");
  });
});

describe("autoPanGains", () => {
  it("leaves the center at unity and sends the sides to one channel", () => {
    const [left, right] = autoPanGains(0);
    assert.ok(Math.abs(left - 1) < 1e-12 && Math.abs(right - 1) < 1e-12);
    assert.ok(Math.abs(autoPanGains(1)[0]) < 1e-12);
    assert.ok(Math.abs(autoPanGains(-1)[1]) < 1e-12);
  });
});

describe("Auto Pan definition", () => {
  it("has the specified parameters, ranges and defaults", () => {
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
              parameter.taper ?? "linear",
              parameter.visibleWhen?.values,
            ]
          : parameter.kind === "enum"
            ? [
                parameter.key,
                parameter.options,
                parameter.defaultValue,
                parameter.visibleWhen?.values,
              ]
            : [parameter.key],
      ),
      [
        ["Sync", ["Off", "On"], "On", undefined],
        ["Rate", 0.05, 20, 1, "log", ["Off"]],
        ["Note", NOTE_VALUE_OPTIONS, "1 bar", ["On"]],
        ["Depth", 0, 1, 1, "linear", undefined],
        ["Shape", ["Sine", "Triangle", "Square"], "Sine", undefined],
      ],
    );
    assert.ok(NOTE_VALUE_OPTIONS.includes("1/32"));
    assert.ok(NOTE_VALUE_OPTIONS.includes("4 bars"));
    assert.ok(NOTE_VALUE_OPTIONS.includes("1/8D"));
    assert.ok(NOTE_VALUE_OPTIONS.includes("1/8T"));
  });

  it("shows readable values", () => {
    const shown = definition.parameters.flatMap((parameter) =>
      parameter.kind === "number" ? [parameter.format(parameter.defaultValue)] : [],
    );
    assert.deepEqual(shown, ["1.0 Hz", "100%"]);
  });

  it("has an accent distinct from Gain's", () => {
    assert.notEqual(definition.accent, gainDefinition.accent);
  });

  it("is offered in the Audio group of the clip, layer and Global menus", () => {
    for (const group of ["clip", "layer", "global"] as const) {
      const audio = groupAddableEffects(addableEffectsFor(group)).find(
        (entry) => entry.domain === "audio",
      );
      assert.ok(
        audio?.effects.some((effect) => effect.effectName === "Auto Pan"),
        `Auto Pan is missing from the ${group} menu`,
      );
    }
  });
});
