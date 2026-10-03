import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReactiveTimingFrames } from "../fx-animation-defaults.ts";
import { resolveReactiveParameters } from "../fx-animation-reactive.ts";
import { BLOCK_FRAMES } from "./chain.ts";
import {
  type AudioStageLfo,
  type AudioStageTransient,
  lfoPeriodSeconds,
  lfoValue,
  lfoWaveform,
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
    note: "1 bar",
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

describe("lfoWaveform", () => {
  it("gives each shape's values at key phases", () => {
    const at = (shape: Parameters<typeof lfoWaveform>[0]) =>
      [0, 0.25, 0.5, 0.75].map((phase) => lfoWaveform(shape, phase));
    const expected = {
      Sine: [0, 1, 0, -1],
      Triangle: [0, 1, 0, -1],
      "Saw Up": [0, 0.5, -1, -0.5],
      "Saw Down": [0, -0.5, 1, 0.5],
      Square: [1, 1, -1, -1],
    } as const;
    for (const [shape, values] of Object.entries(expected)) {
      at(shape as keyof typeof expected).forEach((value, index) => {
        close(value, values[index], `${shape} at ${index / 4}`);
      });
    }
  });

  it("holds Random's value for the cycle", () => {
    assert.equal(lfoWaveform("Random", 0.1, 0.4), 0.4);
    assert.equal(lfoWaveform("Random", 0.9, 0.4), 0.4);
  });
});

describe("lfoPeriodSeconds", () => {
  it("syncs note values to the session tempo", () => {
    close(lfoPeriodSeconds(lfo({ note: "1 bar" }), TEMPO) ?? 0, 2);
    close(
      lfoPeriodSeconds(lfo({ note: "1/4" }), { ...TEMPO, bpm: 90 }) ?? 0,
      2 / 3,
    );
    close(
      lfoPeriodSeconds(lfo({ note: "1/8T" }), { ...TEMPO, bpm: 150 }) ?? 0,
      (0.5 * 60) / 150 / 1.5,
    );
    close(
      lfoPeriodSeconds(lfo({ note: "1 bar" }), {
        bpm: 120,
        signature: { numerator: 3, denominator: 4 },
      }) ?? 0,
      1.5,
    );
  });

  it("runs free at the rate when Sync is off", () => {
    close(lfoPeriodSeconds(lfo({ sync: false, rate: 4 }), TEMPO) ?? 0, 0.25);
  });
});

describe("lfoValue", () => {
  it("lines up synced cycles with bars at any tempo", () => {
    for (const bpm of [90, 120, 137]) {
      const bar = (4 * 60) / bpm;
      const tempo = { ...TEMPO, bpm };
      const settings = lfo({ shape: "Saw Up" });
      for (const bars of [0, 1, 3, 10]) {
        close(lfoValue(settings, "fx", bars * bar, tempo), 0);
        close(lfoValue(settings, "fx", (bars + 0.25) * bar, tempo), 0.5);
      }
    }
  });

  it("starts the cycle at the phase", () => {
    close(lfoValue(lfo({ phase: 90 }), "fx", 0, TEMPO), 1);
    close(lfoValue(lfo({ phase: 180 }), "fx", 0.5, TEMPO), -1);
  });

  it("draws Random from the effect, the same every time", () => {
    const settings = lfo({ shape: "Random", note: "1/4" });
    const cycles = [0.1, 0.6, 1.1, 1.6].map((time) =>
      lfoValue(settings, "fx", time, TEMPO),
    );
    assert.deepEqual(
      cycles,
      [0.1, 0.6, 1.1, 1.6].map((time) => lfoValue(settings, "fx", time, TEMPO)),
    );
    // Within a quarter note it holds; the next quarter note draws again.
    assert.equal(lfoValue(settings, "fx", 0.2, TEMPO), cycles[0]);
    assert.notEqual(cycles[0], cycles[1]);
    assert.notEqual(lfoValue(settings, "other", 0.1, TEMPO), cycles[0]);
    for (const value of cycles) {
      assert.ok(value >= -1 && value <= 1);
    }
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

  it("swings every LFO knob by the waveform times Depth", () => {
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
    const expected = lfoValue(settings, "fx", end, TEMPO) * 0.5 * 0.25;
    close(swings.get("Level") ?? 0, expected);
    close(swings.get("Mix") ?? 0, expected);
  });
});
