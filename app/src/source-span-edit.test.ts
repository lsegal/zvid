import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrangementClip, SourceSpan } from "./app/types.ts";
import type { ClipWarp } from "./clip-warp.ts";
import {
  dragSourceSpan,
  getDroppedSourceSpanStartQ,
  placeDroppedSourceSpans,
  relinkClipsToSourceSpans,
  resolveSourceSpanOverlaps,
  retimeSourceSpan,
  type SourceSpanDragLimits,
} from "./source-span-edit.ts";

// At 120 BPM a quarter lasts half a second, and at 30 fps a frame lasts
// 1/15 of a quarter.
const BPM = 120;
const FPS = 30;
const FRAME_Q = 1 / 15;

// A span from `startQ` for `durationQ` quarters, playing its media from
// `trimStartSeconds`.
function span(
  id: string,
  startQ: number,
  durationQ: number,
  {
    trackId = "t1",
    trimStartSeconds = 10,
    mediaId = "m1",
    warp = undefined as ClipWarp | undefined,
  } = {},
): SourceSpan {
  return {
    id,
    sourceTrackId: trackId,
    label: `Span ${id}`,
    mediaPath: `${mediaId}.mp4`,
    mediaId,
    startQ,
    durationSeconds: durationQ / 2,
    trimStartSeconds,
    ...(warp ? { warp } : {}),
    tint: "#111",
    accent: "#222",
  };
}

// [id, track, start, end, media start] for each span, in quarters and
// seconds.
const layout = (spans: readonly SourceSpan[]) =>
  spans.map((item) => [
    item.id,
    item.sourceTrackId,
    item.startQ,
    item.startQ + item.durationSeconds * 2,
    item.trimStartSeconds,
  ]);

// The media second a span plays at song position `q`.
const mediaAt = (item: SourceSpan, q: number) =>
  item.trimStartSeconds + (q - item.startQ) / 2;

const limits = (
  overrides: Partial<SourceSpanDragLimits> = {},
): SourceSpanDragLimits => ({
  bpm: BPM,
  fps: FPS,
  snapUnit: 1,
  snap: true,
  ...overrides,
});

