import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextTransport } from "./chain-node.ts";
import { loopedSeconds, nearPlayhead } from "./voice-window.ts";

const loop = { startSeconds: 10, endSeconds: 20 };

describe("loopedSeconds", () => {
  it("wraps media playing ahead past the out marker before the playhead does", () => {
    assert.equal(loopedSeconds(19.9, 20.05, loop), 10.05);
    assert.equal(loopedSeconds(19.9, 19.95, loop), 19.95);
    // Playback already past the out marker plays on.
    assert.equal(loopedSeconds(21, 21.1, loop), 21.1);
    assert.equal(loopedSeconds(19.9, 20.05, null), 20.05);
  });
});

describe("nearPlayhead", () => {
  it("keeps voices for clips at the loop's start ready before it wraps", () => {
    // A decoded clip from 10 s to 12 s, the playhead at 19 s.
    assert.equal(nearPlayhead(19, 10, 12, true, 0, loop), true);
    assert.equal(nearPlayhead(19, 10, 12, true, 0, null), false);
    // A clip ending before the in marker never plays in the next pass.
    assert.equal(nearPlayhead(19, 5, 10, true, 0, loop), false);
    // Too far from the out marker for media an element plays.
    assert.equal(nearPlayhead(17, 10, 12, false, 0, loop), false);
    assert.equal(nearPlayhead(18.6, 10, 12, false, 0, loop), true);
  });

  it("keeps voices from shortly before a clip until after it, or its tail", () => {
    assert.equal(nearPlayhead(0.6, 2, 4, false, 0, null), true);
    assert.equal(nearPlayhead(0.4, 2, 4, false, 0, null), false);
    assert.equal(nearPlayhead(6.9, 2, 4, false, 0, null), true);
    assert.equal(nearPlayhead(7.5, 2, 4, false, 5, null), true);
  });
});

describe("nextTransport", () => {
  const transport = { contextTime: 0, timelineSeconds: 19.5, rate: 1 };

  it("resets the chains on a seek", () => {
    assert.deepEqual(nextTransport(transport, 0.5, 12, true), {
      transport: { contextTime: 0.5, timelineSeconds: 12, rate: 1 },
      reset: true,
    });
  });

  it("plays the chains on, tails and all, into the loop's next pass", () => {
    assert.deepEqual(nextTransport(transport, 0.52, 10.02, true, loop), {
      transport: { contextTime: 0.52, timelineSeconds: 10.02, rate: 1 },
      reset: false,
    });
    // A seek elsewhere still resets them.
    assert.equal(nextTransport(transport, 0.52, 14, true, loop)?.reset, true);
  });
});
