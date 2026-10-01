import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOVE_EFFECT_NAME } from "./composition-transform.ts";
import { reactsToAudio, resolveAnimatedEffects } from "./fx-animation.ts";
import {
  createDefaultAnimation,
  getAnimatableParameters,
  getReactiveTimingFrames,
  type ReactiveAnimation,
} from "./fx-animation-defaults.ts";
import {
  findReactiveImpulse,
  placeOnsets,
  REACTIVE_FRAME_RATE,
  type ReactiveOnset,
  reactiveEnvelope,
  reactiveOffset,
  resolveReactiveParameters,
} from "./fx-animation-reactive.ts";
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

function reactive(
  overrides: Partial<ReactiveAnimation> = {},
): ReactiveAnimation {
  return {
    motion: "Bounce",
    timing: "Normal",
    reactivity: 1,
    parameters: ["_LowIntensity", "_HighIntensity"],
    ...overrides,
  };
}

function readValue(parameters: SessionEffect["parameters"], key: string) {
  const parameter = parameters.find((candidate) => candidate.key === key);
  return parameter?.numericValue ?? Number(parameter?.value);
}

// The parameter's value at each frame from 0 to `frames`, with one full
// strength hit at frame 10.
function trace(
  effect: SessionEffect,
  settings: ReactiveAnimation,
  key: string,
  frames = 40,
) {
  const onsets = [{ time: 10 / REACTIVE_FRAME_RATE, strength: 1 }];
  return Array.from({ length: frames + 1 }, (_, frame) =>
    readValue(
      resolveReactiveParameters(effect, settings, {
        time: frame / REACTIVE_FRAME_RATE,
        onsets,
      }),
      key,
    ),
  );
}

describe("reactiveEnvelope", () => {
  it("bounces once above zero and settles", () => {
    const values = Array.from({ length: 21 }, (_, step) =>
      reactiveEnvelope("Bounce", step / 20),
    );
    assert.equal(values[0], 0);
    assert.ok(values.every((value) => value >= 0));
    assert.ok(Math.max(...values) > 0.3);
    assert.equal(values[20], 0);
  });

  it("wobbles either side of zero", () => {
    const values = Array.from({ length: 101 }, (_, step) =>
      reactiveEnvelope("Wobble", step / 100),
    );
    assert.ok(values.some((value) => value > 0.1));
    assert.ok(values.some((value) => value < -0.1));
  });

  it("is flat for None and outside the envelope", () => {
    assert.equal(reactiveEnvelope("None", 0.3), 0);
    assert.equal(reactiveEnvelope("Bounce", -0.1), 0);
    assert.equal(reactiveEnvelope("Wobble", 1), 0);
  });
});

// The original walk over every hit up to `time`, kept as a reference for
// the search in `findReactiveImpulse`.
function scanReactiveImpulse(
  onsets: readonly ReactiveOnset[],
  time: number,
  lengthFrames: number,
  fps: number,
) {
  const framesBetween = (from: number, to: number) => (to - from) * fps;
  const isRunning = (start: number, at: number) =>
    framesBetween(start, at) < lengthFrames - 1e-6;
  let start: number | undefined;
  let strength = 0;
  for (const onset of onsets) {
    if (framesBetween(time, onset.time) > 1e-6) {
      break;
    }
    const running = start !== undefined && isRunning(start, onset.time);
    strength = running ? Math.max(strength, onset.strength) : onset.strength;
    start = onset.time;
  }
  if (start === undefined || !isRunning(start, time)) {
    return undefined;
  }
  return {
    seed: Math.round(start * 60),
    strength,
    u: Math.max(0, framesBetween(start, time)) / lengthFrames,
  };
}

