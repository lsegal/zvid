import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LfoAnimation } from "./fx-animation-defaults.ts";
import { lfoWaveform } from "./fx-animation-waveform.ts";
import {
  lfoTraceSeconds,
  MAX_LFO_TRACE_SECONDS,
  MIN_LFO_TRACE_SECONDS,
  sampleLfoTrace,
  scrollTrace,
} from "./fx-modulation-trace.ts";

const TEMPO = { bpm: 120, signature: { numerator: 4, denominator: 4 } };

function lfo(settings: Partial<LfoAnimation> = {}): LfoAnimation {
  return {
    shape: "Sine",
    sync: false,
    rate: 1,
    syncRate: "1 Bar",
    depth: 1,
    phase: 0,
    parameters: ["Level"],
    ...settings,
  };
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);
}

describe("sampleLfoTrace", () => {
  it("samples the waveform up to the time, oldest first", () => {
    // Five samples over one second of a 1 Hz sine ending at 1 s.
    const trace = sampleLfoTrace(lfo(), { ...TEMPO, time: 1 }, "", 5, 1);
    const expected = [0, 1, 0, -1, 0];
    trace.forEach((value, index) => {
      close(value, expected[index]);
    });
  });

  it("draws each shape", () => {
    for (const shape of ["Triangle", "Saw Up", "Saw Down", "Square"] as const) {
      const trace = sampleLfoTrace(
        lfo({ shape }),
        { ...TEMPO, time: 2 },
        "",
        9,
        1,
      );
      trace.forEach((value, index) => {
        close(value, lfoWaveform(shape, 1 + index / 8));
      });
    }
  });

  it("scales the waveform by Depth", () => {
    const full = sampleLfoTrace(lfo(), { ...TEMPO, time: 0.25 }, "", 3, 0.5);
    const half = sampleLfoTrace(
      lfo({ depth: 0.5 }),
      { ...TEMPO, time: 0.25 },
      "",
      3,
      0.5,
    );
    close(full[2], 1);
    half.forEach((value, index) => {
      close(value, full[index] / 2);
    });
    const none = sampleLfoTrace(
      lfo({ depth: 0 }),
      { ...TEMPO, time: 1 },
      "",
      4,
      1,
    );
    assert.ok(none.every((value) => value === 0));
  });

  it("shifts the waveform by Phase", () => {
    // A quarter cycle ahead, a sine at 0 s is at its peak.
    const trace = sampleLfoTrace(
      lfo({ phase: 90 }),
      { ...TEMPO, time: 0 },
      "",
      1,
      1,
    );
    close(trace[0], 1);
  });

  it("follows a synced Rate on the session tempo", () => {
    // A 1/4 note at 120 BPM is half a second.
    const trace = sampleLfoTrace(
      lfo({ sync: true, syncRate: "1/4" }),
      { ...TEMPO, time: 0.125 },
      "",
      1,
      1,
    );
    close(trace[0], 1);
  });

  it("draws Random from its seed", () => {
    const at = { ...TEMPO, time: 3.5 };
    const one = sampleLfoTrace(lfo({ shape: "Random" }), at, "fx Level", 8, 3);
    const again = sampleLfoTrace(
      lfo({ shape: "Random" }),
      at,
      "fx Level",
      8,
      3,
    );
    const other = sampleLfoTrace(lfo({ shape: "Random" }), at, "fx Mix", 8, 3);
    assert.deepEqual(one, again);
    assert.notDeepEqual(one, other);
  });
});

describe("lfoTraceSeconds", () => {
  it("spans two cycles within its window", () => {
    close(lfoTraceSeconds(lfo({ rate: 1 }), TEMPO), 2);
    close(lfoTraceSeconds(lfo({ rate: 40 }), TEMPO), MIN_LFO_TRACE_SECONDS);
    close(lfoTraceSeconds(lfo({ rate: 0.05 }), TEMPO), MAX_LFO_TRACE_SECONDS);
    close(lfoTraceSeconds(lfo({ rate: 0 }), TEMPO), MAX_LFO_TRACE_SECONDS);
    // A synced half note at 120 BPM is one second.
    close(lfoTraceSeconds(lfo({ sync: true, syncRate: "1/2" }), TEMPO), 2);
  });
});

describe("scrollTrace", () => {
  it("scrolls left by whole steps and fills the end", () => {
    const trace = Float32Array.from([1, 2, 3, 4]);
    scrollTrace(trace, 1.7, 9);
    assert.deepEqual([...trace], [2, 3, 4, 9]);
    scrollTrace(trace, 0.5, 5);
    assert.deepEqual([...trace], [2, 3, 4, 9]);
    scrollTrace(trace, 10, 0);
    assert.deepEqual([...trace], [0, 0, 0, 0]);
  });
});
