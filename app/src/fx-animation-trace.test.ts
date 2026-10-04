import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reactiveEnvelope } from "./fx-animation-impulse.ts";
import {
  ANIMATION_TRACE_SECONDS,
  type AnimationClipSpan,
  findAnimationClipSpan,
  sampleClipTrace,
  sampleReactiveTrace,
} from "./fx-animation-trace.ts";

function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

// One sample a tenth of a second over a second, ending at `time`.
const COUNT = 11;
const SECONDS = 1;

describe("sampleClipTrace", () => {
  // A 3-second clip from 1s, easing over 30 frames at 30 fps: in until 2s,
  // held until 3s, out until 4s.
  const span: AnimationClipSpan = { startSeconds: 1, durationSeconds: 3 };
  const linear = { motionIn: "Linear", motionOut: "Linear" } as const;
  const sample = (
    clip: Parameters<typeof sampleClipTrace>[0],
    time: number,
    within: AnimationClipSpan | undefined = span,
  ) => sampleClipTrace(clip, 30, 30, within, time, COUNT, SECONDS);

  it("eases in, holds and eases out across the clip, ending at the time", () => {
    const entering = sample(linear, 2);
    // From the clip's start (0, so -1) to fully in (1).
    close(entering[0], -1);
    close(entering[5], 0);
    close(entering[10], 1);

    const held = sample(linear, 3);
    for (const value of held) {
      close(value, 1);
    }

    const leaving = sample(linear, 4 - 1e-9);
    close(leaving[0], 1);
    close(leaving[5], 0);
    close(leaving[10], -1, 1e-6);
  });

  it("follows each side's Motion curve", () => {
    const easeIn = sample({ motionIn: "Ease In", motionOut: "Linear" }, 2);
    const easeOut = sample({ motionIn: "Ease Out", motionOut: "Linear" }, 2);
    // Halfway in, Ease In lags a linear ramp and Ease Out leads it.
    assert.ok(easeIn[5] < 0);
    assert.ok(easeOut[5] > 0);
    // A side set to None doesn't animate.
    const none = sample({ motionIn: "None", motionOut: "Linear" }, 2);
    close(none[1], 1);
  });

  it("is flat outside the clip, or without one", () => {
    const before = sample(linear, 0.5);
    const after = sample(linear, 6);
    const missing = sampleClipTrace(linear, 30, 30, undefined, 2, COUNT, 1);
    for (const trace of [before, after, missing]) {
      assert.deepEqual([...new Set(trace)], [-1]);
    }
  });

  it("doesn't ease an end on the session's edge", () => {
    const trace = sample(linear, 2, {
      ...span,
      sessionEdges: { atStart: true, atEnd: false },
    });
    close(trace[5], 1);
  });

  it("eases an Order's slide whatever its Motion In and Out", () => {
    const trace = sample(
      { motionIn: "None", motionOut: "None", transition: "Push" },
      2,
    );
    close(trace[0], -1);
    close(trace[5], 0, 1e-3);
  });
});

