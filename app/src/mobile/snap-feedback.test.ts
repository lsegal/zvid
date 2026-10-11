import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSnapFeedback } from "./snap-feedback.ts";

describe("createSnapFeedback", () => {
  it("buzzes when a touch drag reaches a new snap point", () => {
    const buzzes: number[] = [];
    const feedback = createSnapFeedback((ms) => buzzes.push(ms));
    assert.equal(feedback.update("touch", true, 4), false);
    assert.equal(feedback.update("touch", true, 4), false);
    assert.equal(feedback.update("touch", true, 4.5), true);
    assert.equal(buzzes.length, 1);
  });

  it("stays quiet for mice, pens and unsnapped drags", () => {
    const buzzes: number[] = [];
    const feedback = createSnapFeedback((ms) => buzzes.push(ms));
    feedback.update("mouse", true, 1);
    feedback.update("mouse", true, 2);
    feedback.update("touch", false, 3);
    feedback.update("touch", false, 3.1);
    assert.deepEqual(buzzes, []);
  });

  it("starts over after a reset", () => {
    const buzzes: number[] = [];
    const feedback = createSnapFeedback((ms) => buzzes.push(ms));
    feedback.update("touch", true, 1);
    feedback.reset();
    assert.equal(feedback.update("touch", true, 2), false);
    assert.deepEqual(buzzes, []);
  });
});
