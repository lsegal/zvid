import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRandomArrangement,
  type RandomArrangementWindow,
  sourceSpanCovering,
  sourceTrackHasFootage,
} from "./random-arrangement.ts";

type Span = {
  id: string;
  sourceTrackId: string;
  startQ: number;
  endQ: number;
};

const EPSILON = 0.0001;
// The reference set runs at 30 fps and 72 BPM: 0.04 quarters per frame.
const frames = (frame: number) => frame * 0.04;

const span = (
  id: string,
  sourceTrackId: string,
  startFrame: number,
  endFrame: number,
): Span => ({
  id,
  sourceTrackId,
  startQ: frames(startFrame),
  endQ: frames(endFrame),
});

// Source clips shaped like the reference set's, 12 bars long.
const referenceSpans = [
  span("a", "a", 0, 400),
  span("b", "b", 375, 475),
  span("c", "c", 400, 775),
  span("d", "d", 400, 800),
  span("e", "e", 800, 1200),
  span("f", "f", 975, 1115),
  span("g", "g", 0, 375),
  // Only has footage late in the song.
  span("late", "late", 1000, 1200),
];

const trackIds = (spans: readonly Span[]) => [
  ...new Set(spans.map((entry) => entry.sourceTrackId)),
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function arrange(spans: readonly Span[], seed: number, timelineEndQ = 48) {
  return buildRandomArrangement({
    laneIds: ["1", "2", "3"],
    sourceTrackIds: trackIds(spans),
    spans,
    spanEndQ: (entry) => entry.endQ,
    timelineEndQ,
    stepQ: 1,
    durationSteps: [1, 2, 3, 4, 5, 6, 7, 8],
    random: seededRandom(seed),
  });
}

function baseLane(windows: readonly RandomArrangementWindow<Span>[]) {
  return windows
    .filter((window) => window.laneId === "1")
    .sort((left, right) => left.startQ - right.startQ);
}

describe("sourceSpanCovering", () => {
  const endQ = (entry: Span) => entry.endQ;

  it("returns the span that contains the start on that track", () => {
    assert.equal(
      sourceSpanCovering(referenceSpans, endQ, "c", frames(500))?.id,
      "c",
    );
  });

  it("returns nothing when the track has no clip at that time", () => {
    assert.equal(
      sourceSpanCovering(referenceSpans, endQ, "late", frames(100)),
      undefined,
    );
    assert.equal(
      sourceSpanCovering(referenceSpans, endQ, "a", frames(400)),
      undefined,
    );
  });
});

describe("buildRandomArrangement", () => {
  it("keeps every window inside a clip on its own source track", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const windows = arrange(referenceSpans, seed);
      assert.ok(windows.length > 0);
      for (const window of windows) {
        const covering = referenceSpans.filter(
          (entry) =>
            entry.sourceTrackId === window.span.sourceTrackId &&
            window.startQ >= entry.startQ - EPSILON &&
            window.startQ + window.durationQ <= entry.endQ + EPSILON,
        );
        assert.ok(
          covering.length > 0,
          `seed ${seed}: window at ${window.startQ} on ${window.span.sourceTrackId} runs outside its clips`,
        );
        assert.ok(window.durationQ > 0);
      }
    }
  });

  it("never picks a track before it has any footage", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const window of arrange(referenceSpans, seed)) {
        if (window.span.sourceTrackId === "late") {
          assert.ok(window.startQ >= frames(1000) - EPSILON);
        }
      }
    }
  });

  it("fills the first layer without gaps where footage exists", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let cursorQ = 0;
      for (const window of baseLane(arrange(referenceSpans, seed))) {
        assert.ok(Math.abs(window.startQ - cursorQ) < EPSILON);
        cursorQ = window.startQ + window.durationQ;
      }
      assert.ok(Math.abs(cursorQ - 48) < EPSILON, `seed ${seed}`);
    }
  });

  it("leaves a first-layer gap only where no source has footage", () => {
    const spans = [span("a", "a", 0, 200), span("b", "b", 500, 1200)];
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = baseLane(arrange(spans, seed));
      const beforeGap = windows.filter((window) => window.startQ < frames(200));
      const afterGap = windows.filter((window) => window.startQ >= frames(200));
      const gapEndQ = beforeGap.at(-1);
      assert.ok(gapEndQ);
      assert.ok(
        Math.abs(gapEndQ.startQ + gapEndQ.durationQ - frames(200)) < EPSILON,
      );
      assert.ok(Math.abs((afterGap[0]?.startQ ?? -1) - frames(500)) < EPSILON);
      const last = windows.at(-1);
      assert.ok(last);
      assert.ok(Math.abs(last.startQ + last.durationQ - 48) < EPSILON);
    }
  });

  it("keeps upper layers sparser than the first", () => {
    let base = 0;
    let upper = 0;
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = arrange(referenceSpans, seed);
      base += windows.filter((window) => window.laneId === "1").length;
      upper += windows.filter((window) => window.laneId === "3").length;
    }
    assert.ok(upper < base);
  });

  it("does not overlap windows on the same layer", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const windows = arrange(referenceSpans, seed);
      for (const laneId of ["1", "2", "3"]) {
        const lane = windows
          .filter((window) => window.laneId === laneId)
          .sort((left, right) => left.startQ - right.startQ);
        for (let index = 1; index < lane.length; index += 1) {
          const previous = lane[index - 1];
          assert.ok(
            lane[index].startQ >=
              previous.startQ + previous.durationQ - EPSILON,
          );
        }
      }
    }
  });
});

