import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAnimatedEffects } from "./fx-animation.ts";
import {
  createDefaultAnimation,
  LFO_SHAPES,
  LFO_SYNC_RATES,
  type LfoAnimation,
} from "./fx-animation-defaults.ts";
import {
  evaluateLfoCycles,
  lfoSyncQuarters,
  lfoWaveform,
  resolveLfoParameters,
} from "./fx-animation-lfo.ts";
import { DEFAULT_REACTIVE_RANGE_SCALE } from "./fx-animation-reactive.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  type SessionEffect,
} from "./fx-stack.ts";

function negativeSplit(low = 0.5, high = 0.5): SessionEffect {
  const effect = createEffect(
    GLOBAL_EFFECT_TRACK_ID,
    "NegativeSplit",
    "split-1",
  );
  return {
    ...effect,
    parameters: effect.parameters.map((parameter) =>
      parameter.key === "_LowIntensity"
        ? { ...parameter, value: low.toFixed(3), numericValue: low }
        : parameter.key === "_HighIntensity"
          ? { ...parameter, value: high.toFixed(3), numericValue: high }
          : parameter,
    ),
  };
}

function lfo(overrides: Partial<LfoAnimation> = {}): LfoAnimation {
  return {
    shape: "Sine",
    sync: false,
    rate: 1,
    syncRate: "1 Bar",
    depth: 1,
    phase: 0,
    parameters: ["_LowIntensity", "_HighIntensity"],
    ...overrides,
  };
}

function readValue(parameters: SessionEffect["parameters"], key: string) {
  const parameter = parameters.find((candidate) => candidate.key === key);
  return parameter?.numericValue ?? Number(parameter?.value);
}

function range(effectName: string, key: string) {
  const definition = getEffectDefinition(effectName).parameters.find(
    (parameter) => parameter.key === key,
  );
  assert.ok(definition?.kind === "number");
  return definition.max - definition.min;
}

const FOUR_FOUR = { numerator: 4, denominator: 4 };
const SIX_EIGHT = { numerator: 6, denominator: 8 };

describe("lfoWaveform", () => {
  const cases: [LfoAnimation["shape"], number[]][] = [
    // Values at phases 0, 1/4, 1/2 and 3/4.
    ["Sine", [0, 1, 0, -1]],
    ["Triangle", [0, 1, 0, -1]],
    ["Saw Up", [-1, -0.5, 0, 0.5]],
    ["Saw Down", [1, 0.5, 0, -0.5]],
    ["Square", [1, 1, -1, -1]],
  ];
  for (const [shape, values] of cases) {
    it(`gives ${shape} its values at each quarter cycle`, () => {
      values.forEach((value, index) => {
        const actual = lfoWaveform(shape, index / 4);
        assert.ok(
          Math.abs(actual - value) < 1e-9,
          `${shape} at ${index}/4: ${actual}`,
        );
      });
    });
  }

  it("repeats every cycle", () => {
    for (const shape of LFO_SHAPES.filter((shape) => shape !== "Random")) {
      for (const phase of [0.1, 0.35, 0.8]) {
        const difference =
          lfoWaveform(shape, phase) - lfoWaveform(shape, phase + 3);
        assert.ok(Math.abs(difference) < 1e-9, `${shape} at ${phase}`);
      }
    }
  });

  it("stays within -1..1", () => {
    for (const shape of LFO_SHAPES) {
      for (let step = 0; step < 64; step++) {
        const value = lfoWaveform(shape, step / 16, "seed");
        assert.ok(value >= -1 && value <= 1, `${shape} ${value}`);
      }
    }
  });

  it("holds one Random value per cycle, the same for the same seed", () => {
    const first = lfoWaveform("Random", 2.1, "split-1");
    assert.equal(lfoWaveform("Random", 2.9, "split-1"), first);
    assert.equal(lfoWaveform("Random", 2.5, "split-1"), first);
    assert.notEqual(lfoWaveform("Random", 3.1, "split-1"), first);
    assert.notEqual(lfoWaveform("Random", 2.1, "split-2"), first);
  });
});

