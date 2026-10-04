import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseSourceSpanForWindow,
  findClipAtPlayhead,
  findSourceTrackIdAt,
  getClipEndQ,
  getDropStartQ,
  getPlaybackStopQ,
  getSelectionEndQ,
  getSourceTrackEndQ,
  getTimelineContentEndQ,
  getTimelinePointerX,
  isClipAtPlayhead,
  pointerToTimelineQ,
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

// A timeline scroller at client x 50 with a 1px border.
const timelineScroll = {
  getBoundingClientRect: () => ({ left: 50 }) as DOMRect,
  clientLeft: 1,
};

describe("getTimelinePointerX", () => {
  it("measures inside the scroller's border and the content's left border", () => {
    // The scroller's border and the content's border are 2px.
    assert.equal(getTimelinePointerX(timelineScroll, 252), 200);
  });

  it("puts 0 quarters where clips start", () => {
    // Clips start 2px past the scroller's edge plus the 200px label column.
    assert.equal(
      pointerToTimelineQ(getTimelinePointerX(timelineScroll, 252), 0, 200, 40),
      0,
    );
    assert.equal(
      pointerToTimelineQ(getTimelinePointerX(timelineScroll, 262), 0, 200, 40),
      0.25,
    );
  });
});

// A 200px label column, 40px per quarter.
describe("pointerToTimelineQ", () => {
  it("measures from the timeline's start past the label column", () => {
    assert.equal(pointerToTimelineQ(200, 0, 200, 40), 0);
    assert.equal(pointerToTimelineQ(360, 0, 200, 40), 4);
  });

  it("adds the horizontal scroll", () => {
    assert.equal(pointerToTimelineQ(360, 400, 200, 40), 14);
  });

  it("scales with the zoom", () => {
    assert.equal(pointerToTimelineQ(360, 400, 200, 80), 7);
  });

  it("is negative left of the timeline's start", () => {
    assert.equal(pointerToTimelineQ(120, 0, 200, 40), -2);
  });
});

describe("getDropStartQ", () => {
  it("snaps the pointer position like a clip move", () => {
    assert.equal(getDropStartQ(370, 0, 200, 40, 1, true), 4);
    assert.equal(getDropStartQ(370, 0, 200, 40, 1, false), 4.25);
  });

  it("follows the scroll and zoom", () => {
    assert.equal(getDropStartQ(370, 400, 200, 80, 0.5, true), 7);
  });

  it("never starts before 0", () => {
    assert.equal(getDropStartQ(205, 0, 200, 40, 4, true), 0);
    assert.equal(getDropStartQ(195, 0, 200, 40, 4, false), 0);
  });

  it("starts at 0 over the label column, whatever the scroll", () => {
    assert.equal(getDropStartQ(120, 4000, 200, 40, 1, true), 0);
    assert.equal(getDropStartQ(0, 4000, 200, 40, 1, false), 0);
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

  it("extends the timeline to the latest clip or span", () => {
    assert.equal(getTimelineContentEndQ([], [], 120, 4), 4);
    assert.equal(
      getTimelineContentEndQ([clip({ startQ: 8 })], [span()], 120, 4),
      12,
    );
    // An audio-only source clip, such as an old session's main audio, sets
    // the length too.
    assert.equal(
      getTimelineContentEndQ([], [span({ durationSeconds: 10 })], 120, 4),
      20,
    );
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

describe("findSourceTrackIdAt", () => {
  // Two rows with a 2px gap between them.
  const rows = [
    { id: "a", top: 100, bottom: 140 },
    { id: "b", top: 142, bottom: 182 },
  ];

  it("picks the row under the pointer", () => {
    assert.equal(findSourceTrackIdAt(rows, 120, "a"), "a");
    assert.equal(findSourceTrackIdAt(rows, 160, "a"), "b");
  });

  it("picks the closest row between rows", () => {
    assert.equal(findSourceTrackIdAt(rows, 141.5, "a"), "b");
    assert.equal(findSourceTrackIdAt(rows, 140.5, "b"), "a");
  });

  it("keeps the fallback outside the rows", () => {
    assert.equal(findSourceTrackIdAt(rows, 50, "b"), "b");
    assert.equal(findSourceTrackIdAt(rows, 300, "a"), "a");
    assert.equal(findSourceTrackIdAt([], 120, "a"), "a");
  });
});
