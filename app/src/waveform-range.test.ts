import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ClipWarp, createClipWarp, warpSourceTime } from "./clip-warp.ts";
import {
  getClipWaveformRange,
  getMediaLoopMarkersPx,
  getSourceSpanWaveformRange,
  getVisibleClipSlice,
  getWaveformSourceSpan,
  loopWaveformSourceSpan,
} from "./waveform-range.ts";

// At 120 BPM and 20 px per quarter, one pixel is 1/40 s.
const BPM = 120;
const QUARTER_PX = 20;
const SECONDS_PER_PX = 1 / 40;

function assertSpan(
  actual: [number, number] | null,
  expected: [number, number],
) {
  assert.ok(actual, `expected [${expected}], got null`);
  assert.ok(
    Math.abs(actual[0] - expected[0]) < 1e-9 &&
      Math.abs(actual[1] - expected[1]) < 1e-9,
    `expected [${expected}], got [${actual}]`,
  );
}

const clip = {
  startQ: 8,
  // Song time 4 s at the clip's start plays source 1.5 s.
  sourceOffsetSeconds: -2.5,
  sourceWindowStartSeconds: 1.5,
  sourceWindowEndSeconds: 3,
};

describe("getClipWaveformRange", () => {
  it("starts at the clip's song time plus its source offset", () => {
    const range = getClipWaveformRange(clip, BPM, QUARTER_PX);
    assert.equal(range.startSeconds, 1.5);
    assert.equal(range.secondsPerPx, SECONDS_PER_PX);
    assertSpan(getWaveformSourceSpan(range, 0, 40), [1.5, 2.5]);
  });

  it("follows the in-point when the start is trimmed", () => {
    // Trimming the start by a quarter (0.5 s) keeps the source offset.
    const range = getClipWaveformRange(
      { ...clip, startQ: 9, sourceWindowStartSeconds: 2 },
      BPM,
      QUARTER_PX,
    );
    assertSpan(getWaveformSourceSpan(range, 0, 20), [2, 2.5]);
  });

  it("draws nothing outside the source window", () => {
    const range = getClipWaveformRange(clip, BPM, QUARTER_PX);
    // The window ends 1.5 s (60 px) in.
    assertSpan(getWaveformSourceSpan(range, 50, 70), [2.75, 3]);
    assert.equal(getWaveformSourceSpan(range, 60, 80), null);
    assert.equal(
      getWaveformSourceSpan({ ...range, windowStartSeconds: 2 }, 0, 10),
      null,
    );
  });

  it("maps a warped clip through its warp markers", () => {
    // The source plays at half speed: two beats per source second.
    const warp = createClipWarp(
      [
        { beatTime: 0, secTime: 0 },
        { beatTime: 8, secTime: 2 },
      ],
      0,
      1.5,
      BPM,
    );
    assert.ok(warp);
    const range = getClipWaveformRange(
      { ...clip, sourceWindowEndSeconds: 10, warp },
      BPM,
      QUARTER_PX,
    );
    const expectedStart = warpSourceTime(warp, 1.5, BPM).seconds;
    const expectedEnd = warpSourceTime(warp, 2.5, BPM).seconds;
    assertSpan(getWaveformSourceSpan(range, 0, 40), [
      expectedStart,
      expectedEnd,
    ]);
    // One song second covers half a source second.
    assert.ok(Math.abs(expectedEnd - expectedStart - 0.5) < 1e-9);
  });
});

describe("getSourceSpanWaveformRange", () => {
  it("plays from the span's in-point for its duration", () => {
    const range = getSourceSpanWaveformRange(
      { trimStartSeconds: 0.25, durationSeconds: 1 },
      BPM,
      QUARTER_PX,
    );
    assertSpan(getWaveformSourceSpan(range, 0, 10), [0.25, 0.5]);
    assertSpan(getWaveformSourceSpan(range, 30, 50), [1, 1.25]);
    assert.equal(getWaveformSourceSpan(range, 40, 50), null);
  });
});

describe("getWaveformSourceSpan", () => {
  it("draws nothing before the source start", () => {
    const range = { startSeconds: -1, secondsPerPx: SECONDS_PER_PX };
    assert.equal(getWaveformSourceSpan(range, 0, 40), null);
    assertSpan(getWaveformSourceSpan(range, 20, 60), [0, 0.5]);
  });

  it("draws nothing at an unusable scale", () => {
    assert.equal(
      getWaveformSourceSpan({ startSeconds: 0, secondsPerPx: 0 }, 0, 1),
      null,
    );
    assert.equal(
      getWaveformSourceSpan(
        { startSeconds: 0, secondsPerPx: Number.POSITIVE_INFINITY },
        0,
        1,
      ),
      null,
    );
  });
});

