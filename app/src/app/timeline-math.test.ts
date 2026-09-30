import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseSourceSpanForWindow,
  findClipAtPlayhead,
  getClipEndQ,
  getPlaybackStopQ,
  getSelectionEndQ,
  getSourceTrackEndQ,
  getTimelineContentEndQ,
  isClipAtPlayhead,
  quartersToSeconds,
  secondsToQuarters,
  snapQuarterValue,
} from "./timeline-math.ts";
import type { ArrangementClip, SourceSpan } from "./types.ts";

const clip = (extra: Partial<ArrangementClip> = {}): ArrangementClip => ({
  id: "clip",
  sourceSpanId: "span",
  sourceTrackId: "track",
  laneId: "1",
  label: "Clip",
  mediaPath: "clip.mp4",
  mediaId: "media",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 2,
  tint: "#000",
  accent: "#fff",
  ...extra,
});

const span = (extra: Partial<SourceSpan> = {}): SourceSpan => ({
  id: "span",
  sourceTrackId: "track",
  label: "Span",
  mediaPath: "span.mp4",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  tint: "#000",
  accent: "#fff",
  ...extra,
});

describe("quarter and second conversion", () => {
  it("converts at the given tempo", () => {
    assert.equal(quartersToSeconds(4, 120), 2);
    assert.equal(secondsToQuarters(2, 120), 4);
  });
});

describe("snapQuarterValue", () => {
  it("rounds to the snap unit only when snapping is on", () => {
    assert.equal(snapQuarterValue(1.3, 0.5, true), 1.5);
    assert.equal(snapQuarterValue(1.3, 0.5, false), 1.3);
  });
});

describe("clip extents", () => {
  it("measures clip, selection and source track ends in quarters", () => {
    assert.equal(getClipEndQ(clip({ startQ: 2 }), 120), 6);
    assert.equal(
      getSelectionEndQ({ id: "s", laneId: "1", startQ: 1, durationQ: 3 }),
      4,
    );
    assert.equal(
      getSourceTrackEndQ(
        [span(), span({ id: "b", startQ: 8 }), span({ sourceTrackId: "x" })],
        "track",
        120,
      ),
      12,
    );
  });

  it("extends the timeline to the latest clip, span or main audio", () => {
    assert.equal(getTimelineContentEndQ([], [], undefined, 120, 4), 4);
    assert.equal(
      getTimelineContentEndQ([clip({ startQ: 8 })], [span()], 1, 120, 4),
      12,
    );
    assert.equal(getTimelineContentEndQ([], [], 10, 120, 4), 20);
  });
});

describe("clips at the playhead", () => {
  it("includes the clip start and excludes its end", () => {
    assert.equal(isClipAtPlayhead(clip({ startQ: 2 }), 2, 120), true);
    assert.equal(isClipAtPlayhead(clip({ startQ: 2 }), 6, 120), false);
  });

  it("prefers the highest-priority lane, then the later start", () => {
    const low = clip({ id: "low", laneId: "1" });
    const high = clip({ id: "high", laneId: "2" });
    const later = clip({ id: "later", laneId: "2", startQ: 1 });
    const priority = new Map([
      ["1", 0],
      ["2", 1],
    ]);
    assert.equal(
      findClipAtPlayhead([low, high, later], 2, 120, priority)?.id,
      "later",
    );
    assert.equal(findClipAtPlayhead([low], 10, 120, priority), undefined);
  });
});

describe("getPlaybackStopQ", () => {
  it("stops at the end of the last playable clip after the start", () => {
    const clips = [
      clip({ startQ: 0 }),
      clip({ id: "offline", startQ: 8, mediaId: "missing" }),
    ];
    const media = [{ id: "media" }] as Parameters<typeof getPlaybackStopQ>[1];
    assert.equal(getPlaybackStopQ(clips, media, 1, 120), 4);
    assert.equal(getPlaybackStopQ(clips, media, 5, 120), 5);
  });
});

describe("chooseSourceSpanForWindow", () => {
  it("picks the span the window starts in, else the most overlapping", () => {
    const first = span({ id: "first", startQ: 0 });
    const second = span({ id: "second", startQ: 8 });
    assert.equal(
      chooseSourceSpanForWindow([first, second], "track", 9, 1, 120)?.id,
      "second",
    );
    assert.equal(
      chooseSourceSpanForWindow([first, second], "track", 5, 4, 120)?.id,
      "second",
    );
    assert.equal(
      chooseSourceSpanForWindow([first], "other", 0, 1, 120),
      undefined,
    );
  });
});