describe("sampleReactiveTrace", () => {
  const onsets = [
    { time: 1, strength: 1 },
    { time: 3, strength: 0.5 },
  ];
  // Envelopes 30 frames (a second) long at 30 fps.
  const sample = (
    reactive: Parameters<typeof sampleReactiveTrace>[0],
    time: number,
  ) => sampleReactiveTrace(reactive, onsets, 30, 30, time, COUNT, SECONDS);
  const peak = (motion: "Bounce" | "Wobble") => {
    let most = 0;
    for (let index = 0; index < 2000; index++) {
      most = Math.max(most, Math.abs(reactiveEnvelope(motion, index / 2000)));
    }
    return most;
  };

  it("spikes on each hit and falls back along the Motion envelope", () => {
    const trace = sample({ motion: "Bounce", reactivity: 1 }, 2);
    // Flat before the hit at 1s, which runs until 2s.
    for (let index = 0; index <= 10; index++) {
      const u = index / 10;
      close(trace[index], reactiveEnvelope("Bounce", u) / peak("Bounce"));
    }
    assert.ok(Math.max(...trace) > 0.9);
    // It settles before the next hit.
    assert.deepEqual(
      [...new Set(sample({ motion: "Bounce", reactivity: 1 }, 2.9))].slice(-1),
      [0],
    );
  });

  it("swings either side of zero for Wobble", () => {
    const trace = sample({ motion: "Wobble", reactivity: 1 }, 2);
    assert.ok(Math.min(...trace) < 0);
    assert.ok(Math.max(...trace) > 0);
  });

  it("scales by Reactivity and the hit's strength", () => {
    const full = sample({ motion: "Bounce", reactivity: 1 }, 2);
    const half = sample({ motion: "Bounce", reactivity: 0.5 }, 2);
    const weakHit = sample({ motion: "Bounce", reactivity: 1 }, 4);
    for (let index = 0; index < COUNT; index++) {
      close(half[index], full[index] / 2);
      close(weakHit[index], full[index] / 2);
    }
  });

  it("is flat with no Motion or no Reactivity", () => {
    for (const reactive of [
      { motion: "None", reactivity: 1 },
      { motion: "Bounce", reactivity: 0 },
    ] as const) {
      assert.deepEqual([...new Set(sample(reactive, 2))], [0]);
    }
  });

  it("spans the default window", () => {
    const trace = sampleReactiveTrace(
      { motion: "Bounce", reactivity: 1 },
      onsets,
      30,
      30,
      1 + ANIMATION_TRACE_SECONDS,
      2,
      ANIMATION_TRACE_SECONDS,
    );
    // The first sample is on the hit itself, where the envelope starts at 0.
    close(trace[0], 0);
  });
});

describe("findAnimationClipSpan", () => {
  // At 120 bpm, a quarter is half a second.
  const clips = [
    { id: "a", laneId: "top", startQ: 2, durationSeconds: 2 },
    { id: "b", laneId: "bottom", startQ: 0, durationSeconds: 4 },
    { id: "c", laneId: "bottom", startQ: 8, durationSeconds: 2 },
  ];
  const priority = new Map([
    ["top", 0],
    ["bottom", 1],
  ]);
  const find = (
    group: "clip" | "layer" | "global",
    time: number,
    target: { laneId?: string; clipId?: string } = {},
  ) =>
    findAnimationClipSpan(
      clips,
      { group, ...target },
      time,
      120,
      30,
      priority,
      10,
    );

  it("follows a clip device's own clip wherever the playhead is", () => {
    assert.deepEqual(find("clip", 0, { clipId: "c" }), {
      startSeconds: 4,
      durationSeconds: 2,
      sessionEdges: { atStart: false, atEnd: false },
    });
  });

  it("follows a layer device's clip at the playhead on its layer", () => {
    assert.equal(find("layer", 1.5, { laneId: "bottom" })?.startSeconds, 0);
    assert.equal(find("layer", 5, { laneId: "bottom" })?.startSeconds, 4);
    // Away from them, the selected clip on its layer, or none.
    assert.equal(
      find("layer", 7, { laneId: "bottom", clipId: "c" })?.startSeconds,
      4,
    );
    assert.equal(
      find("layer", 7, { laneId: "bottom", clipId: "a" }),
      undefined,
    );
  });

  it("follows a Global device's topmost clip at the playhead", () => {
    assert.equal(find("global", 1.5)?.startSeconds, 1);
    assert.equal(find("global", 0.5)?.startSeconds, 0);
    assert.equal(find("global", 8, { clipId: "a" })?.startSeconds, 1);
    assert.equal(find("global", 8), undefined);
  });

  it("marks ends on the session's edges", () => {
    assert.deepEqual(find("layer", 1, { laneId: "bottom" })?.sessionEdges, {
      atStart: true,
      atEnd: false,
    });
  });
});