describe("getVisibleClipSlice", () => {
  it("clips a long clip to the visible range", () => {
    assert.deepEqual(getVisibleClipSlice(100, 1000, 300, 200), {
      startPx: 200,
      widthPx: 200,
    });
  });

  it("keeps a clip that fits in full", () => {
    assert.deepEqual(getVisibleClipSlice(100, 50, 0, 400), {
      startPx: 0,
      widthPx: 50,
    });
  });

  it("is empty for a clip off screen", () => {
    assert.equal(getVisibleClipSlice(500, 50, 0, 400), null);
    assert.equal(getVisibleClipSlice(0, 50, 100, 400), null);
  });
});

describe("loopWaveformSourceSpan", () => {
  it("leaves a span before the media's end, or of unknown media, alone", () => {
    assert.deepEqual(loopWaveformSourceSpan([1, 1.5], 2), [[1, 1.5]]);
    assert.deepEqual(loopWaveformSourceSpan([3, 3.5], 0), [[3, 3.5]]);
  });

  it("draws the media again from its start past its end", () => {
    assert.deepEqual(loopWaveformSourceSpan([5, 5.5], 2), [[1, 1.5]]);
  });

  it("splits a span across the point where the media loops", () => {
    assert.deepEqual(loopWaveformSourceSpan([3.5, 4.5], 2), [
      [1.5, 2],
      [0, 0.5],
    ]);
  });

  it("covers the whole media for a span longer than it", () => {
    assert.deepEqual(loopWaveformSourceSpan([1, 4], 2), [[0, 2]]);
  });
});

describe("getMediaLoopMarkersPx", () => {
  function assertMarkers(actual: number[], expected: number[]) {
    assert.equal(actual.length, expected.length, `got [${actual}]`);
    actual.forEach((value, index) => {
      assert.ok(
        Math.abs(value - expected[index]) < 1e-6,
        `expected [${expected}], got [${actual}]`,
      );
    });
  }

  it("marks each point where the media loops back to its start", () => {
    // 2 s of media under a 5 s span from 0.5 s: it loops at 2 s and 4 s.
    const range = getSourceSpanWaveformRange(
      { trimStartSeconds: 0.5, durationSeconds: 5 },
      BPM,
      QUARTER_PX,
      2,
    );
    assertMarkers(getMediaLoopMarkersPx(range, 0, 200), [60, 140]);
    // Only the visible pixels are marked.
    assertMarkers(getMediaLoopMarkersPx(range, 100, 200), [140]);
  });

  it("marks a clip by its song time and source offset", () => {
    const range = getClipWaveformRange(
      {
        startQ: 4,
        sourceOffsetSeconds: -2,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: 3,
      },
      BPM,
      QUARTER_PX,
      1.25,
    );
    // Plays 0-3 s of the media: loops at 1.25 s and 2.5 s.
    assertMarkers(getMediaLoopMarkersPx(range, 0, 120), [50, 100]);
  });

  it("marks a warped clip where its warped source time loops", () => {
    // Half speed: linear second 2 plays source second 1.
    const warp: ClipWarp = {
      markers: [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 1 },
      ],
      contentStartBeat: 0,
      anchorSeconds: 0,
    };
    const range = getSourceSpanWaveformRange(
      { trimStartSeconds: 0, durationSeconds: 10, warp },
      BPM,
      QUARTER_PX,
      1.5,
    );
    // 1.5 s of media loops at linear 3 s, 6 s and 9 s.
    assertMarkers(getMediaLoopMarkersPx(range, 0, 400), [120, 240, 360]);
  });

  it("marks nothing for unknown media, or loops too close together", () => {
    const span = { trimStartSeconds: 0, durationSeconds: 10 };
    assert.deepEqual(
      getMediaLoopMarkersPx(
        getSourceSpanWaveformRange(span, BPM, QUARTER_PX, 0),
        0,
        400,
      ),
      [],
    );
    assert.deepEqual(
      getMediaLoopMarkersPx(
        getSourceSpanWaveformRange(span, BPM, QUARTER_PX, 0.01),
        0,
        400,
      ),
      [],
    );
  });

  it("marks nothing at a clip's edges", () => {
    // Exactly two loops of 2 s of media.
    const range = getSourceSpanWaveformRange(
      { trimStartSeconds: 2, durationSeconds: 4 },
      BPM,
      QUARTER_PX,
      2,
    );
    assertMarkers(getMediaLoopMarkersPx(range, 0, 160), [80]);
  });
});
