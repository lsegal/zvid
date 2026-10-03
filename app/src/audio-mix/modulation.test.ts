import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReactiveTimingFrames } from "../fx-animation-defaults.ts";
import { resolveLfoParameters } from "../fx-animation-lfo.ts";
import { resolveReactiveParameters } from "../fx-animation-reactive.ts";
import { BLOCK_FRAMES } from "./chain.ts";
import {
  type AudioStageLfo,
  type AudioStageTransient,
  lfoSwing,
  modulatedValue,
  StageModulator,
  transientSwing,
} from "./modulation.ts";
import { type AudioTempo, DEFAULT_TIME_SIGNATURE } from "./processor.ts";

const TEMPO: AudioTempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const SAMPLE_RATE = 8000;

function lfo(settings: Partial<AudioStageLfo> = {}): AudioStageLfo {
  return {
    mode: "lfo",
    shape: "Sine",
    sync: true,
    rate: 1,
    syncRate: "1 Bar",
    depth: 1,
    phase: 0,
    parameters: [{ key: "Level", min: 0, max: 1 }],
    ...settings,
  };
}

function transient(
  settings: Partial<AudioStageTransient> = {},
): AudioStageTransient {
  return {
    mode: "transient",
    motion: "Bounce",
    reactivity: 1,
    lengthFrames: 12,
    parameters: [{ key: "Level", min: 0, max: 1 }],
    ...settings,
  };
}

function close(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `${actual} is not ${expected}`,
  );
}

describe("lfoSwing", () => {
  it("moves a knob exactly as Animation's LFO does for the same settings", () => {
    const shapes = [
      "Sine",
      "Triangle",
      "Saw Up",
      "Saw Down",
      "Square",
      "Random",
    ] as const;
    for (const shape of shapes) {
      for (const sync of [true, false]) {
        const settings = lfo({
          shape,
          sync,
          rate: 3,
          syncRate: "1/8T",
          depth: 0.7,
          phase: 30,
          parameters: [{ key: "_HueOffset", min: -1, max: 1 }],
        });
        const animation = {
          shape,
          sync,
          rate: 3,
          syncRate: "1/8T" as const,
          depth: 0.7,
          phase: 30,
          parameters: ["_HueOffset"],
        };
        for (let time = 0; time < 3; time += 0.071) {
          const [expected] = resolveLfoParameters(
            {
              id: "fx-1",
              effectName: "Colorize",
              parameters: [
                { key: "_HueOffset", value: "0.200", numericValue: 0.2 },
              ],
            },
            animation,
            { time, bpm: 137, signature: DEFAULT_TIME_SIGNATURE },
          );
          const swing = lfoSwing(settings, "fx-1", "_HueOffset", time, {
            bpm: 137,
            signature: DEFAULT_TIME_SIGNATURE,
          });
          close(
            modulatedValue(0.2, swing, settings.parameters[0]),
            expected.numericValue ?? 0.2,
            `${shape} ${sync ? "synced" : "free"} at ${time}`,
          );
        }
      }
    }
  });

  it("lines up synced cycles with bars at any tempo", () => {
    const settings = lfo({ shape: "Saw Up" });
    for (const bpm of [90, 120, 137]) {
      const bar = (4 * 60) / bpm;
      const tempo = { ...TEMPO, bpm };
      for (const bars of [0, 1, 3, 10]) {
        close(lfoSwing(settings, "fx", "Level", bars * bar, tempo), -0.25);
        close(lfoSwing(settings, "fx", "Level", (bars + 0.5) * bar, tempo), 0);
      }
    }
  });

  it("draws Random from the effect and knob, the same every time", () => {
    const settings = lfo({ shape: "Random", syncRate: "1/4" });
    const steps = [0.1, 0.6, 1.1, 1.6].map((time) =>
      lfoSwing(settings, "fx", "Level", time, TEMPO),
    );
    assert.deepEqual(
      steps,
      [0.1, 0.6, 1.1, 1.6].map((time) =>
        lfoSwing(settings, "fx", "Level", time, TEMPO),
      ),
    );
    // Within a quarter note it holds; the next quarter note draws again.
    assert.equal(lfoSwing(settings, "fx", "Level", 0.2, TEMPO), steps[0]);
    assert.notEqual(steps[0], steps[1]);
    assert.notEqual(lfoSwing(settings, "other", "Level", 0.1, TEMPO), steps[0]);
    assert.notEqual(lfoSwing(settings, "fx", "Mix", 0.1, TEMPO), steps[0]);
  });
});

describe("modulatedValue", () => {
  it("swings a linear knob by a fraction of its range, clamped", () => {
    const parameter = { key: "Mix", min: 0, max: 2 };
    close(modulatedValue(1, 0.25, parameter), 1.5);
    close(modulatedValue(1.8, 0.25, parameter), 2);
    close(modulatedValue(0.2, -0.25, parameter), 0);
  });

  it("swings a log-taper knob by ratio", () => {
    const parameter = {
      key: "Frequency",
      min: 20,
      max: 20000,
      taper: "log" as const,
    };
    // A third of 20 Hz to 20 kHz's travel is a decade.
    close(modulatedValue(200, 1 / 3, parameter), 2000);
    close(modulatedValue(2000, -1 / 3, parameter), 200);
  });

  it("leaves the knob as it is with no swing", () => {
    assert.equal(modulatedValue(5, 0, { key: "Mix", min: 0, max: 1 }), 5);
  });
});

