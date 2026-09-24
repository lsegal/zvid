import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  beatsToFrames,
  createTempoMap,
  createWarpMap,
  secondsToFrames,
  unrollClipLoop,
} from "./time.ts";

// Numbers from the dogfood3.als / dogfood3.lvp fixture.
const FIXTURE_BPM = 126.404495;
const FPS = 30;

function assertClose(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("createTempoMap", () => {
  it("converts at a constant tempo", () => {
    const map = createTempoMap([{ beat: 0, bpm: 120 }], 90);
    assert.equal(map.beatsToSeconds(0), 0);
    assert.equal(map.beatsToSeconds(8), 4);
    assert.equal(map.secondsToBeats(4), 8);
    assert.equal(map.beatsToSeconds(-2), -1);
  });

  it("anchors beat 0 at 0 seconds for Live's far-away constant tempo point", () => {
    const map = createTempoMap([{ beat: -63072000, bpm: FIXTURE_BPM }], 120);
    assertClose(map.beatsToSeconds(0), 0);
    assertClose(map.beatsToSeconds(22.25), (22.25 * 60) / FIXTURE_BPM);
    assertClose(map.secondsToBeats((22.25 * 60) / FIXTURE_BPM), 22.25);
  });

  it("falls back to the given tempo without automation", () => {
    const map = createTempoMap([], 60);
    assert.equal(map.beatsToSeconds(3), 3);
    assert.equal(map.secondsToBeats(3), 3);
    assert.throws(() => createTempoMap([], 0), RangeError);
  });

  it("integrates a linear BPM ramp", () => {
    // 60 → 120 BPM over 4 beats: ∫ 60 / (60 + 15b) db = 4 ln 2.
    const map = createTempoMap(
      [
        { beat: 0, bpm: 60 },
        { beat: 4, bpm: 120 },
      ],
      100,
    );
    assertClose(map.beatsToSeconds(4), 4 * Math.log(2));
    assertClose(map.beatsToSeconds(2), 4 * Math.log(1.5));
    assertClose(map.secondsToBeats(4 * Math.log(1.5)), 2);
    // The last tempo holds past the ramp, the first one before it.
    assertClose(map.beatsToSeconds(6), 4 * Math.log(2) + 1);
    assertClose(map.beatsToSeconds(-1), -1);
    assertClose(map.secondsToBeats(-1), -1);
  });

  it("follows multi-point automation", () => {
    const map = createTempoMap(
      [
        { beat: 8, bpm: 60 },
        { beat: -63072000, bpm: 120 },
        { beat: 4, bpm: 120 },
        { beat: 8, bpm: 90 },
        { beat: 12, bpm: 90 },
      ],
      100,
    );
    // Constant 120 up to beat 4, a 120 → 60 ramp to beat 8, a jump to 90.
    const ramp = (60 / -15) * Math.log(60 / 120);
    assertClose(map.beatsToSeconds(4), 2);
    assertClose(map.beatsToSeconds(8), 2 + ramp);
    assertClose(map.beatsToSeconds(16), 2 + ramp + (8 * 60) / 90);
    for (const beat of [-3, 0, 1, 4, 5.5, 8, 9, 12, 20]) {
      assertClose(map.secondsToBeats(map.beatsToSeconds(beat)), beat);
    }
  });

  it("measures time from beat 0 when automation starts after it", () => {
    const map = createTempoMap(
      [
        { beat: 4, bpm: 60 },
        { beat: 8, bpm: 120 },
      ],
      100,
    );
    assert.equal(map.beatsToSeconds(0), 0);
    assert.equal(map.beatsToSeconds(4), 4);
    assertClose(map.beatsToSeconds(8), 4 + 4 * Math.log(2));
  });
});

describe("createWarpMap", () => {
  const fixtureMarkers = [
    { secTime: 0, beatTime: 0 },
    { secTime: 0.014833, beatTime: 0.03125 },
  ];

  it("extrapolates past the last marker with the last segment's slope", () => {
    const map = createWarpMap(fixtureMarkers, true);
    const secondsPerBeat = 0.014833 / 0.03125;
    assertClose(secondsPerBeat, 60 / 126.4, 1e-4);
    assertClose(map.beatToSampleSec(22), 22 * secondsPerBeat);
    assertClose(map.sampleSecToBeat(22 * secondsPerBeat), 22);
  });

  it("interpolates between markers and extrapolates before the first", () => {
    const map = createWarpMap(
      [
        { secTime: 1, beatTime: 0 },
        { secTime: 2, beatTime: 2 },
        { secTime: 4, beatTime: 3 },
      ],
      true,
    );
    assert.equal(map.beatToSampleSec(1), 1.5);
    assert.equal(map.beatToSampleSec(2.5), 3);
    assert.equal(map.beatToSampleSec(-2), 0);
    assert.equal(map.beatToSampleSec(4), 6);
    assert.equal(map.sampleSecToBeat(3), 2.5);
    assert.equal(map.sampleSecToBeat(0), -2);
    assert.equal(map.sampleSecToBeat(6), 4);
  });

  it("needs two distinct markers when warped", () => {
    assert.throws(() => createWarpMap([], true), RangeError);
    assert.throws(
      () =>
        createWarpMap(
          [
            { secTime: 0, beatTime: 1 },
            { secTime: 2, beatTime: 1 },
          ],
          true,
        ),
      RangeError,
    );
  });

  it("maps unwarped content positions, already sample seconds, as-is", () => {
    const map = createWarpMap(fixtureMarkers, false);
    assert.equal(map.beatToSampleSec(3.5), 3.5);
    assert.equal(map.sampleSecToBeat(3.5), 3.5);
  });
});

describe("unrollClipLoop", () => {
  const base: ArrangementClip = {
    currentStart: 16,
    currentEnd: 28,
    loopOn: true,
    loopStart: 0,
    loopEnd: 4,
    startRelative: 0,
    hiddenLoopStart: 0,
    hiddenLoopEnd: 4,
  };

  it("plays a non-looping clip straight from the start marker", () => {
    const unrolled = unrollClipLoop({
      ...base,
      loopOn: false,
      loopStart: 22,
      loopEnd: 44.25,
      startRelative: 1,
      hiddenLoopEnd: 44,
    });
    assert.deepEqual(unrolled, {
      segments: [{ arrStartBeat: 16, arrEndBeat: 28, contentStartBeat: 22 }],
      hiddenLoopStart: 0,
      hiddenLoopEnd: 44,
    });
  });

  it("splits an exact multiple of the loop into whole passes", () => {
    assert.deepEqual(unrollClipLoop(base).segments, [
      { arrStartBeat: 16, arrEndBeat: 20, contentStartBeat: 0 },
      { arrStartBeat: 20, arrEndBeat: 24, contentStartBeat: 0 },
      { arrStartBeat: 24, arrEndBeat: 28, contentStartBeat: 0 },
    ]);
  });

  it("cuts the final pass short", () => {
    assert.deepEqual(unrollClipLoop({ ...base, currentEnd: 26.5 }).segments, [
      { arrStartBeat: 16, arrEndBeat: 20, contentStartBeat: 0 },
      { arrStartBeat: 20, arrEndBeat: 24, contentStartBeat: 0 },
      { arrStartBeat: 24, arrEndBeat: 26.5, contentStartBeat: 0 },
    ]);
  });

  it("starts the first pass at StartRelative", () => {
    assert.deepEqual(
      unrollClipLoop({ ...base, loopStart: 2, loopEnd: 6, startRelative: 3 })
        .segments,
      [
        { arrStartBeat: 16, arrEndBeat: 17, contentStartBeat: 5 },
        { arrStartBeat: 17, arrEndBeat: 21, contentStartBeat: 2 },
        { arrStartBeat: 21, arrEndBeat: 25, contentStartBeat: 2 },
        { arrStartBeat: 25, arrEndBeat: 28, contentStartBeat: 2 },
      ],
    );
  });

  it("wraps a StartRelative beyond the loop back into it", () => {
    assert.deepEqual(
      unrollClipLoop({ ...base, currentEnd: 20, startRelative: 5 }).segments,
      [
        { arrStartBeat: 16, arrEndBeat: 19, contentStartBeat: 1 },
        { arrStartBeat: 19, arrEndBeat: 20, contentStartBeat: 0 },
      ],
    );
  });

  it("emits nothing for an empty clip", () => {
    assert.deepEqual(unrollClipLoop({ ...base, currentEnd: 16 }).segments, []);
  });

  it("advances an unwarped clip's content in seconds", () => {
    // At 120 BPM a 1-second loop covers 2 arrangement beats.
    const tempoMap = createTempoMap([{ beat: 0, bpm: 120 }], 120);
    const clip = { ...base, currentStart: 0, currentEnd: 5, loopEnd: 1 };
    assert.deepEqual(
      unrollClipLoop(clip, { isWarped: false, tempoMap }).segments,
      [
        { arrStartBeat: 0, arrEndBeat: 2, contentStartBeat: 0 },
        { arrStartBeat: 2, arrEndBeat: 4, contentStartBeat: 0 },
        { arrStartBeat: 4, arrEndBeat: 5, contentStartBeat: 0 },
      ],
    );
    assert.throws(() => unrollClipLoop(clip, { isWarped: false }), TypeError);
  });

  it("follows tempo changes for an unwarped clip", () => {
    // 60 BPM until beat 2, then 120 BPM: a 2-second loop covers beats 0–2,
    // then beats 2–6.
    const tempoMap = createTempoMap(
      [
        { beat: 0, bpm: 60 },
        { beat: 2, bpm: 60 },
        { beat: 2, bpm: 120 },
      ],
      120,
    );
    const segments = unrollClipLoop(
      { ...base, currentStart: 0, currentEnd: 6, loopEnd: 2 },
      { isWarped: false, tempoMap },
    ).segments;
    assert.equal(segments.length, 2);
    assertClose(segments[0].arrEndBeat, 2);
    assertClose(segments[1].arrStartBeat, 2);
    assert.equal(segments[1].arrEndBeat, 6);
  });
});

describe("beatsToFrames", () => {
  const tempoMap = createTempoMap([{ beat: -63072000, bpm: FIXTURE_BPM }], 120);

  it("matches the dogfood3 fixture frame values", () => {
    // projectDuration / frameCount
    assert.equal(beatsToFrames(22.25, tempoMap, FPS), 317);
    // HiddenLoopEnd → frameHiddenLoopEnd
    assert.equal(beatsToFrames(143.4494, tempoMap, FPS), 2043);
    assert.equal(beatsToFrames(52.0337, tempoMap, FPS), 741);
    assert.equal(beatsToFrames(44, tempoMap, FPS), 627);
  });

  it("rounds exact halves up", () => {
    const map = createTempoMap([{ beat: 0, bpm: 60 }], 60);
    assert.equal(beatsToFrames(0.5, map, 1), 1);
    assert.equal(secondsToFrames(0.5, 1), 1);
    assert.equal(secondsToFrames(-0.5, 1), -0);
  });
});
