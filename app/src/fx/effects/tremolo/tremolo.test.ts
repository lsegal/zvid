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
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import { definition as gainDefinition } from "../gain/definition.ts";
import { definition } from "./definition.ts";
import { processor } from "./processor.ts";
import {
  DEPTH_KEY,
  NOTE_KEY,
  NOTE_OPTIONS,
  RATE_KEY,
  SHAPE_KEY,
  SHAPE_OPTIONS,
  SQUARE_EDGE_SECONDS,
  SYNC_KEY,
  TREMOLO_EFFECT_NAME,
  tremoloGain,
  tremoloLfo,
  tremoloShape,
  tremoloSyncedPeriod,
} from "./tremolo.ts";

const SAMPLE_RATE = 8000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Numbers = Record<string, number>;
type Switches = Record<string, string>;

// Free-running at 2 Hz and full depth unless told otherwise.
function tremolo(
  numbers: Numbers = {},
  switches: Switches = {},
  enabled = true,
): AudioStage {
  return testStage(
    TREMOLO_EFFECT_NAME,
    { [RATE_KEY]: 2, [DEPTH_KEY]: 1, ...numbers },
    {
      id: "tremolo",
      enabled,
      switches: {
        [SYNC_KEY]: "Off",
        [NOTE_KEY]: "1/8",
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

// A constant level of 1 reads the gain straight off the output.
function level(seconds: number) {
  return signal(seconds, () => 1);
}

function tone(seconds: number) {
  return signal(seconds, (index) =>
    Math.sin((2 * Math.PI * 400 * index) / SAMPLE_RATE),
  );
}

function rms(values: Float32Array, from: number, to: number) {
  let total = 0;
  for (let index = from; index < to; index++) {
    total += values[index] * values[index];
  }
  return Math.sqrt(total / (to - from));
}

function maxStep(values: ArrayLike<number>) {
  let max = 0;
  for (let index = 1; index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

const frameAt = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

describe("Tremolo", () => {
  it("passes the input through unchanged at Depth 0 %", () => {
    const input = [noise(1, 1), noise(1, 2)];
    for (const shape of SHAPE_OPTIONS) {
      for (const sync of ["Off", "On"]) {
        const output = render(input, {
          stages: [
            tremolo(
              { [DEPTH_KEY]: 0 },
              { [SHAPE_KEY]: shape, [SYNC_KEY]: sync },
            ),
          ],
        });
        assert.deepEqual(output, input);
      }
    }
  });

  it("swings a steady tone's envelope from 1 to 0 once a cycle at Rate", () => {
    const [output] = render([tone(3)], { stages: [tremolo()] });
    // At 2 Hz the envelope is full at each half second and silent a
    // quarter of a second later; a 400 Hz tone has a whole cycle in 20
    // frames, so windows that long read its envelope.
    const window = 20;
    const envelope = (at: number) =>
      Math.SQRT2 * rms(output, at - window / 2, at + window / 2);
    for (let cycle = 1; cycle < 6; cycle++) {
      const start = cycle / 2;
      assert.ok(envelope(frameAt(start)) > 0.99, `loud at ${start}s`);
      assert.ok(envelope(frameAt(start + 0.25)) < 0.01, `silent at ${start}s`);
      assert.ok(Math.abs(envelope(frameAt(start + 0.125)) - 0.5) < 0.02);
    }
  });

  it("follows Gain = 1 − Depth · (1 − lfo) / 2", () => {
    const [output] = render([level(1)], {
      stages: [tremolo({ [DEPTH_KEY]: 0.6, [RATE_KEY]: 3 })],
    });
    for (let at = 0; at < output.length; at += 37) {
      const expected = tremoloGain(
        0.6,
        Math.cos((2 * Math.PI * 3 * at) / SAMPLE_RATE),
      );
      assert.ok(Math.abs(output[at] - expected) < 1e-5);
    }
    // Depth 60 % bottoms out at 40 %.
    assert.ok(Math.abs(Math.min(...output) - 0.4) < 1e-4);
    assert.ok(Math.abs(Math.max(...output) - 1) < 1e-6);
  });

  it("cycles every 0.5 s, loudest on each beat, synced to 1/4 at 120 BPM", () => {
    // Starting mid-beat checks the phase comes from the timeline time.
    const startSeconds = 1.3;
    const [output] = render([level(2.5)], {
      stages: [tremolo({}, { [SYNC_KEY]: "On", [NOTE_KEY]: "1/4" })],
      startSeconds,
    });
    const gainAt = (seconds: number) => output[frameAt(seconds - startSeconds)];
    for (const beat of [1.5, 2, 2.5, 3, 3.5]) {
      assert.ok(Math.abs(gainAt(beat) - 1) < 1e-6, `full on the beat ${beat}`);
      assert.ok(Math.abs(gainAt(beat + 0.25)) < 1e-6, `silent off ${beat}`);
    }
    for (let seconds = 1.3; seconds < 3; seconds += 0.037) {
      assert.ok(Math.abs(gainAt(seconds) - gainAt(seconds + 0.5)) < 1e-4);
    }
  });

  it("aligns synced cycles longer than a beat to bar starts", () => {
    // At 120 BPM in 4/4 a bar is 2 s.
    const [output] = render([level(3)], {
      stages: [tremolo({}, { [SYNC_KEY]: "On", [NOTE_KEY]: "1 bar" })],
      startSeconds: 0.5,
    });
    assert.ok(Math.abs(output[frameAt(1.5)] - 1) < 1e-6);
    assert.ok(Math.abs(output[frameAt(0.5)]) < 1e-6);
  });

  it("follows the timeline time, so a render from any point agrees", () => {
    for (const sync of ["Off", "On"]) {
      const stages = [tremolo({ [RATE_KEY]: 0.7 }, { [SYNC_KEY]: sync })];
      const [whole] = render([level(3)], { stages });
      const [late] = render([level(1)], { stages, startSeconds: 2 });
      for (let index = 0; index < late.length; index += 41) {
        assert.ok(
          Math.abs(late[index] - whole[index + 2 * SAMPLE_RATE]) < 1e-5,
        );
      }
    }
  });

  it("applies the same gain to every channel", () => {
    const input = [noise(1, 5), noise(1, 6)];
    const [left, right] = render(input, { stages: [tremolo()] });
    const at = frameAt(0.6);
    const gain = tremoloGain(1, Math.cos(2 * Math.PI * 2 * 0.6));
    assert.ok(Math.abs(left[at] - input[0][at] * gain) < 1e-5);
    assert.ok(Math.abs(right[at] - input[1][at] * gain) < 1e-5);
  });

  it("moves between levels over the square's edge instead of jumping", () => {
    const [output] = render([level(2)], {
      stages: [tremolo({ [RATE_KEY]: 4 }, { [SHAPE_KEY]: "Square" })],
    });
    // The gain crosses its full swing of 1 over one edge.
    const edgeFrames = SQUARE_EDGE_SECONDS * SAMPLE_RATE;
    assert.ok(maxStep(output) <= (1 / edgeFrames) * 1.05);
    // And it holds each level between edges: full around each cycle's
    // start, silent around its middle, with edges a quarter cycle either
    // side of the start.
    for (const seconds of [0.25, 0.28, 0.47]) {
      assert.ok(Math.abs(output[frameAt(seconds)] - 1) < 1e-6, `${seconds}`);
    }
    for (const seconds of [0.1, 0.125, 0.15]) {
      assert.ok(Math.abs(output[frameAt(seconds)]) < 1e-6, `${seconds}`);
    }
  });

  it("passes the input through bit for bit when bypassed or removed", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const bypassed = render(input, { stages: [tremolo({}, {}, false)] });
    assert.deepEqual(bypassed, input);
    const removed = render(input, {
      stages: [tremolo()],
      change: { atSeconds: 0.5, stages: [] },
    });
    // The chain applies settings from the first block at or after 0.5 s.
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("scales an impulse by the gain at its time", () => {
    const [output] = render([impulse(0.5)], {
      stages: [tremolo()],
      startSeconds: 0.25,
    });
    // A quarter second in at 2 Hz is the envelope's silent point.
    assert.ok(Math.abs(output[0]) < 1e-6);
  });

  it("ramps a live Depth change instead of jumping", () => {
    const [output] = render([level(1)], {
      stages: [tremolo({ [DEPTH_KEY]: 0, [RATE_KEY]: 0.1 })],
      change: {
        atSeconds: 0.5,
        stages: [tremolo({ [DEPTH_KEY]: 1, [RATE_KEY]: 0.1 }, {})],
      },
      startSeconds: 2.5,
    });
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    assert.ok(maxStep(output) <= 1 / rampFrames + 1e-4);
    // The level did drop, to where the slow LFO stands by the end.
    const seconds = 2.5 + (output.length - 1) / SAMPLE_RATE;
    const expected = tremoloGain(1, Math.cos(2 * Math.PI * 0.1 * seconds));
    assert.ok(expected < 0.5);
    assert.ok(Math.abs(output[output.length - 1] - expected) < 1e-4);
  });

  it("crossfades a live Shape, Sync or Note change instead of jumping", () => {
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const changes: Switches[] = [
      { [SHAPE_KEY]: "Square" },
      { [SYNC_KEY]: "On", [NOTE_KEY]: "1/16" },
    ];
    for (const switches of changes) {
      const [output] = render([level(1)], {
        stages: [tremolo({ [DEPTH_KEY]: 0.5, [RATE_KEY]: 5 })],
        change: {
          atSeconds: 0.55,
          stages: [tremolo({ [DEPTH_KEY]: 0.5, [RATE_KEY]: 5 }, switches)],
        },
      });
      assert.ok(maxStep(output) < 1 / rampFrames + 0.01);
    }
  });

  it("keeps the LFO phase continuous through a live Rate change", () => {
    const [output] = render([level(8)], {
      startSeconds: 10,
      stages: [tremolo({ [RATE_KEY]: 0.8 })],
      change: { atSeconds: 1, stages: [tremolo({ [RATE_KEY]: 5 })] },
    });
    // At 5 Hz the gain moves at most π · 5 per second; a phase jump would
    // move it far faster.
    const fastest = (Math.PI * 5) / SAMPLE_RATE;
    assert.ok(maxStep(output) < fastest * 1.5);

    // Then it drifts back into step with the timeline.
    const index = output.length - 1;
    const seconds = 10 + index / SAMPLE_RATE;
    const expected = tremoloGain(1, Math.cos(2 * Math.PI * 5 * seconds));
    assert.ok(Math.abs(output[index] - expected) < 1e-3);
  });
});

describe("tremoloLfo", () => {
  it("starts each shape at its top and reaches its bottom halfway", () => {
    for (const shape of SHAPE_OPTIONS) {
      assert.ok(Math.abs(tremoloLfo(shape, 0, 0.01) - 1) < 1e-12, shape);
      assert.ok(Math.abs(tremoloLfo(shape, 0.5, 0.01) + 1) < 1e-12, shape);
      assert.ok(Math.abs(tremoloLfo(shape, 3, 0.01) - 1) < 1e-12, shape);
    }
    assert.ok(Math.abs(tremoloLfo("Triangle", 0.125) - 0.5) < 1e-12);
    assert.ok(Math.abs(tremoloLfo("Square", 0.2, 0.01) - 1) < 1e-12);
  });

  it("reads Shape case-insensitively, falling back to Sine", () => {
    assert.equal(tremoloShape("square"), "Square");
    assert.equal(tremoloShape("Sawtooth"), "Sine");
  });
});

describe("tremoloSyncedPeriod", () => {
  it("reads the note value at the tempo only while Sync is on", () => {
    assert.equal(tremoloSyncedPeriod("Off", "1/4", TEMPO), undefined);
    assert.equal(tremoloSyncedPeriod("On", "1/4", TEMPO), 0.5);
    assert.equal(tremoloSyncedPeriod("on", "1/8T", TEMPO), 0.25 * (2 / 3));
    // An unknown note falls back to the default 1/8.
    assert.equal(tremoloSyncedPeriod("On", "3/7", TEMPO), 0.25);
  });
});

describe("Tremolo definition", () => {
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
        ["Rate", 0.1, 20, 5, "log", ["Off"]],
        ["Note", NOTE_OPTIONS, "1/8", ["On"]],
        ["Depth", 0, 1, 0.5, "linear", undefined],
        ["Shape", ["Sine", "Triangle", "Square"], "Sine", undefined],
      ],
    );
  });

  it("offers notes from 1/32 to one bar, with dotted and triplet values", () => {
    assert.equal(NOTE_OPTIONS[0], "1/32");
    assert.equal(NOTE_OPTIONS.at(-3), "1 bar");
    for (const note of ["1/8D", "1/8T", "1/1"]) {
      assert.ok(NOTE_OPTIONS.includes(note), note);
    }
    assert.ok(!NOTE_OPTIONS.includes("2 bars"));
  });

  it("shows readable values", () => {
    const shown = definition.parameters.flatMap((parameter) =>
      parameter.kind === "number"
        ? [parameter.format(parameter.defaultValue)]
        : [],
    );
    assert.deepEqual(shown, ["5.0 Hz", "50%"]);
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
        audio?.effects.some((effect) => effect.effectName === "Tremolo"),
        `Tremolo is missing from the ${group} menu`,
      );
    }
  });
});
