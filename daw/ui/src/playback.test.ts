import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPosition,
  clockPosition,
  frameFailureIsFatal,
  needsHostFrames,
  resumePosition,
} from "./playback.ts";

test("falls back to host frames only for codecs the webview can't play", () => {
  assert.equal(needsHostFrames(4), true); // MEDIA_ERR_SRC_NOT_SUPPORTED
  assert.equal(needsHostFrames(3), true); // MEDIA_ERR_DECODE
  assert.equal(needsHostFrames(2), false); // MEDIA_ERR_NETWORK
  assert.equal(needsHostFrames(1), false); // MEDIA_ERR_ABORTED
  assert.equal(needsHostFrames(undefined), false);
});

test("keeps the playhead inside the take", () => {
  assert.equal(clampPosition(3, 10), 3);
  assert.equal(clampPosition(-1, 10), 0);
  assert.equal(clampPosition(12, 10), 10);
  assert.equal(clampPosition(Number.NaN, 10), 0);
  assert.equal(clampPosition(1, -5), 0);
});

test("advances the host-frame clock and stops at the end", () => {
  assert.equal(clockPosition(2, 1500, 10), 3.5);
  assert.equal(clockPosition(9, 5000, 10), 10);
  assert.equal(clockPosition(0, 0, 10), 0);
});

test("replays from the start once the end is reached", () => {
  assert.equal(resumePosition(4, 10), 4);
  assert.equal(resumePosition(10, 10), 0);
  assert.equal(resumePosition(11, 10), 0);
  assert.equal(resumePosition(-2, 10), 0);
});

test("skips a few undecodable host frames but not a missing file", () => {
  const internal = { code: "internal" };
  assert.equal(frameFailureIsFatal(internal, 1), false);
  assert.equal(frameFailureIsFatal(internal, 9), false);
  assert.equal(frameFailureIsFatal(internal, 10), true);
  assert.equal(frameFailureIsFatal({ code: "notFound" }, 1), true);
  assert.equal(frameFailureIsFatal(new Error("offline"), 1), false);
  assert.equal(frameFailureIsFatal(null, 1), false);
});