describe("findReactiveImpulse", () => {
  it("runs for the timing's frames after a hit", () => {
    const onsets = [{ time: 1, strength: 0.8 }];
    assert.equal(findReactiveImpulse(onsets, 0.99, 12), undefined);
    const impulse = findReactiveImpulse(onsets, 1.2, 12);
    assert.equal(impulse?.strength, 0.8);
    assert.ok(Math.abs((impulse?.u ?? 0) - 0.5) < 1e-9);
    assert.equal(findReactiveImpulse(onsets, 1.4, 12), undefined);
  });

  it("counts the timing's frames at the session frame rate", () => {
    const onsets = [{ time: 1, strength: 1 }];
    // 12 frames last 0.2 s at 60 fps and 0.5 s at 24 fps.
    assert.ok(
      Math.abs((findReactiveImpulse(onsets, 1.1, 12, 60)?.u ?? 0) - 0.5) < 1e-9,
    );
    assert.equal(findReactiveImpulse(onsets, 1.2, 12, 60), undefined);
    assert.ok(
      Math.abs((findReactiveImpulse(onsets, 1.25, 12, 24)?.u ?? 0) - 0.5) <
        1e-9,
    );
    assert.equal(findReactiveImpulse(onsets, 1.25, 12, 0), undefined);
  });

  it("restarts on a hit during the envelope, keeping the larger strength", () => {
    const onsets = [
      { time: 1, strength: 0.9 },
      { time: 1.2, strength: 0.3 },
    ];
    const impulse = findReactiveImpulse(onsets, 1.3, 12);
    assert.equal(impulse?.strength, 0.9);
    assert.ok(Math.abs((impulse?.u ?? 0) - 0.25) < 1e-9);
    assert.equal(impulse?.seed, 72);
  });

  it("starts afresh after the envelope has ended", () => {
    const onsets = [
      { time: 1, strength: 0.9 },
      { time: 2, strength: 0.3 },
    ];
    assert.equal(findReactiveImpulse(onsets, 2.1, 12)?.strength, 0.3);
  });

  it("matches a full scan of the hits for any time", () => {
    let state = 628;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (let round = 0; round < 200; round++) {
      const onsets = Array.from({ length: Math.floor(random() * 40) }, () => ({
        time: Math.round(random() * 600) / 60,
        strength: random(),
      })).sort((left, right) => left.time - right.time);
      const lengthFrames = 1 + Math.floor(random() * 30);
      const fps = [24, 30, 60][Math.floor(random() * 3)];
      for (let query = 0; query < 50; query++) {
        // Half the queries land exactly on a hit or a frame boundary.
        const time =
          query % 2 && onsets.length
            ? onsets[Math.floor(random() * onsets.length)].time +
              Math.floor(random() * (lengthFrames + 2)) / fps
            : random() * 11 - 0.5;
        assert.deepEqual(
          findReactiveImpulse(onsets, time, lengthFrames, fps),
          scanReactiveImpulse(onsets, time, lengthFrames, fps),
          `round ${round}, time ${time}`,
        );
      }
    }
  });

  it("neither sorts nor copies the hits", () => {
    const onsets = Array.from({ length: 10_000 }, (_, index) => ({
      time: index / 60,
      strength: (index % 7) / 7,
    }));
    // node:test can't mock methods on Array.prototype, itself an array.
    const { sort, slice } = Array.prototype;
    const iterator = Array.prototype[Symbol.iterator];
    const calls: string[] = [];
    Array.prototype.sort = function (...args) {
      calls.push("sort");
      return sort.apply(this, args);
    };
    Array.prototype.slice = function (...args) {
      calls.push("slice");
      return slice.apply(this, args);
    };
    Array.prototype[Symbol.iterator] = function () {
      calls.push("iterate");
      return iterator.call(this);
    };
    try {
      for (let query = 0; query < 1_000; query++) {
        findReactiveImpulse(onsets, query / 6, 12);
      }
    } finally {
      Object.assign(Array.prototype, { sort, slice });
      Array.prototype[Symbol.iterator] = iterator;
    }
    assert.deepEqual(calls, []);
  });

  it("gets the detector's oldest-first hits in ascending time order", () => {
    const placed = placeOnsets(
      [
        { secondsAgo: 0.9, strength: 0.2 },
        { secondsAgo: 0.5, strength: 1 },
        { secondsAgo: 0.1, strength: 0.4 },
      ],
      3,
    );
    assert.deepEqual(
      placed.map((onset) => onset.time),
      [2.1, 2.5, 2.9],
    );
    assert.equal(findReactiveImpulse(placed, 2.95, 30)?.strength, 1);
  });
});