describe("transientSwing", () => {
  it("moves a knob exactly as Reactive does for the same settings and hits", () => {
    const onsets = [
      { time: 1, strength: 0.8 },
      { time: 1.25, strength: 0.5 },
      { time: 2, strength: 1 },
    ];
    for (const motion of ["Bounce", "Wobble"] as const) {
      for (const timing of ["Slow", "Normal", "Fast"] as const) {
        const reactive = {
          motion,
          timing,
          reactivity: 0.6,
          parameters: ["_HueOffset"],
        };
        const settings = transient({
          motion,
          reactivity: 0.6,
          lengthFrames: getReactiveTimingFrames("Colorize", timing),
          parameters: [{ key: "_HueOffset", min: -1, max: 1 }],
        });
        for (let time = 0.9; time < 2.8; time += 0.037) {
          const [expected] = resolveReactiveParameters(
            {
              id: "fx-1",
              effectName: "Colorize",
              parameters: [
                { key: "_HueOffset", value: "0.200", numericValue: 0.2 },
              ],
            },
            reactive,
            { time, onsets },
          );
          const swing = transientSwing(
            settings,
            "fx-1",
            "_HueOffset",
            onsets,
            time,
          );
          close(
            modulatedValue(0.2, swing, settings.parameters[0]),
            expected.numericValue ?? 0.2,
            `${motion} ${timing} at ${time}`,
          );
        }
      }
    }
  });

  it("moves nothing without a hit, or with Motion None", () => {
    assert.equal(transientSwing(transient(), "fx", "Level", [], 1), 0);
    assert.equal(
      transientSwing(
        transient({ motion: "None" }),
        "fx",
        "Level",
        [{ time: 1, strength: 1 }],
        1.1,
      ),
      0,
    );
  });
});

// A click every half second over silence, starting at `firstSeconds`.
function clicks(seconds: number, firstSeconds = 0.25) {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let seed = 1;
  for (let at = firstSeconds; at < seconds; at += 0.5) {
    const start = Math.round(at * SAMPLE_RATE);
    for (let index = 0; index < 400 && start + index < data.length; index++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[start + index] =
        ((seed / 0xffffffff) * 2 - 1) * 0.8 * (1 - index / 400);
    }
  }
  return data;
}

function swingsOver(
  modulation: AudioStageTransient | AudioStageLfo,
  data: Float32Array,
  startSeconds = 0,
) {
  const modulator = new StageModulator(SAMPLE_RATE);
  const swings: number[] = [];
  for (let block = 0; block < data.length; block += BLOCK_FRAMES) {
    const frames = Math.min(BLOCK_FRAMES, data.length - block);
    const swing = modulator
      .advance(modulation, "fx", [data.subarray(block)], frames, {
        ...TEMPO,
        sampleRate: SAMPLE_RATE,
        timeSeconds: startSeconds + block / SAMPLE_RATE,
      })
      .get("Level");
    swings.push(swing ?? Number.NaN);
  }
  return swings;
}

describe("StageModulator", () => {
  it("hears hits on the stage's input and swings after each", () => {
    const swings = swingsOver(transient(), clicks(2.5));
    const blockAt = (seconds: number) =>
      Math.floor((seconds * SAMPLE_RATE) / BLOCK_FRAMES);
    // Silent before the first click, and settled again before the next.
    assert.ok(swings.slice(0, blockAt(0.24)).every((swing) => swing === 0));
    for (const click of [0.25, 0.75, 1.25, 1.75]) {
      const after = swings.slice(blockAt(click), blockAt(click + 0.3));
      assert.ok(
        after.some((swing) => swing !== 0),
        `no swing after ${click}`,
      );
      assert.equal(swings[blockAt(click + 0.45)], 0);
    }
  });

  it("hears nothing in silence", () => {
    const swings = swingsOver(transient(), new Float32Array(SAMPLE_RATE));
    assert.ok(swings.every((swing) => swing === 0));
  });

  it("swings every LFO knob", () => {
    const settings = lfo({
      depth: 0.5,
      parameters: [
        { key: "Level", min: 0, max: 1 },
        { key: "Mix", min: 0, max: 1 },
      ],
    });
    const modulator = new StageModulator(SAMPLE_RATE);
    const swings = modulator.advance(
      settings,
      "fx",
      [new Float32Array(BLOCK_FRAMES)],
      BLOCK_FRAMES,
      { ...TEMPO, sampleRate: SAMPLE_RATE, timeSeconds: 0.5 },
    );
    const end = 0.5 + BLOCK_FRAMES / SAMPLE_RATE;
    for (const key of ["Level", "Mix"]) {
      close(swings.get(key) ?? 0, lfoSwing(settings, "fx", key, end, TEMPO));
    }
    assert.notEqual(swings.get("Level"), 0);
  });
});
