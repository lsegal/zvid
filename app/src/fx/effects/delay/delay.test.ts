import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioChain,
  BLOCK_FRAMES,
  PARAMETER_RAMP_SECONDS,
} from "../../../audio-mix/chain.ts";
import { testStage } from "../../../audio-mix/chain-test-utils.ts";
import { type DecodedAudio, renderAudioMix } from "../../../audio-mix/mix.ts";
import {
  type AudioEffectProcessor,
  type AudioParameterBlock,
  type AudioStage,
  type AudioTempo,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import type { AudioMix } from "../../../audio-mix/resolve.ts";
import { noteValueSeconds } from "../../../audio-mix/tempo.ts";
import { addableEffectsFor, groupAddableEffects } from "../../../fx-chain.ts";
import { definition as gainDefinition } from "../gain/definition.ts";
import { processor as gainProcessor, gainStageAt } from "../gain/processor.ts";
import { EFFECT_DEFINITION_MODULES } from "../index.generated.ts";
import { definition } from "./definition.ts";
import {
  DELAY_EFFECT_NAME,
  DelayDsp,
  delayTailSeconds,
  FEEDBACK_KEY,
  HIGH_CUT_KEY,
  LONGEST_SYNCED_SECONDS,
  MIX_KEY,
  NOTE_KEY,
  NOTE_OPTIONS,
  PING_PONG_KEY,
  SYNC_GLIDE_SECONDS,
  SYNC_KEY,
  TIME_KEY,
} from "./delay.ts";
import { processor } from "./processor.ts";

const SAMPLE_RATE = 8000;
const TEMPO: AudioTempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor]);

type Numbers = Record<string, number>;
type Switches = Record<string, string>;

// Free-running at 100 ms, Feedback 50 %, fully wet and with the High cut
// wide open unless told otherwise.
function delay(
  numbers: Numbers = {},
  switches: Switches = {},
  enabled = true,
): AudioStage {
  return testStage(
    DELAY_EFFECT_NAME,
    {
      [TIME_KEY]: 100,
      [FEEDBACK_KEY]: 0.5,
      [HIGH_CUT_KEY]: 20000,
      [MIX_KEY]: 1,
      ...numbers,
    },
    {
      id: "delay",
      enabled,
      switches: {
        [SYNC_KEY]: "Off",
        [NOTE_KEY]: "1/8D",
        [PING_PONG_KEY]: "Off",
        ...switches,
      },
    },
  );
}

const TIME_FRAMES = 0.1 * SAMPLE_RATE;

type Render = {
  stages: AudioStage[];
  tempo?: AudioTempo;
  // Settings applied live once the render reaches `atSeconds`.
  change?: { atSeconds: number; stages: AudioStage[]; tempo?: AudioTempo };
};