describe("resolveReactiveParameters", () => {
  it("moves a knob only for the timing's frames after a hit", () => {
    const effect = negativeSplit();
    const length = getReactiveTimingFrames("NegativeSplit", "Normal");
    const values = trace(effect, reactive(), "_LowIntensity");

    values.forEach((value, frame) => {
      if (frame <= 10 || frame >= 10 + length) {
        assert.equal(value, 0.5, `frame ${frame}`);
      }
    });
    assert.ok(
      values.slice(11, 10 + length).some((value) => value !== 0.5),
      "the knob should move during the envelope",
    );
    // Bounce pushes one way only, by at most the range scale.
    const deviations = values.map((value) => value - 0.5);
    assert.ok(
      deviations.every((value) => value >= 0) ||
        deviations.every((value) => value <= 0),
    );
    assert.ok(deviations.every((value) => Math.abs(value) <= 0.25));
  });

  it("swings a knob both ways with Wobble", () => {
    const values = trace(
      negativeSplit(),
      reactive({ motion: "Wobble", timing: "Slow" }),
      "_HighIntensity",
    );
    assert.ok(values.some((value) => value > 0.5));
    assert.ok(values.some((value) => value < 0.5));
  });

  it("keeps knobs within their limits", () => {
    const values = trace(
      negativeSplit(1, 0),
      reactive(),
      "_LowIntensity",
    ).concat(trace(negativeSplit(1, 0), reactive(), "_HighIntensity"));
    assert.ok(values.every((value) => value >= 0 && value <= 1));
  });

  it("changes nothing at Reactivity 0 or with Motion None", () => {
    const effect = negativeSplit();
    for (const settings of [
      reactive({ reactivity: 0 }),
      reactive({ motion: "None" }),
    ]) {
      assert.ok(
        trace(effect, settings, "_LowIntensity").every(
          (value) => value === 0.5,
        ),
      );
      assert.equal(
        resolveReactiveParameters(effect, settings, {
          time: 12 / REACTIVE_FRAME_RATE,
          onsets: [{ time: 10 / REACTIVE_FRAME_RATE, strength: 1 }],
        }),
        effect.parameters,
      );
    }
  });

  it("scales the swing by Reactivity", () => {
    const effect = negativeSplit();
    const full = trace(effect, reactive(), "_LowIntensity");
    const half = trace(effect, reactive({ reactivity: 0.5 }), "_LowIntensity");
    full.forEach((value, frame) => {
      assert.ok(Math.abs((half[frame] - 0.5) * 2 - (value - 0.5)) < 1e-9);
    });
  });

  it("leaves unselected knobs alone", () => {
    const values = trace(
      negativeSplit(),
      reactive({ parameters: ["_LowIntensity"] }),
      "_HighIntensity",
    );
    assert.ok(values.every((value) => value === 0.5));
  });

  it("never moves parameters that aren't knobs", () => {
    const effect = createEffect(
      GLOBAL_EFFECT_TRACK_ID,
      MOVE_EFFECT_NAME,
      "move-1",
    );
    const keys = getAnimatableParameters(MOVE_EFFECT_NAME).map(
      (parameter) => parameter.key,
    );
    assert.ok(!keys.includes("Motion"));

    const motion = effect.parameters.find(
      (parameter) => parameter.key === "Motion",
    );
    for (let frame = 0; frame <= 40; frame++) {
      const parameters = resolveReactiveParameters(
        effect,
        reactive({ parameters: ["Motion"] }),
        {
          time: frame / REACTIVE_FRAME_RATE,
          onsets: [{ time: 10 / REACTIVE_FRAME_RATE, strength: 1 }],
        },
      );
      assert.equal(parameters, effect.parameters);
      assert.deepEqual(
        parameters.find((parameter) => parameter.key === "Motion"),
        motion,
      );
    }
  });

  it("gives preview and export the same values for the same hit", () => {
    // Export reads the hit on the detector's grid; preview sees it a
    // fraction of a tick later, from a different frame.
    const time = 12 / REACTIVE_FRAME_RATE;
    const exported = placeOnsets([{ secondsAgo: 2 / 30, strength: 0.7 }], time);
    const previewed = placeOnsets(
      [{ secondsAgo: 2 / 30 + 0.004, strength: 0.7 }],
      time,
    );
    assert.deepEqual(previewed, exported);

    const settings = reactive({ motion: "Wobble" });
    assert.deepEqual(
      resolveReactiveParameters(negativeSplit(), settings, {
        time,
        onsets: previewed,
      }),
      resolveReactiveParameters(negativeSplit(), settings, {
        time,
        onsets: exported,
      }),
    );
  });

  it("picks a stable random offset per effect, parameter and hit", () => {
    const offset = reactiveOffset("split-1", "_LowIntensity", 20);
    assert.equal(reactiveOffset("split-1", "_LowIntensity", 20), offset);
    assert.ok(offset >= -1 && offset <= 1);
    const offsets = new Set(
      Array.from({ length: 50 }, (_, seed) =>
        reactiveOffset("split-1", "_LowIntensity", seed),
      ),
    );
    assert.ok(offsets.size > 45);
    assert.ok([...offsets].some((value) => value < 0));
    assert.ok([...offsets].some((value) => value > 0));
    assert.notEqual(reactiveOffset("split-1", "_HighIntensity", 20), offset);
    assert.notEqual(reactiveOffset("split-2", "_LowIntensity", 20), offset);
  });

  it("never moves an Order, which doesn't support Reactive mode", () => {
    const order = createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order-1");
    const settings = reactive({ parameters: ["Spacing", "GridSize"] });
    for (let frame = 0; frame <= 40; frame++) {
      assert.equal(
        resolveReactiveParameters(order, settings, {
          time: frame / REACTIVE_FRAME_RATE,
          onsets: [{ time: 10 / REACTIVE_FRAME_RATE, strength: 1 }],
        }),
        order.parameters,
      );
    }
  });
});