describe("buildRandomArrangement with audio-only sources", () => {
  const isAudioOnly = (entry: Span) => entry.sourceTrackId.startsWith("audio");

  function arrangeWithAudio(spans: readonly Span[], seed: number) {
    return buildRandomArrangement({
      laneIds: ["1", "2", "3"],
      audioLaneId: "audio-lane",
      isAudioOnly,
      sourceTrackIds: trackIds(spans),
      spans,
      spanEndQ: (entry) => entry.endQ,
      timelineEndQ: 48,
      stepQ: 1,
      durationSteps: [1, 2, 3, 4, 5, 6, 7, 8],
      random: seededRandom(seed),
    });
  }

  function audioLane(windows: readonly RandomArrangementWindow<Span>[]) {
    return windows
      .filter((window) => window.laneId === "audio-lane")
      .sort((left, right) => left.startQ - right.startQ);
  }

  it("never puts an audio-only span on a video layer", () => {
    const spans = [
      ...referenceSpans,
      span("audio-a", "audio-a", 0, 600),
      span("audio-b", "audio-b", 600, 1200),
    ];
    for (let seed = 1; seed <= 100; seed += 1) {
      for (const window of arrangeWithAudio(spans, seed)) {
        assert.equal(
          isAudioOnly(window.span),
          window.laneId === "audio-lane",
          `seed ${seed}: ${window.span.id} on ${window.laneId}`,
        );
      }
    }
  });

  it("fills the audio layer without gaps when audio covers the timeline", () => {
    const spans = [
      ...referenceSpans,
      span("audio-a", "audio-a", 0, 600),
      span("audio-b", "audio-b", 500, 1200),
    ];
    for (let seed = 1; seed <= 100; seed += 1) {
      let cursorQ = 0;
      const windows = audioLane(arrangeWithAudio(spans, seed));
      assert.ok(windows.length > 1);
      for (const window of windows) {
        assert.ok(Math.abs(window.startQ - cursorQ) < EPSILON);
        cursorQ = window.startQ + window.durationQ;
      }
      assert.ok(Math.abs(cursorQ - 48) < EPSILON, `seed ${seed}`);
    }
  });

  it("uses one full-length audio span as a single uncut clip", () => {
    const spans = [
      ...referenceSpans,
      span("audio-short", "audio-short", 0, 300),
      span("audio-song", "audio-song", 0, 1500),
      span("audio-song-2", "audio-song-2", 0, 1500),
    ];
    for (let seed = 1; seed <= 20; seed += 1) {
      const windows = audioLane(arrangeWithAudio(spans, seed));
      assert.equal(windows.length, 1);
      assert.equal(windows[0].span.id, "audio-song");
      assert.equal(windows[0].startQ, 0);
      assert.equal(windows[0].durationQ, 48);
    }
  });

  it("leaves audio-layer gaps only where no audio source has sound", () => {
    const spans = [
      ...referenceSpans,
      span("audio-a", "audio-a", 0, 200),
      span("audio-b", "audio-b", 500, 1200),
    ];
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = audioLane(arrangeWithAudio(spans, seed));
      const beforeGap = windows.filter((window) => window.startQ < frames(200));
      const afterGap = windows.filter((window) => window.startQ >= frames(200));
      const lastBefore = beforeGap.at(-1);
      assert.ok(lastBefore);
      assert.ok(
        Math.abs(lastBefore.startQ + lastBefore.durationQ - frames(200)) <
          EPSILON,
      );
      assert.ok(Math.abs((afterGap[0]?.startQ ?? -1) - frames(500)) < EPSILON);
      const last = windows.at(-1);
      assert.ok(last);
      assert.ok(Math.abs(last.startQ + last.durationQ - 48) < EPSILON);
    }
  });

  it("leaves the audio layer empty with no audio sources", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const windows = arrangeWithAudio(referenceSpans, seed);
      assert.ok(windows.length > 0);
      assert.equal(audioLane(windows).length, 0);
    }
  });
});

describe("sourceTrackHasFootage", () => {
  const spans = [
    { id: "x", sourceTrackId: "a", startQ: 4, endQ: 8 },
    { id: "y", sourceTrackId: "b", startQ: 0, endQ: 2 },
  ];
  const endQ = (entry: { endQ: number }) => entry.endQ;

  it("is true when a clip on the track overlaps the range at all", () => {
    assert.equal(sourceTrackHasFootage(spans, endQ, "a", 2, 5), true);
    assert.equal(sourceTrackHasFootage(spans, endQ, "a", 7, 12), true);
    assert.equal(sourceTrackHasFootage(spans, endQ, "a", 0, 12), true);
  });

  it("is false when the track's clips only touch or miss the range", () => {
    assert.equal(sourceTrackHasFootage(spans, endQ, "a", 0, 4), false);
    assert.equal(sourceTrackHasFootage(spans, endQ, "a", 8, 10), false);
    assert.equal(sourceTrackHasFootage(spans, endQ, "b", 4, 6), false);
    assert.equal(sourceTrackHasFootage(spans, endQ, "c", 0, 12), false);
  });
});
