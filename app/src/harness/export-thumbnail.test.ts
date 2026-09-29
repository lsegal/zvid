import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getThumbnailFrameIndex,
  getThumbnailSize,
} from "./export-thumbnail.ts";

describe("getThumbnailFrameIndex", () => {
  it("picks the frame about one second in", () => {
    assert.equal(getThumbnailFrameIndex(240, 24), 24);
    assert.equal(getThumbnailFrameIndex(600, 29.97), 30);
  });

  it("picks the middle frame of exports shorter than two seconds", () => {
    assert.equal(getThumbnailFrameIndex(24, 24), 12);
    assert.equal(getThumbnailFrameIndex(5, 30), 2);
    assert.equal(getThumbnailFrameIndex(1, 30), 0);
  });

  it("stays in range for empty exports", () => {
    assert.equal(getThumbnailFrameIndex(0, 30), 0);
  });
});

describe("getThumbnailSize", () => {
  it("scales the long edge down to 640 px", () => {
    assert.deepEqual(getThumbnailSize(1920, 1080), { width: 640, height: 360 });
    assert.deepEqual(getThumbnailSize(1080, 1920), { width: 360, height: 640 });
    assert.deepEqual(getThumbnailSize(4000, 10), { width: 640, height: 2 });
  });

  it("never upscales", () => {
    assert.deepEqual(getThumbnailSize(320, 180), { width: 320, height: 180 });
  });

  it("keeps at least one pixel", () => {
    assert.deepEqual(getThumbnailSize(10_000, 1), { width: 640, height: 1 });
    assert.deepEqual(getThumbnailSize(0, 0), { width: 1, height: 1 });
  });
});
