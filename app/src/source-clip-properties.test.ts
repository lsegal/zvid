import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceSpan } from "./app/types.ts";
import type { MediaItem } from "./media";
import {
  editSourceClipField,
  getKnownMediaDurationSeconds,
  getSourceClipLimits,
  getSourceClipValues,
  isSourceClipMediaOffline,
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
  it("limits Offset to the media's length and lets Length run past it", () => {
    // 10 s of media is 20 quarters; the clip plays 3 s (6 q) from 2 s (4 q).
    const limits = limitsFor(span("a", 4, 6), 10);

    assert.deepEqual(limits.start, { min: 0, max: 64 });
    assert.deepEqual(limits.length, {
      min: FRAME_Q,
      max: Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(limits.offset, { min: 0, max: 20 });
  });

  it("keeps Start's current value reachable past the timeline's end", () => {
    assert.equal(limitsFor(span("a", 80, 2), 10).start.max, 80);
  });

  it("falls back to the current Offset while the media's length is unknown", () => {
    const limits = limitsFor(span("a", 4, 6), 0);

    assert.equal(limits.length.max, Number.POSITIVE_INFINITY);
    assert.deepEqual(limits.offset, { min: 0, max: 4 });
  });

  it("keeps Offset's current value reachable past the media's end", () => {
    // Playing from 12 s (24 q) of 10 s of media.
    const limits = limitsFor(span("a", 0, 6, { trimStartSeconds: 12 }), 10);

    assert.deepEqual(limits.offset, { min: 0, max: 24 });
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

describe("isSourceClipMediaOffline", () => {
  it("is false for ready media, even before its length is known", () => {
    assert.equal(isSourceClipMediaOffline(span("a", 0, 4), media()), false);
    assert.equal(
      isSourceClipMediaOffline(span("a", 0, 4), media({ durationSeconds: 0 })),
      false,
    );
  });

  it("is false while the media is still loading", () => {
    assert.equal(
      isSourceClipMediaOffline(
        span("a", 0, 4),
        media({ availability: "hydrating" }),
      ),
      false,
    );
  });

  it("is true for offline or missing media", () => {
    assert.equal(
      isSourceClipMediaOffline(
        span("a", 0, 4),
        media({ availability: "offline" }),
      ),
      true,
    );
    assert.equal(isSourceClipMediaOffline(span("a", 0, 4), undefined), true);
  });

  it("is false for a placeholder clip with no media file", () => {
    const placeholder = {
      ...span("a", 0, 4),
      mediaId: undefined,
      mediaPath: "",
    };
    assert.equal(isSourceClipMediaOffline(placeholder, undefined), false);
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
