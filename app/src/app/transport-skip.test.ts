import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playFromLoopStart, skipTarget } from "./transport-skip.ts";

const loop = { startQ: 4, endQ: 8 };
const endQ = 20;
const tiny = 0.00001;

const timelineStart = { targetQ: 0, label: "Jump to timeline start" };
const timelineEnd = { targetQ: endQ, label: "Jump to timeline end" };
const loopStart = { targetQ: 4, label: "Jump to loop start" };
const loopEnd = { targetQ: 8, label: "Jump to loop end" };

describe("skipTarget back", () => {
  it("goes to the loop start from inside the loop", () => {
    assert.deepEqual(skipTarget("back", 6, loop, endQ), loopStart);
    assert.deepEqual(skipTarget("back", 8, loop, endQ), loopStart);
    assert.deepEqual(skipTarget("back", 8 + tiny, loop, endQ), loopStart);
  });

  it("goes to the timeline start at the loop start", () => {
    assert.deepEqual(skipTarget("back", 4, loop, endQ), timelineStart);
    assert.deepEqual(skipTarget("back", 4 + tiny, loop, endQ), timelineStart);
  });

  it("goes to the loop end after the loop", () => {
    assert.deepEqual(skipTarget("back", 12, loop, endQ), loopEnd);
  });

  it("goes to the timeline start before the loop", () => {
    assert.deepEqual(skipTarget("back", 2, loop, endQ), timelineStart);
  });

  it("goes to the timeline start without a loop", () => {
    assert.deepEqual(skipTarget("back", 12, null, endQ), timelineStart);
    assert.deepEqual(
      skipTarget("back", 12, { startQ: 8, endQ: 8 }, endQ),
      timelineStart,
    );
  });
});

describe("skipTarget forward", () => {
  it("goes to the loop end from inside the loop", () => {
    assert.deepEqual(skipTarget("forward", 6, loop, endQ), loopEnd);
    assert.deepEqual(skipTarget("forward", 4, loop, endQ), loopEnd);
    assert.deepEqual(skipTarget("forward", 4 - tiny, loop, endQ), loopEnd);
  });

  it("goes to the timeline end at the loop end", () => {
    assert.deepEqual(skipTarget("forward", 8, loop, endQ), timelineEnd);
    assert.deepEqual(skipTarget("forward", 8 - tiny, loop, endQ), timelineEnd);
  });

  it("goes to the loop start before the loop", () => {
    assert.deepEqual(skipTarget("forward", 2, loop, endQ), loopStart);
  });

  it("goes to the timeline end after the loop", () => {
    assert.deepEqual(skipTarget("forward", 12, loop, endQ), timelineEnd);
  });

  it("goes to the timeline end without a loop", () => {
    assert.deepEqual(skipTarget("forward", 2, null, endQ), timelineEnd);
  });
});

describe("playFromLoopStart", () => {
  function run(
    region: { startQ: number; endQ: number } | null,
    isPlaying: boolean,
  ) {
    const calls: string[] = [];
    playFromLoopStart(region, {
      isPlaying,
      togglePlayback: () => calls.push("toggle"),
      jumpPlayheadTo: (targetQ) => calls.push(`jump(${targetQ})`),
      startPlayback: (fromQ) => calls.push(`start(${fromQ})`),
    });
    return calls;
  }

  it("moves to the loop start and plays while stopped", () => {
    assert.deepEqual(run(loop, false), ["jump(4)", "start(4)"]);
  });

  it("restarts from the loop start while playing instead of pausing", () => {
    assert.deepEqual(run(loop, true), ["jump(4)"]);
  });

  it("is plain Play without a loop", () => {
    assert.deepEqual(run(null, false), ["toggle"]);
    assert.deepEqual(run(null, true), ["toggle"]);
    assert.deepEqual(run({ startQ: 4, endQ: 4 }, false), ["toggle"]);
  });
});