describe("resolveAnimatedEffects in Reactive mode", () => {
  it("moves the selected knobs on an audio hit for every clip alike", () => {
    const animation = createDefaultAnimation("NegativeSplit");
    assert.ok(animation);
    const effect: SessionEffect = {
      ...negativeSplit(),
      animation: { ...animation, mode: "reactive", reactive: reactive() },
    };
    const bpm = 120;
    // 0.2 s after a hit at 1 s.
    const frame = {
      playheadQ: (1.2 * bpm) / 60,
      bpm,
      fps: 30,
      audio: {
        low: 0,
        high: 0,
        impulseLow: 0,
        impulseHigh: 0,
        onsets: [{ secondsAgo: 0.2, strength: 1 }],
      },
    };
    const clip = (clipId: string) => ({
      clipId,
      laneId: "lane",
      progress: 0.5,
      elapsedSeconds: 1,
      durationSeconds: 2,
    });

    const [first] = resolveAnimatedEffects([effect], clip("a"), frame);
    const [second] = resolveAnimatedEffects([effect], clip("b"), frame);
    assert.notEqual(first, effect);
    assert.notEqual(readValue(first.parameters, "_LowIntensity"), 0.5);
    assert.deepEqual(first.parameters, second.parameters);

    const [quiet] = resolveAnimatedEffects([effect], clip("a"), {
      ...frame,
      audio: { ...frame.audio, onsets: [] },
    });
    assert.equal(quiet, effect);
  });

  it("never modulates an Order, even one set to Reactive", () => {
    const order = createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order-1");
    const animation = createDefaultAnimation("Order");
    assert.ok(animation);
    const effect: SessionEffect = {
      ...order,
      animation: {
        ...animation,
        mode: "reactive",
        reactive: reactive({ parameters: ["Spacing"] }),
      },
    };
    assert.equal(reactsToAudio(effect), false);
    const bpm = 120;
    const [resolved] = resolveAnimatedEffects(
      [effect],
      {
        clipId: "a",
        laneId: "lane",
        progress: 0.5,
        elapsedSeconds: 1,
        durationSeconds: 2,
      },
      {
        playheadQ: (1.2 * bpm) / 60,
        bpm,
        fps: 30,
        audio: {
          low: 0,
          high: 0,
          impulseLow: 0,
          impulseHigh: 0,
          onsets: [{ secondsAgo: 0.2, strength: 1 }],
        },
      },
    );
    assert.equal(resolved, effect);
  });
});
