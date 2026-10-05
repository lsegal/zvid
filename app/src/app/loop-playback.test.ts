import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBeforeLoopEnd,
  loopPlaybackStartQ,
  wrapLoopPlaybackQ,
} from "./loop-playback.ts";

const loop = { startQ: 4, endQ: 8 };

describe("loopPlaybackStartQ", () => {
  it("starts from the playhead before the out marker", () => {
    assert.equal(loopPlaybackStartQ(1, loop), 1);
    assert.equal(loopPlaybackStartQ(6, loop), 6);
  });

  it("starts from the in marker at or past the out marker", () => {
    assert.equal(loopPlaybackStartQ(8, loop), 4);
    assert.equal(loopPlaybackStartQ(20, loop), 4);
  });

  it("starts from the playhead without a loop", () => {
    assert.equal(loopPlaybackStartQ(20, null), 20);
    assert.equal(loopPlaybackStartQ(20, { startQ: 8, endQ: 8 }), 20);
  });
});

describe("isBeforeLoopEnd", () => {
  it("is true only before a loop's out marker", () => {
    assert.equal(isBeforeLoopEnd(7.9, loop), true);
    assert.equal(isBeforeLoopEnd(8, loop), false);
    assert.equal(isBeforeLoopEnd(1, null), false);
  });
});

describe("wrapLoopPlaybackQ", () => {
  it("wraps to the in marker on reaching the out marker", () => {
    assert.equal(wrapLoopPlaybackQ(7.9, 8, loop), 4);
  });

  it("carries the overshoot past the in marker", () => {
    assert.equal(wrapLoopPlaybackQ(7.9, 8.25, loop), 4.25);
  });

  it("wraps playback that started before the in marker", () => {
    assert.equal(wrapLoopPlaybackQ(0, 9, loop), 5);
  });

  it("keeps a long frame's overshoot within the loop", () => {
    assert.equal(wrapLoopPlaybackQ(7, 13, loop), 5);
  });

  it("does not wrap before the out marker", () => {
    assert.equal(wrapLoopPlaybackQ(6, 7.9, loop), undefined);
  });

  it("plays on past the out marker when already past it", () => {
    assert.equal(wrapLoopPlaybackQ(8, 9, loop), undefined);
    assert.equal(wrapLoopPlaybackQ(12, 13, loop), undefined);
  });

  it("does not wrap without a loop", () => {
    assert.equal(wrapLoopPlaybackQ(7.9, 8, null), undefined);
  });
});