describe("lfoSyncQuarters", () => {
  it("measures bars by the time signature", () => {
    assert.equal(lfoSyncQuarters("1 Bar", FOUR_FOUR), 4);
    assert.equal(lfoSyncQuarters("4 Bars", FOUR_FOUR), 16);
    assert.equal(lfoSyncQuarters("1 Bar", SIX_EIGHT), 3);
    assert.equal(
      lfoSyncQuarters("2 Bars", { numerator: 3, denominator: 4 }),
      6,
    );
    assert.equal(lfoSyncQuarters("1 Bar"), 4);
  });

  it("measures notes, dotted and triplet values in quarters", () => {
    assert.equal(lfoSyncQuarters("1/4"), 1);
    assert.equal(lfoSyncQuarters("1/2D"), 3);
    assert.equal(lfoSyncQuarters("1/8T"), 1 / 3);
    assert.equal(lfoSyncQuarters("1/32"), 1 / 8);
    for (const syncRate of LFO_SYNC_RATES) {
      assert.ok(lfoSyncQuarters(syncRate) > 0, syncRate);
    }
  });
});

describe("evaluateLfoCycles", () => {
  it("runs a free LFO at its rate in Hz, whatever the tempo", () => {
    const free = lfo({ rate: 2 });
    assert.equal(evaluateLfoCycles(free, { time: 1.5, bpm: 90 }), 3);
    assert.equal(evaluateLfoCycles(free, { time: 1.5, bpm: 140 }), 3);
  });

  it("starts each synced cycle on a bar line at any tempo", () => {
    const synced = lfo({ sync: true, syncRate: "1 Bar" });
    for (const bpm of [60, 120, 137, 174]) {
      // Three 4/4 bars in.
      const time = (12 * 60) / bpm;
      const cycles = evaluateLfoCycles(synced, {
        time,
        bpm,
        signature: FOUR_FOUR,
      });
      assert.ok(Math.abs(cycles - 3) < 1e-9, `${bpm} bpm: ${cycles}`);
    }
  });

  it("follows bars in other time signatures", () => {
    const synced = lfo({ sync: true, syncRate: "1 Bar" });
    // Two 6/8 bars are six quarters, three seconds at 120 bpm.
    assert.equal(
      evaluateLfoCycles(synced, { time: 3, bpm: 120, signature: SIX_EIGHT }),
      2,
    );
  });

  it("runs a 1/16 synced LFO four times per beat", () => {
    const synced = lfo({ sync: true, syncRate: "1/16" });
    assert.equal(evaluateLfoCycles(synced, { time: 0.5, bpm: 120 }), 4);
  });

  it("starts at the Phase offset", () => {
    assert.equal(
      evaluateLfoCycles(lfo({ phase: 90 }), { time: 0, bpm: 120 }),
      0.25,
    );
    assert.equal(
      evaluateLfoCycles(lfo({ sync: true, phase: 180 }), { time: 0, bpm: 0 }),
      0.5,
    );
  });
});

