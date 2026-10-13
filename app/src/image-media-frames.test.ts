import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { animationFrameIndex } from "./image-media-frames.ts";

describe("animationFrameIndex", () => {
  // Frames 0.1 s, 0.2 s and 0.1 s long: a 0.4 s loop.
  const frameEnds = [0.1, 0.3, 0.4];

  it("picks the frame showing at a time into the animation", () => {
    assert.equal(animationFrameIndex(frameEnds, 0), 0);
    assert.equal(animationFrameIndex(frameEnds, 0.099), 0);
    assert.equal(animationFrameIndex(frameEnds, 0.1), 1);
    assert.equal(animationFrameIndex(frameEnds, 0.25), 1);
    assert.equal(animationFrameIndex(frameEnds, 0.35), 2);
  });

  it("loops past the animation's end", () => {
    assert.equal(animationFrameIndex(frameEnds, 0.4), 0);
    assert.equal(animationFrameIndex(frameEnds, 0.55), 1);
    assert.equal(animationFrameIndex(frameEnds, 4.38), 2);
  });

  it("shows the first frame of an animation with no length", () => {
    assert.equal(animationFrameIndex([], 3), 0);
  });
});