// Renders `input` (one array per channel) through a chain block by block,
// as both the preview worklet and the offline render do.
function render(input: Float32Array[], options: Render) {
  const frames = input[0].length;
  const chain = new AudioChain(registry, SAMPLE_RATE, input.length);
  chain.configure(
    { stages: options.stages, inputGain: 1, delayFrames: 0 },
    options.tempo ?? TEMPO,
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
        options.change.tempo ?? options.tempo ?? TEMPO,
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

function impulse(seconds: number, atFrame = 0) {
  return signal(seconds, (index) => (index === atFrame ? 1 : 0));
}

function sine(seconds: number, frequency: number) {
  return signal(seconds, (index) =>
    Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE),
  );
}

function nonzero(values: Float32Array) {
  return [...values.entries()].filter(([, value]) => value !== 0);
}

// The sum of `values` over the `width` frames from `from`: a repeat's
// level once the High cut has spread it over a few frames.
function sum(values: Float32Array, from: number, width = 100) {
  let total = 0;
  for (let index = from; index < from + width; index++) {
    total += values[index];
  }
  return total;
}

function peak(values: Float32Array, from: number, width = 100) {
  return Math.max(...values.subarray(from, from + width));
}

function maxStep(values: ArrayLike<number>, from = 1) {
  let max = 0;
  for (let index = Math.max(1, from); index < values.length; index++) {
    max = Math.max(max, Math.abs(values[index] - values[index - 1]));
  }
  return max;
}

describe("Delay", () => {
  it("passes the input through unchanged at Mix 0 %", () => {
    const input = [noise(1, 1), noise(1, 2)];
    const output = render(input, {
      stages: [delay({ [MIX_KEY]: 0, [FEEDBACK_KEY]: 0.9 })],
    });
    assert.deepEqual(output, input);
  });

  it("repeats an impulse exactly Time later, each repeat Feedback quieter", () => {
    const [output] = render([impulse(1)], { stages: [delay()] });
    assert.deepEqual(nonzero(output.subarray(0, TIME_FRAMES + 2)), [
      [TIME_FRAMES, 1],
    ]);
    for (let repeat = 2; repeat <= 5; repeat++) {
      const level = sum(output, repeat * TIME_FRAMES);
      assert.ok(
        Math.abs(level - 0.5 ** (repeat - 1)) < 1e-6,
        `repeat ${repeat} is ${level}`,
      );
      // Nothing between the repeats.
      assert.ok(
        peak(output, (repeat - 1) * TIME_FRAMES + 100, TIME_FRAMES - 100) <
          1e-9,
      );
    }
  });

  it("repeats once and only once at Feedback 0 %", () => {
    const [output] = render([impulse(1)], {
      stages: [delay({ [FEEDBACK_KEY]: 0 })],
    });
    assert.deepEqual(nonzero(output), [[TIME_FRAMES, 1]]);
  });

  it("mixes the dry sound and the repeats by Mix", () => {
    const [output] = render([impulse(1)], {
      stages: [delay({ [FEEDBACK_KEY]: 0, [MIX_KEY]: 0.25 })],
    });
    assert.deepEqual(nonzero(output), [
      [0, 0.75],
      [TIME_FRAMES, 0.25],
    ]);
  });

  it("darkens each repeat further below the High cut", () => {
    const [open] = render([impulse(1)], { stages: [delay()] });
    const [dark] = render([impulse(1)], {
      stages: [delay({ [HIGH_CUT_KEY]: 1000 })],
    });
    // The low-pass keeps each repeat's level but smears its peak.
    assert.ok(Math.abs(sum(dark, 2 * TIME_FRAMES) - 0.5) < 1e-6);
    assert.ok(peak(dark, 2 * TIME_FRAMES) < peak(open, 2 * TIME_FRAMES) * 0.8);
    assert.ok(
      peak(dark, 3 * TIME_FRAMES) / sum(dark, 3 * TIME_FRAMES) <
        peak(dark, 2 * TIME_FRAMES) / sum(dark, 2 * TIME_FRAMES),
    );
  });

  it("repeats at the note length for the session tempo when synced", () => {
    for (const [note, bpm, seconds] of [
      ["1/8D", 120, 0.375],
      ["1/4", 100, 0.6],
      ["1/16", 150, 0.1],
      ["1/2", 120, 1],
    ] as const) {
      const [output] = render([impulse(1.5)], {
        tempo: { bpm, signature: DEFAULT_TIME_SIGNATURE },
        stages: [
          delay({ [FEEDBACK_KEY]: 0 }, { [SYNC_KEY]: "On", [NOTE_KEY]: note }),
        ],
      });
      assert.deepEqual(
        nonzero(output),
        [[seconds * SAMPLE_RATE, 1]],
        `${note} at ${bpm} BPM`,
      );
    }
  });

  it("ignores Time while synced", () => {
    const synced = { [SYNC_KEY]: "On", [NOTE_KEY]: "1/4" };
    const [short] = render([impulse(1)], {
      stages: [delay({ [TIME_KEY]: 10 }, synced)],
    });
    const [long] = render([impulse(1)], {
      stages: [delay({ [TIME_KEY]: 900 }, synced)],
    });
    assert.deepEqual(short, long);
  });

  it("holds a repeat as long as one bar at a slow tempo", () => {
    const [output] = render([impulse(4.5)], {
      tempo: { bpm: 60, signature: DEFAULT_TIME_SIGNATURE },
      stages: [
        delay({ [FEEDBACK_KEY]: 0 }, { [SYNC_KEY]: "On", [NOTE_KEY]: "1 bar" }),
      ],
    });
    assert.deepEqual(nonzero(output), [[4 * SAMPLE_RATE, 1]]);
  });

  it("follows a tempo change, gliding to the new length", () => {
    const synced = { [SYNC_KEY]: "On", [NOTE_KEY]: "1/4" };
    const stages = [delay({ [FEEDBACK_KEY]: 0 }, synced)];
    // A click at 1.2 s, after the tempo moves from 120 to 100 BPM at 1 s.
    const click = 1.2 * SAMPLE_RATE;
    const [output] = render([impulse(2, click)], {
      stages,
      change: {
        atSeconds: 1,
        stages,
        tempo: { bpm: 100, signature: DEFAULT_TIME_SIGNATURE },
      },
    });
    assert.deepEqual(nonzero(output), [[click + 0.6 * SAMPLE_RATE, 1]]);

    // The read point glides: a low tone through the delay steps no
    // further per frame than the tone does, times how fast the read point
    // moves. 0.5 s to 0.75 s moves it five cycles of 20 Hz, so a jump
    // would land on the same phase; 22 Hz puts it half a cycle off.
    const tone = sine(2, 22);
    const [wet] = render([tone], {
      stages,
      change: {
        atSeconds: 1,
        stages,
        tempo: { bpm: 80, signature: DEFAULT_TIME_SIGNATURE },
      },
    });
    const moved = (0.75 - 0.5) * SAMPLE_RATE;
    const glide = SYNC_GLIDE_SECONDS * SAMPLE_RATE;
    const bound = maxStep(tone) * (1 + moved / glide) + 1e-6;
    assert.ok(maxStep(wet, SAMPLE_RATE / 2 + 1) <= bound);
    assert.ok(bound < 0.5);
  });

  it("alternates repeats between left and right with Ping-pong", () => {
    const [left, right] = render([impulse(1), impulse(1)], {
      stages: [delay({}, { [PING_PONG_KEY]: "On" })],
    });
    assert.equal(left[TIME_FRAMES], 1);
    assert.equal(right[TIME_FRAMES], 0);
    const levels = [2, 3, 4].map((repeat) => [
      sum(left, repeat * TIME_FRAMES),
      sum(right, repeat * TIME_FRAMES),
    ]);
    const expected = [
      [0, 0.5],
      [0.25, 0],
      [0, 0.125],
    ];
    for (const [index, [l, r]] of levels.entries()) {
      assert.ok(Math.abs(l - expected[index][0]) < 1e-6, `left ${l}`);
      assert.ok(Math.abs(r - expected[index][1]) < 1e-6, `right ${r}`);
    }
  });

  it("keeps each channel's repeats on that channel without Ping-pong", () => {
    const [left, right] = render([impulse(1), new Float32Array(SAMPLE_RATE)], {
      stages: [delay()],
    });
    assert.deepEqual(nonzero(right), []);
    assert.ok(Math.abs(sum(left, 2 * TIME_FRAMES) - 0.5) < 1e-6);
  });

  it("passes the input through bit for bit when bypassed or removed", () => {
    const input = [noise(1, 3), noise(1, 4)];
    const bypassed = render(input, {
      stages: [delay({ [MIX_KEY]: 0.5 }, {}, false)],
    });
    assert.deepEqual(bypassed, input);
    const removed = render(input, {
      stages: [delay({ [MIX_KEY]: 0.5 })],
      change: { atSeconds: 0.5, stages: [] },
    });
    // The chain applies settings from the first block at or after 0.5 s.
    const from = Math.ceil(SAMPLE_RATE / 2 / BLOCK_FRAMES) * BLOCK_FRAMES;
    assert.deepEqual(removed[0].subarray(from), input[0].subarray(from));
    assert.deepEqual(removed[1].subarray(from), input[1].subarray(from));
  });

  it("ramps a live Mix change instead of jumping", () => {
    const tone = sine(1, 200);
    const [changed] = render([tone], {
      stages: [delay({ [MIX_KEY]: 0, [FEEDBACK_KEY]: 0 })],
      change: {
        atSeconds: 0.5,
        stages: [delay({ [MIX_KEY]: 1, [FEEDBACK_KEY]: 0 })],
      },
    });
    // Moving between dry and wet, both within ±1, adds at most 2 per ramp.
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    assert.ok(maxStep(changed) <= maxStep(tone) + 2 / rampFrames + 1e-6);
  });

  it("glides a live Time change instead of jumping", () => {
    // 100 ms to 125 ms moves the read point half a cycle of a 20 Hz tone.
    const tone = sine(2, 20);
    const [wet] = render([tone], {
      stages: [delay({ [FEEDBACK_KEY]: 0 })],
      change: {
        atSeconds: 1,
        stages: [delay({ [FEEDBACK_KEY]: 0, [TIME_KEY]: 125 })],
      },
    });
    const moved = 0.025 * SAMPLE_RATE;
    const rampFrames = PARAMETER_RAMP_SECONDS * SAMPLE_RATE;
    const bound = maxStep(tone) * (1 + moved / rampFrames) + 1e-6;
    assert.ok(maxStep(wet, TIME_FRAMES + 1) <= bound);
    assert.ok(bound < 0.1);
  });
});

// Steady parameters, as the chain hands a settled stage to its processor.
function steadyParams(numbers: Numbers, switches: Switches) {
  const arrays = new Map<string, Float32Array>();
  const block: AudioParameterBlock = {
    number(key) {
      let values = arrays.get(key);
      if (!values) {
        values = new Float32Array(BLOCK_FRAMES).fill(numbers[key] ?? 0);
        arrays.set(key, values);
      }
      return values;
    },
    value: (key) => numbers[key] ?? 0,
    changing: () => false,
    switch: (key) => switches[key] ?? "",
  };
  return block;
}

// Runs `input` straight through `effect` block by block, from timeline
// second 0.
function runProcessor(
  effect: AudioEffectProcessor,
  input: Float32Array[],
  params: AudioParameterBlock,
  tempo: AudioTempo = TEMPO,
) {
  const frames = input[0].length;
  const output = input.map(() => new Float32Array(frames));
  for (let at = 0; at < frames; at += BLOCK_FRAMES) {
    const count = Math.min(BLOCK_FRAMES, frames - at);
    effect.process(
      input.map((channel) => channel.subarray(at, at + count)),
      output.map((channel) => channel.subarray(at, at + count)),
      count,
      params,
      { ...tempo, sampleRate: SAMPLE_RATE, timeSeconds: at / SAMPLE_RATE },
    );
  }
  return output;
}

describe("Delay reset", () => {
  const synced = steadyParams(
    {
      [TIME_KEY]: 100,
      [FEEDBACK_KEY]: 0.6,
      [HIGH_CUT_KEY]: 3000,
      [MIX_KEY]: 0.5,
    },
    { [SYNC_KEY]: "On", [NOTE_KEY]: "1/8D", [PING_PONG_KEY]: "On" },
  );

  it("sounds exactly like a fresh processor after a reset", () => {
    const test = [sine(1, 220), impulse(1, 100)];
    const used = processor.createProcessor(SAMPLE_RATE, 2);
    runProcessor(used, [noise(1, 3), noise(1, 4)], synced);
    used.reset();
    const fresh = processor.createProcessor(SAMPLE_RATE, 2);
    assert.deepEqual(
      runProcessor(used, test, synced),
      runProcessor(fresh, test, synced),
    );
  });

  it("keeps a line grown for a slow tempo, still sounding fresh", () => {
    const bar = steadyParams(
      { [FEEDBACK_KEY]: 0.5, [HIGH_CUT_KEY]: 20000, [MIX_KEY]: 1 },
      { [SYNC_KEY]: "On", [NOTE_KEY]: "1 bar" },
    );
    const used = processor.createProcessor(SAMPLE_RATE, 1);
    // A bar at 30 BPM is 8 s, past the line made up front.
    runProcessor(used, [noise(1)], bar, {
      bpm: 30,
      signature: DEFAULT_TIME_SIGNATURE,
    });
    used.reset();
    const fresh = processor.createProcessor(SAMPLE_RATE, 1);
    const test = [impulse(4.5, 10)];
    const slow = { bpm: 60, signature: DEFAULT_TIME_SIGNATURE };
    assert.deepEqual(
      runProcessor(used, test, bar, slow),
      runProcessor(fresh, test, bar, slow),
    );
  });

  it("holds the longest synced note without growing its line", () => {
    // The session's signatures (app/constants.ts) at its slowest tempo.
    for (const [numerator, denominator] of [
      [4, 4],
      [3, 4],
      [5, 4],
      [6, 8],
      [7, 8],
    ]) {
      const signature = { numerator, denominator };
      const seconds = noteValueSeconds("1 bar", { bpm: 60, signature }) ?? 0;
      assert.ok(
        seconds <= LONGEST_SYNCED_SECONDS,
        `${numerator}/${denominator}`,
      );
    }
    const dsp = new DelayDsp(SAMPLE_RATE, 1);
    const lines = Reflect.get(dsp, "lines");
    const frames = BLOCK_FRAMES;
    const values = new Float32Array(frames).fill(0.5);
    dsp.process([new Float32Array(frames)], [new Float32Array(frames)], {
      frames,
      sampleRate: SAMPLE_RATE,
      syncedSeconds: LONGEST_SYNCED_SECONDS,
      pingPong: false,
      timeMs: values,
      feedback: values,
      highCut: new Float32Array(frames).fill(8000),
      mix: values,
    });
    assert.equal(Reflect.get(dsp, "lines"), lines);
  });
});

describe("Delay in the mix", () => {
  const mixRegistry = createProcessorRegistry([gainProcessor, processor]);

  // A 0.5 s clip with a click at 0.1 s, through a 300 ms half-wet delay.
  const echoing: AudioMix = {
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
        stages: [gainStageAt(1), delay({ [TIME_KEY]: 300, [MIX_KEY]: 0.5 })],
      },
    ],
    buses: [{ id: "bus", stages: [] }],
    master: [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: 120,
    signature: DEFAULT_TIME_SIGNATURE,
  };

  function renderClick(seconds: number, startSeconds = 0) {
    const data = new Float32Array(2 * SAMPLE_RATE);
    data[0.1 * SAMPLE_RATE] = 0.5;
    const media = new Map<string, DecodedAudio>([
      ["click", { sampleRate: SAMPLE_RATE, channels: [data] }],
    ]);
    const [output] = renderAudioMix(
      echoing,
      media,
      {
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        startSeconds,
        length: Math.round(seconds * SAMPLE_RATE),
      },
      mixRegistry,
    );
    return output;
  }

  const frame = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

  it("keeps repeating past the clip's end in an export", () => {
    const output = renderClick(2);
    // The click repeats at 0.4 s, then past the clip's end at 0.5 s.
    assert.ok(Math.abs(output[frame(0.4)] - 0.25) < 1e-6);
    for (const [seconds, level] of [
      [0.7, 0.125],
      [1.0, 0.0625],
      [1.3, 0.03125],
    ]) {
      const heard = sum(output, frame(seconds));
      assert.ok(
        Math.abs(heard - level) < 1e-6,
        `the repeat at ${seconds}s is ${heard}`,
      );
    }
  });

  it("renders the repeats from before an export range into it", () => {
    const whole = renderClick(2);
    const ranged = renderClick(1, 0.9);
    const offset = frame(0.9);
    assert.ok(peak(ranged, 0, ranged.length) > 0.01);
    for (let index = 0; index < ranged.length; index++) {
      assert.ok(Math.abs(ranged[index] - whole[index + offset]) < 1e-6);
    }
  });
});

