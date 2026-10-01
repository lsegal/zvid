import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceSpan } from "./app/types.ts";
import type { MediaItem } from "./media";
import {
  editSourceClipField,
  getKnownMediaDurationSeconds,
  getSourceClipLimits,
  getSourceClipPanelTitle,
  getSourceClipValues,
} from "./source-clip-properties.ts";

// At 120 BPM a quarter lasts half a second, and at 30 fps a frame lasts
// 1/15 of a quarter.
const BPM = 120;
const FPS = 30;
const FRAME_Q = 1 / 15;

function span(
  id: string,
  startQ: number,
  durationQ: number,
  { trackId = "t1", trimStartSeconds = 2 } = {},
): SourceSpan {
  return {
    id,
    sourceTrackId: trackId,
    label: `Span ${id}`,
    mediaPath: "m1.mp4",
    mediaId: "m1",
    startQ,
    durationSeconds: durationQ / 2,
    trimStartSeconds,
    tint: "#111",
    accent: "#222",
  };
}

function media(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "m1",
    durationSeconds: 10,
    availability: "ready",
    ...overrides,
  } as MediaItem;
}

const limitsFor = (item: SourceSpan, mediaDurationSeconds: number) =>
  getSourceClipLimits(item, {
    bpm: BPM,
    fps: FPS,
    timelineLengthQ: 64,
    mediaDurationSeconds,
  });

describe("getSourceClipValues", () => {
  it("reads Start, Length and Offset in quarter notes", () => {
    assert.deepEqual(getSourceClipValues(span("a", 4, 6), BPM), {
      start: 4,
      length: 6,
      offset: 4,
    });
  });
});

describe("getSourceClipLimits", () => {
  it("limits Length and Offset to the media's length", () => {
    // 10 s of media is 20 quarters; the clip plays 3 s (6 q) from 2 s (4 q).
    const limits = limitsFor(span("a", 4, 6), 10);

    assert.deepEqual(limits.start, { min: 0, max: 64 });
    assert.equal(limits.length.min, FRAME_Q);
    assert.equal(limits.length.max, 16);
    assert.deepEqual(limits.offset, { min: 0, max: 14 });
  });

  it("keeps Start's current value reachable past the timeline's end", () => {
    assert.equal(limitsFor(span("a", 80, 2), 10).start.max, 80);
  });

  it("falls back to the current values while the media's length is unknown", () => {
    const limits = limitsFor(span("a", 4, 6), 0);

    assert.equal(limits.length.max, 6);
    assert.deepEqual(limits.offset, { min: 0, max: 4 });
  });

  it("never lets a range end before it starts", () => {
    // A clip already playing past the end of shorter media.
    const limits = limitsFor(span("a", 0, 30, { trimStartSeconds: 4 }), 10);

    assert.equal(limits.length.max, 12);
    assert.deepEqual(limits.offset, { min: 0, max: 0 });
    assert.equal(
      limitsFor(span("a", 0, 6, { trimStartSeconds: 10 }), 10).length.max,
      FRAME_Q,
    );
  });
});

describe("getKnownMediaDurationSeconds", () => {
  it("is the length of ready media", () => {
    assert.equal(getKnownMediaDurationSeconds(media()), 10);
  });

  it("is 0 for offline, loading, unknown-length or missing media", () => {
    assert.equal(
      getKnownMediaDurationSeconds(media({ availability: "offline" })),
      0,
    );
    assert.equal(
      getKnownMediaDurationSeconds(media({ availability: "hydrating" })),
      0,
    );
    assert.equal(
      getKnownMediaDurationSeconds(media({ durationSeconds: 0 })),
      0,
    );
    assert.equal(getKnownMediaDurationSeconds(undefined), 0);
  });
});

describe("editSourceClipField", () => {
  // [id, track, start, end] in quarters.
  const layout = (spans: readonly SourceSpan[]) =>
    spans.map((item) => [
      item.id,
      item.sourceTrackId,
      item.startQ,
      item.startQ + item.durationSeconds * 2,
    ]);

  it("moves Start onto a neighbor in the same track like a drag would", () => {
    const spans = [
      span("a", 0, 4),
      span("b", 8, 8),
      span("c", 8, 8, { trackId: "t2" }),
    ];

    assert.deepEqual(layout(editSourceClipField(spans, "a", "start", 6, BPM)), [
      ["a", "t1", 6, 10],
      ["b", "t1", 10, 16],
      ["c", "t2", 8, 16],
    ]);
  });

  it("trims a neighbor when Length grows over it", () => {
    const spans = [span("a", 0, 4), span("b", 8, 8)];

    assert.deepEqual(
      layout(editSourceClipField(spans, "a", "length", 10, BPM)),
      [
        ["a", "t1", 0, 10],
        ["b", "t1", 10, 16],
      ],
    );
  });

  it("changes Offset without moving the clip or its neighbors", () => {
    const spans = [span("a", 0, 4), span("b", 4, 4)];
    const edited = editSourceClipField(spans, "a", "offset", 1, BPM);

    assert.deepEqual(layout(edited), layout(spans));
    assert.equal(edited[0]?.trimStartSeconds, 0.5);
    assert.equal(edited[1], spans[1]);
  });

  it("returns the same spans when nothing changes", () => {
    const spans = [span("a", 0, 4)];

    assert.equal(editSourceClipField(spans, "a", "start", 0, BPM), spans);
    assert.equal(editSourceClipField(spans, "missing", "start", 2, BPM), spans);
  });
});

describe("getSourceClipPanelTitle", () => {
  it("names the clip and its track", () => {
    assert.equal(
      getSourceClipPanelTitle("Intro", "Camera A"),
      "Source Clip Properties: Intro (Camera A)",
    );
    assert.equal(
      getSourceClipPanelTitle("  ", undefined),
      "Source Clip Properties: Untitled",
    );
  });
});