describe("resolveLfoParameters", () => {
  it("swings the selected knobs by Depth of their scaled range", () => {
    const effect = negativeSplit();
    // A quarter cycle in, a Sine is at its peak.
    const parameters = resolveLfoParameters(effect, lfo({ depth: 0.4 }), {
      time: 0.25,
      bpm: 120,
    });
    const reach = range("NegativeSplit", "_LowIntensity");
    const expected = 0.5 + 0.4 * reach * DEFAULT_REACTIVE_RANGE_SCALE;
    assert.ok(
      Math.abs(readValue(parameters, "_LowIntensity") - expected) < 1e-9,
    );
    // Three quarters in, at its trough.
    const trough = resolveLfoParameters(effect, lfo({ depth: 0.4 }), {
      time: 0.75,
      bpm: 120,
    });
    assert.ok(
      Math.abs(
        readValue(trough, "_LowIntensity") -
          (0.5 - 0.4 * reach * DEFAULT_REACTIVE_RANGE_SCALE),
      ) < 1e-9,
    );
  });

  it("scales the swing with the range scale and clamps to the knob's limits", () => {
    const effect = negativeSplit(0.5, 0.5);
    const definition = getEffectDefinition("NegativeSplit").parameters.find(
      (parameter) => parameter.key === "_HighIntensity",
    );
    assert.ok(definition?.kind === "number");
    const parameters = resolveLfoParameters(effect, lfo(), {
      time: 0.25,
      bpm: 120,
      rangeScale: 10,
    });
    assert.equal(readValue(parameters, "_HighIntensity"), definition.max);
  });

  it("moves only the selected knobs", () => {
    const effect = negativeSplit();
    const parameters = resolveLfoParameters(
      effect,
      lfo({ parameters: ["_HighIntensity"] }),
      { time: 0.25, bpm: 120 },
    );
    assert.equal(readValue(parameters, "_LowIntensity"), 0.5);
    assert.notEqual(readValue(parameters, "_HighIntensity"), 0.5);
  });

  it("changes nothing at zero Depth, with no knobs, or on Order", () => {
    const effect = negativeSplit();
    const options = { time: 0.25, bpm: 120 };
    assert.equal(
      resolveLfoParameters(effect, lfo({ depth: 0 }), options),
      effect.parameters,
    );
    assert.equal(
      resolveLfoParameters(effect, lfo({ parameters: [] }), options),
      effect.parameters,
    );
    const order = createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order-1");
    assert.equal(
      resolveLfoParameters(order, lfo({ parameters: ["Spacing"] }), options),
      order.parameters,
    );
  });

  it("gives Random the same steps for the same effect, and its own per knob", () => {
    const effect = negativeSplit();
    const random = lfo({ shape: "Random" });
    const at = (time: number, target = effect) =>
      resolveLfoParameters(target, random, { time, bpm: 120 });
    const first = at(2.2);
    assert.deepEqual(at(2.2), first);
    assert.deepEqual(at(2.8), first);
    assert.notEqual(
      readValue(first, "_LowIntensity"),
      readValue(first, "_HighIntensity"),
    );
    const other = at(2.2, { ...effect, id: "split-2" });
    assert.notDeepEqual(other, first);
  });
});

describe("LFO mode in resolveAnimatedEffects", () => {
  const clipContext = {
    clipId: "clip-1",
    laneId: "lane-1",
    progress: 0.5,
    elapsedSeconds: 1,
    durationSeconds: 2,
  };

  function withLfo(effect: SessionEffect, settings: LfoAnimation) {
    const animation = createDefaultAnimation(effect.effectName);
    assert.ok(animation);
    return {
      ...effect,
      animation: { ...animation, mode: "lfo" as const, lfo: settings },
    };
  }

  it("moves the selected knobs over session time, without audio", () => {
    const effect = withLfo(negativeSplit(), lfo({ depth: 0.5 }));
    // At 120 bpm, a quarter note is half a second: a quarter cycle at 1 Hz.
    const [moved] = resolveAnimatedEffects([effect], clipContext, {
      playheadQ: 0.5,
      bpm: 120,
      fps: 30,
    });
    assert.ok(readValue(moved.parameters, "_LowIntensity") > 0.5);
    const [still] = resolveAnimatedEffects([effect], clipContext, {
      playheadQ: 0,
      bpm: 120,
      fps: 30,
    });
    assert.equal(still, effect);
  });

  it("follows the session's time signature when synced", () => {
    const effect = withLfo(
      negativeSplit(),
      lfo({ sync: true, syncRate: "1 Bar", shape: "Saw Up" }),
    );
    // Halfway through a 6/8 bar a Saw Up is at 0, but only three eighths
    // of the way through a 4/4 bar.
    const frame = { playheadQ: 1.5, bpm: 120, fps: 30 };
    const [sixEight] = resolveAnimatedEffects([effect], clipContext, {
      ...frame,
      signature: SIX_EIGHT,
    });
    assert.equal(sixEight, effect);
    const [fourFour] = resolveAnimatedEffects([effect], clipContext, frame);
    assert.ok(readValue(fourFour.parameters, "_LowIntensity") < 0.5);
  });

  it("leaves LFO settings alone outside LFO mode", () => {
    const effect = withLfo(negativeSplit(), lfo());
    const reactive = {
      ...effect,
      animation: { ...effect.animation, mode: "reactive" as const },
    };
    assert.deepEqual(
      resolveAnimatedEffects([reactive], clipContext, {
        playheadQ: 0.5,
        bpm: 120,
        fps: 30,
      }),
      [reactive],
    );
  });
});