describe("delayTailSeconds", () => {
  it("is one pass without feedback", () => {
    assert.equal(delayTailSeconds(0.1, 0), 0.1);
  });

  it("lasts until the repeats fall 90 dB", () => {
    // 0.5^15 is the first power of 0.5 under −90 dB.
    assert.ok(Math.abs(delayTailSeconds(0.1, 0.5) - 1.6) < 1e-12);
    assert.ok(delayTailSeconds(0.1, 0.95) > delayTailSeconds(0.1, 0.5));
  });

  it("is the synced note's length at the session tempo", () => {
    const synced = delay(
      { [FEEDBACK_KEY]: 0 },
      { [SYNC_KEY]: "On", [NOTE_KEY]: "1/4" },
    );
    assert.equal(processor.tailSeconds?.(synced, TEMPO), 0.5);
    assert.equal(
      processor.tailSeconds?.(synced, {
        bpm: 60,
        signature: DEFAULT_TIME_SIGNATURE,
      }),
      1,
    );
    const free = delay({ [FEEDBACK_KEY]: 0, [TIME_KEY]: 250 });
    assert.equal(processor.tailSeconds?.(free, TEMPO), 0.25);
  });
});

describe("Delay definition", () => {
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
          : parameter.kind === "enum"
            ? [parameter.key, parameter.options, parameter.defaultValue]
            : [parameter.key],
      ),
      [
        ["Sync", ["Off", "On"], "On"],
        ["Time", 1, 2000, 375, "linear"],
        ["Note", NOTE_OPTIONS, "1/8D"],
        ["Feedback", 0, 0.95, 0.35, "linear"],
        ["Ping-pong", ["Off", "On"], "Off"],
        ["High cut", 1000, 20000, 8000, "log"],
        ["Mix", 0, 1, 0.3, "linear"],
      ],
    );
    assert.deepEqual(NOTE_OPTIONS, [
      "1/32",
      "1/16",
      "1/16D",
      "1/8T",
      "1/8",
      "1/8D",
      "1/4T",
      "1/4",
      "1/4D",
      "1/2",
      "1 bar",
    ]);
  });

  it("shows Time only when Sync is off, and Note only when it is on", () => {
    const visible = Object.fromEntries(
      definition.parameters.map((parameter) => [
        parameter.key,
        parameter.visibleWhen,
      ]),
    );
    assert.deepEqual(visible[TIME_KEY], { key: SYNC_KEY, values: ["Off"] });
    assert.deepEqual(visible[NOTE_KEY], { key: SYNC_KEY, values: ["On"] });
  });

  it("shows readable values", () => {
    const shown = definition.parameters.flatMap((parameter) =>
      parameter.kind === "number"
        ? [parameter.format(parameter.defaultValue)]
        : [],
    );
    assert.deepEqual(shown, ["375 ms", "35%", "8.00 kHz", "30%"]);
  });

  it("has an audio accent of its own", () => {
    assert.equal(definition.domain, "audio");
    const others = EFFECT_DEFINITION_MODULES.filter(
      (module) => module.definition.effectName !== DELAY_EFFECT_NAME,
    ).map((module) => module.definition.accent);
    assert.ok(others.includes(gainDefinition.accent));
    assert.ok(!others.includes(definition.accent));
  });

  it("is offered in the Audio group of the clip, layer and Global menus", () => {
    for (const group of ["clip", "layer", "global"] as const) {
      const audio = groupAddableEffects(addableEffectsFor(group)).find(
        (entry) => entry.domain === "audio",
      );
      assert.ok(
        audio?.effects.some((effect) => effect.effectName === "Delay"),
        `Delay is missing from the ${group} menu`,
      );
    }
    assert.ok(
      addableEffectsFor("clip", "audio").some(
        (effect) => effect.effectName === "Delay",
      ),
    );
  });
});
