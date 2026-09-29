import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextSourceTrackColorIndex,
  PALETTE_SIZE,
  sessionSourceTrackColorIndex,
  sourceTrackColorIndex,
} from "./source-track-color.ts";

describe("sourceTrackColorIndex", () => {
  it("cycles the palette from its last colour, like the Layers app", () => {
    assert.equal(PALETTE_SIZE, 5);
    assert.deepEqual(
      Array.from({ length: 13 }, (_, index) => sourceTrackColorIndex(index)),
      [4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1],
    );
  });
});

describe("sessionSourceTrackColorIndex", () => {
  it("keeps an opened session's own colours", () => {
    assert.deepEqual(
      [2, 2, -1, 7].map((colorIndex, index) =>
        sessionSourceTrackColorIndex(colorIndex, index),
      ),
      [2, 2, -1, 7],
    );
  });

  it("cycles the palette for tracks without a colour", () => {
    assert.deepEqual(
      [undefined, undefined, 3, undefined].map((colorIndex, index) =>
        sessionSourceTrackColorIndex(colorIndex, index),
      ),
      [4, 0, 3, 2],
    );
  });
});

describe("nextSourceTrackColorIndex", () => {
  it("starts the cycle on the first track", () => {
    assert.equal(nextSourceTrackColorIndex([]), 4);
  });

  it("gives the colour after the last track's", () => {
    const tracks = [4, 0, 1].map((colorIndex) => ({ colorIndex }));
    assert.equal(nextSourceTrackColorIndex(tracks), 2);
    assert.equal(nextSourceTrackColorIndex([{ colorIndex: 3 }]), 4);
    assert.equal(nextSourceTrackColorIndex([{ colorIndex: 4 }]), 0);
  });

  it("follows an opened session's own colours", () => {
    const tracks = [2, 2].map((colorIndex) => ({ colorIndex }));
    assert.equal(nextSourceTrackColorIndex(tracks), 3);
  });

  it("continues by position after a track without a palette colour", () => {
    const tracks = [-1, -1].map((colorIndex) => ({ colorIndex }));
    assert.equal(nextSourceTrackColorIndex(tracks), sourceTrackColorIndex(2));
  });
});
