import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCompositionEndQ,
  getGroupClipProgress,
} from "./composition-progress.ts";

// At 120 BPM one quarter is half a second.
const BPM = 120;
const CLIPS = [
  { startQ: 0, durationSeconds: 4 },
  { startQ: 4, durationSeconds: 6 },
  { startQ: 2, durationSeconds: 2 },
];

describe("getCompositionEndQ", () => {
  it("ends at the latest clip end", () => {
    assert.equal(getCompositionEndQ(CLIPS, BPM), 16);
  });

  it("is 0 without clips", () => {
    assert.equal(getCompositionEndQ([], BPM), 0);
  });
});

describe("getGroupClipProgress", () => {
  it("runs from 0 at the start to 1 at the end of the last clip", () => {
    assert.equal(getGroupClipProgress(CLIPS, 0, BPM), 0);
    assert.equal(getGroupClipProgress(CLIPS, 4, BPM), 0.25);
    assert.equal(getGroupClipProgress(CLIPS, 8, BPM), 0.5);
    assert.equal(getGroupClipProgress(CLIPS, 16, BPM), 1);
  });

  it("clamps outside the composition", () => {
    assert.equal(getGroupClipProgress(CLIPS, -2, BPM), 0);
    assert.equal(getGroupClipProgress(CLIPS, 20, BPM), 1);
  });

  it("is 0 when the composition is empty", () => {
    assert.equal(getGroupClipProgress([], 4, BPM), 0);
    assert.equal(
      getGroupClipProgress([{ startQ: 0, durationSeconds: 0 }], 4, BPM),
      0,
    );
  });
});