const near = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be ${expected}`,
  );

describe("retimeSourceSpan", () => {
  it("keeps the content in place when either edge moves", () => {
    const original = span("a", 4, 8);
    const trimmed = retimeSourceSpan(original, 6, 4, BPM);
    assert.deepEqual(layout([trimmed]), [["a", "t1", 6, 10, 11]]);
    assert.equal(mediaAt(trimmed, 7), mediaAt(original, 7));
  });
});

describe("resolveSourceSpanOverlaps", () => {
  const place = (spans: SourceSpan[], active: SourceSpan) =>
    resolveSourceSpanOverlaps([...spans, active], active, BPM);

  it("trims a span the active one covers the start of, keeping its content in place", () => {
    const other = span("a", 2, 4);
    const placed = place([other], span("b", 0, 4, { trimStartSeconds: 30 }));
    assert.deepEqual(layout(placed), [
      ["a", "t1", 4, 6, 11],
      ["b", "t1", 0, 4, 30],
    ]);
    assert.equal(mediaAt(placed[0], 5), mediaAt(other, 5));
  });

  it("keeps the longer side of a span over both edges, as on a layer", () => {
    assert.deepEqual(
      layout(
        place([span("a", 0, 8)], span("b", 1, 2, { trimStartSeconds: 30 })),
      ),
      [
        ["a", "t1", 3, 8, 11.5],
        ["b", "t1", 1, 3, 30],
      ],
    );
  });

  it("removes a span the active one covers", () => {
    assert.deepEqual(layout(place([span("a", 2, 2)], span("b", 0, 8))), [
      ["b", "t1", 0, 8, 10],
    ]);
  });

  it("leaves spans in other source tracks and spans only touching it alone", () => {
    const others = [span("a", 0, 8, { trackId: "t2" }), span("c", 6, 2)];
    const active = span("b", 2, 4);
    assert.deepEqual(
      layout(place(others, active)),
      layout([...others, active]),
    );
  });
});

describe("dragSourceSpan", () => {
  const origin = span("a", 4, 8, { trimStartSeconds: 3 });

  it("moves a span with its content, snapped", () => {
    const moved = dragSourceSpan(origin, "move", 2.3, limits());
    assert.deepEqual(layout([moved]), [["a", "t1", 6, 14, 3]]);
  });

  it("moves freely when snapping is off", () => {
    const moved = dragSourceSpan(origin, "move", 2.3, limits({ snap: false }));
    near(moved.startQ, 6.3);
  });

  it("never moves a span before the start", () => {
    assert.equal(dragSourceSpan(origin, "move", -20, limits()).startQ, 0);
  });

  it("trims the start with the content in place", () => {
    const trimmed = dragSourceSpan(origin, "resize-start", 2, limits());
    assert.deepEqual(layout([trimmed]), [["a", "t1", 6, 12, 4]]);
    assert.equal(mediaAt(trimmed, 8), mediaAt(origin, 8));
  });

  it("extends the start no further back than the media's start", () => {
    // 3 s of media before the span is 6 quarters, so it can start at 0 but
    // not earlier.
    const extended = dragSourceSpan(origin, "resize-start", -10, limits());
    assert.deepEqual(layout([extended]), [["a", "t1", 0, 12, 1]]);
    const late = span("b", 10, 2, { trimStartSeconds: 1 });
    const earliest = dragSourceSpan(late, "resize-start", -10, limits());
    assert.deepEqual(layout([earliest]), [["b", "t1", 8, 12, 0]]);
  });

  it("keeps at least a frame when the start is trimmed past the end", () => {
    const trimmed = dragSourceSpan(origin, "resize-start", 20, limits());
    near(trimmed.startQ, 12 - FRAME_Q);
    near(trimmed.durationSeconds, 1 / FPS);
  });

  it("trims and extends the end, snapped", () => {
    assert.deepEqual(
      layout([dragSourceSpan(origin, "resize-end", -2.2, limits())]),
      [["a", "t1", 4, 10, 3]],
    );
    assert.deepEqual(
      layout([dragSourceSpan(origin, "resize-end", 3.8, limits())]),
      [["a", "t1", 4, 16, 3]],
    );
  });

  it("extends the end past the media's end, which loops it", () => {
    const extended = dragSourceSpan(origin, "resize-end", 40, limits());
    assert.deepEqual(layout([extended]), [["a", "t1", 4, 52, 3]]);
  });

  it("keeps at least a frame when the end is trimmed past the start", () => {
    const trimmed = dragSourceSpan(origin, "resize-end", -20, limits());
    assert.equal(trimmed.startQ, 4);
    near(trimmed.durationSeconds, 1 / FPS);
  });
});

describe("relinkClipsToSourceSpans", () => {
  // A window on `source` from `startQ` for `durationQ` quarters, as
  // committing a selection creates it.
  function windowClip(
    id: string,
    source: SourceSpan,
    startQ: number,
    durationQ: number,
  ): ArrangementClip {
    const sourceOffsetSeconds = source.trimStartSeconds - source.startQ / 2;
    return {
      id,
      sourceSpanId: source.id,
      sourceTrackId: source.sourceTrackId,
      laneId: "1",
      label: id,
      mediaPath: source.mediaPath,
      mediaId: source.mediaId,
      startQ,
      durationSeconds: durationQ / 2,
      trimStartSeconds: startQ / 2 + sourceOffsetSeconds,
      sourceOffsetSeconds,
      sourceWindowStartSeconds: source.trimStartSeconds,
      sourceWindowEndSeconds: source.trimStartSeconds + source.durationSeconds,
      tint: source.tint,
      accent: source.accent,
    };
  }

  // The media second `clip` plays at song position `q`.
  const clipMediaAt = (clip: ArrangementClip, q: number) =>
    q / 2 + clip.sourceOffsetSeconds;

  const warp = (anchorSeconds: number): ClipWarp => ({
    markers: [
      { beatTime: 0, secTime: 0 },
      { beatTime: 4, secTime: 3 },
    ],
    contentStartBeat: 0,
    anchorSeconds,
  });

  it("shows a moved span's content at the clip's position", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const moved = { ...original, startQ: 1 };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [moved],
      BPM,
    );
    assert.equal(relinked.sourceSpanId, "a");
    near(clipMediaAt(relinked, 2), mediaAt(moved, 2));
    near(relinked.trimStartSeconds, mediaAt(moved, 2));
    assert.equal(relinked.sourceWindowStartSeconds, 10);
    assert.equal(relinked.sourceWindowEndSeconds, 14);
  });

  it("keeps a span moved away from the clip, showing nothing there", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const moved = { ...original, startQ: 20 };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [moved],
      BPM,
    );
    assert.equal(relinked.sourceSpanId, "a");
    near(clipMediaAt(relinked, 2), mediaAt(moved, 2));
  });

  it("moves a clip to the span that now covers it when its own moved away", () => {
    const original = span("a", 0, 8);
    const other = span("b", 20, 8, { trimStartSeconds: 40, mediaId: "m2" });
    const clip = windowClip("w", original, 2, 4);
    const movedOther = { ...other, startQ: 0 };
    const movedOriginal = { ...original, startQ: 20 };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original, other],
      [movedOriginal, movedOther],
      BPM,
    );
    assert.deepEqual(relinked, windowClip("w", movedOther, 2, 4));
  });

  it("follows an edit to the span's source offset", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const offset = { ...original, trimStartSeconds: 13 };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [offset],
      BPM,
    );
    assert.deepEqual(relinked, windowClip("w", offset, 2, 4));
    near(clipMediaAt(relinked, 2), 14);
  });

  it("keeps showing the same content when the span's start is trimmed", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const trimmed = retimeSourceSpan(original, 4, 4, BPM);
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [trimmed],
      BPM,
    );
    assert.deepEqual(relinked, {
      ...clip,
      sourceWindowStartSeconds: 12,
      sourceWindowEndSeconds: 14,
    });
  });

  it("takes the span's new warp, or drops it with the span's", () => {
    const warped = span("a", 0, 8, { warp: warp(10) });
    const clip = windowClip("w", warped, 2, 4);
    const rewarped = { ...warped, warp: warp(12) };
    const [relinked] = relinkClipsToSourceSpans(
      [{ ...clip, warp: warped.warp }],
      [warped],
      [rewarped],
      BPM,
    );
    assert.equal(relinked.warp, rewarped.warp);

    const { warp: _warp, ...unwarped } = rewarped;
    const [cleared] = relinkClipsToSourceSpans(
      [relinked],
      [rewarped],
      [unwarped],
      BPM,
    );
    assert.equal("warp" in cleared, false);
  });

  it("takes the span's new media", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const relinkedMedia = { ...original, mediaPath: "m2.mp4", mediaId: "m2" };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [relinkedMedia],
      BPM,
    );
    assert.equal(relinked.mediaPath, "m2.mp4");
    assert.equal(relinked.mediaId, "m2");
  });

  it("keeps a slipped clip's slip when its span moves", () => {
    const original = span("a", 0, 8);
    // Shows the content a quarter after its position.
    const base = windowClip("w", original, 2, 2);
    const clip = {
      ...base,
      sourceOffsetSeconds: base.sourceOffsetSeconds + 0.5,
      trimStartSeconds: base.trimStartSeconds + 0.5,
    };
    const moved = { ...original, startQ: 1 };
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [moved],
      BPM,
    );
    near(clipMediaAt(relinked, 2), mediaAt(moved, 3));
  });

  it("returns an unchanged clip as is", () => {
    const original = span("a", 0, 8);
    const clip = windowClip("w", original, 2, 4);
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [original],
      [{ ...original }],
      BPM,
    );
    assert.equal(relinked, clip);
  });

  it("moves a clip on a removed span to the span chosen for its position", () => {
    const removed = span("a", 0, 4);
    const kept = span("b", 0, 8, { trimStartSeconds: 40, mediaId: "m2" });
    const clip = windowClip("w", removed, 2, 2);
    const [relinked] = relinkClipsToSourceSpans(
      [clip],
      [removed, kept],
      [kept],
      BPM,
    );
    assert.deepEqual(relinked, windowClip("w", kept, 2, 2));
  });

  it("removes a clip whose span was removed with nothing covering it", () => {
    const removed = span("a", 0, 4);
    const elsewhere = span("b", 8, 4);
    const otherTrack = span("c", 0, 8, { trackId: "t2" });
    const clip = windowClip("w", removed, 1, 2);
    assert.deepEqual(
      relinkClipsToSourceSpans(
        [clip],
        [removed, elsewhere, otherTrack],
        [elsewhere, otherTrack],
        BPM,
      ),
      [],
    );
  });

  it("keeps the clips on both halves of a split span showing the same media", () => {
    const original = span("a", 0, 8);
    const left = retimeSourceSpan(original, 0, 4, BPM);
    const right = retimeSourceSpan({ ...original, id: "b" }, 4, 4, BPM);
    const clips = [
      windowClip("l", original, 1, 2),
      { ...windowClip("r", original, 5, 2), sourceSpanId: "b" },
    ];
    const relinked = relinkClipsToSourceSpans(
      clips,
      [original],
      [left, right],
      BPM,
    );
    assert.deepEqual(
      relinked.map((clip) => [
        clip.id,
        clip.sourceSpanId,
        clip.sourceWindowStartSeconds,
        clip.sourceWindowEndSeconds,
      ]),
      [
        ["l", "a", 10, 12],
        ["r", "b", 12, 14],
      ],
    );
    near(clipMediaAt(relinked[0], 1), mediaAt(original, 1));
    near(clipMediaAt(relinked[1], 5), mediaAt(original, 5));
  });

  it("leaves clips without a source span alone", () => {
    const original = span("a", 0, 8);
    const fill = { ...windowClip("f", original, 0, 2), sourceSpanId: "" };
    assert.deepEqual(relinkClipsToSourceSpans([fill], [original], [], BPM), [
      fill,
    ]);
  });
});

describe("getDroppedSourceSpanStartQ", () => {
  const onTrack = { kind: "track", trackId: "t1", startQ: 6 } as const;

  it("starts at the drop position", () => {
    assert.equal(getDroppedSourceSpanStartQ(onTrack, true, false), 6);
  });

  it("goes after the last span on a locked existing track", () => {
    assert.equal(getDroppedSourceSpanStartQ(onTrack, true, true), undefined);
  });

  it("starts at the drop position on a new track while locked", () => {
    assert.equal(
      getDroppedSourceSpanStartQ({ kind: "new-track", startQ: 6 }, false, true),
      6,
    );
  });

  it("goes after the last span without a drop position", () => {
    assert.equal(
      getDroppedSourceSpanStartQ({ kind: "track", trackId: "t1" }, true, false),
      undefined,
    );
  });
});

describe("placeDroppedSourceSpans", () => {
  // New spans as a drop creates them, before they are placed.
  const dropped = (...durationsQ: number[]) =>
    durationsQ.map((durationQ, index) =>
      span(`new-${index}`, 0, durationQ, { trimStartSeconds: 0 }),
    );

  it("starts one file at the drop position", () => {
    const existing = [span("a", 0, 4)];
    const { sourceSpans } = placeDroppedSourceSpans(
      existing,
      [],
      dropped(8),
      10,
      BPM,
    );
    assert.deepEqual(layout(sourceSpans), [
      ["a", "t1", 0, 4, 10],
      ["new-0", "t1", 10, 18, 0],
    ]);
  });

  it("places several files back to back from the drop position", () => {
    const { sourceSpans } = placeDroppedSourceSpans(
      [],
      [],
      dropped(8, 2, 4),
      6,
      BPM,
    );
    assert.deepEqual(layout(sourceSpans), [
      ["new-0", "t1", 6, 14, 0],
      ["new-1", "t1", 14, 16, 0],
      ["new-2", "t1", 16, 20, 0],
    ]);
  });

  it("overwrites the spans it lands on like a moved span", () => {
    const existing = [
      span("a", 0, 8),
      span("b", 8, 4),
      span("c", 12, 8),
      span("other", 4, 8, { trackId: "t2" }),
    ];
    const { sourceSpans } = placeDroppedSourceSpans(
      existing,
      [],
      dropped(4, 4),
      6,
      BPM,
    );
    assert.deepEqual(layout(sourceSpans), [
      ["a", "t1", 0, 6, 10],
      ["c", "t1", 14, 20, 11],
      ["other", "t2", 4, 12, 10],
      ["new-0", "t1", 6, 10, 0],
      ["new-1", "t1", 10, 14, 0],
    ]);
  });

  it("relinks the arrangement clips on the spans it overwrites", () => {
    const original = span("a", 0, 8);
    const clip: ArrangementClip = {
      id: "w",
      sourceSpanId: "a",
      sourceTrackId: "t1",
      laneId: "1",
      label: "w",
      mediaPath: original.mediaPath,
      mediaId: original.mediaId,
      startQ: 0,
      durationSeconds: 2,
      trimStartSeconds: 10,
      sourceOffsetSeconds: 10,
      sourceWindowStartSeconds: 10,
      sourceWindowEndSeconds: 14,
      tint: original.tint,
      accent: original.accent,
    };
    const { sourceSpans, clips } = placeDroppedSourceSpans(
      [original],
      [clip],
      dropped(4),
      2,
      BPM,
    );
    assert.deepEqual(clips, [
      relinkClipsToSourceSpans([clip], [original], sourceSpans, BPM)[0],
    ]);
    // "a" keeps its first two quarters, one second of media.
    assert.equal(clips[0].sourceWindowEndSeconds, 11);
  });

  it("appends after the track's last span without a drop position", () => {
    const existing = [span("a", 0, 8), span("b", 10, 2)];
    const { sourceSpans, clips } = placeDroppedSourceSpans(
      existing,
      [],
      dropped(4, 4),
      undefined,
      BPM,
    );
    assert.deepEqual(layout(sourceSpans), [
      ["a", "t1", 0, 8, 10],
      ["b", "t1", 10, 12, 10],
      ["new-0", "t1", 12, 16, 0],
      ["new-1", "t1", 16, 20, 0],
    ]);
    assert.deepEqual(clips, []);
  });
});
