import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrangementClip, SourceSpan } from "./app/types.ts";
import { retimeSourceSpan } from "./source-span-edit.ts";
import {
  getClipPieceClips,
  getClipSourcePieces,
  syncClipsToSourceSpans,
} from "./source-track-content.ts";

// At 120 BPM a quarter lasts half a second, and a 4/4 bar four quarters.
const BPM = 120;
const bar = (n: number) => (n - 1) * 4;

function span(
  id: string,
  startQ: number,
  endQ: number,
  { trackId = "t1", trimStartSeconds = 0, mediaId = id } = {},
): SourceSpan {
  return {
    id,
    sourceTrackId: trackId,
    label: id,
    mediaPath: `${mediaId}.mp4`,
    mediaId,
    startQ,
    durationSeconds: (endQ - startQ) / 2,
    trimStartSeconds,
    tint: "#111",
    accent: "#222",
  };
}

// A layer clip on `first`'s track from `startQ` to `endQ`, as committing a
// selection there creates it, showing the track `slipQ` quarters later.
function windowClip(
  id: string,
  first: SourceSpan,
  startQ: number,
  endQ: number,
  slipQ = 0,
): ArrangementClip {
  const spanOffsetSeconds = first.trimStartSeconds - first.startQ / 2;
  const sourceOffsetSeconds = spanOffsetSeconds + slipQ / 2;
  return {
    id,
    sourceSpanId: first.id,
    sourceTrackId: first.sourceTrackId,
    laneId: "1",
    label: id,
    mediaPath: first.mediaPath,
    mediaId: first.mediaId,
    startQ,
    durationSeconds: (endQ - startQ) / 2,
    trimStartSeconds: startQ / 2 + sourceOffsetSeconds,
    sourceOffsetSeconds,
    sourceSpanOffsetSeconds: spanOffsetSeconds,
    sourceWindowStartSeconds: first.trimStartSeconds,
    sourceWindowEndSeconds: first.trimStartSeconds + first.durationSeconds,
    tint: first.tint,
    accent: first.accent,
  };
}

// [source clip, from, to] for each part of `clip` that shows one.
const pieces = (clip: ArrangementClip, spans: readonly SourceSpan[]) =>
  getClipSourcePieces(clip, spans, BPM).map((piece) => [
    piece.span.id,
    piece.startQ,
    piece.endQ,
  ]);

// Position and length, in quarters, of a layer clip.
const place = (clip: ArrangementClip) => [
  clip.id,
  clip.startQ,
  clip.durationSeconds * 2,
];

describe("a layer clip over bars 4-8 of a track with clips on bars 1-6 and 6-10", () => {
  const first = span("first", bar(1), bar(6));
  const second = span("second", bar(6), bar(10), { trimStartSeconds: 5 });
  const spans = [first, second];
  const clip = windowClip("w", first, bar(4), bar(8));

  it("shows the end of the first clip, then the start of the second", () => {
    assert.deepEqual(pieces(clip, spans), [
      ["first", bar(4), bar(6)],
      ["second", bar(6), bar(8)],
    ]);
  });

  it("plays each source clip's media where it shows it", () => {
    const [left, right] = getClipPieceClips(clip, spans, BPM);
    // Bar 4 is six seconds into the first clip's media.
    assert.deepEqual(
      [left.mediaId, left.startQ, left.durationSeconds, left.trimStartSeconds],
      ["first", bar(4), 4, 6],
    );
    // The second clip plays its media from second 5 at bar 6.
    assert.deepEqual(
      [
        right.mediaId,
        right.startQ,
        right.durationSeconds,
        right.trimStartSeconds,
      ],
      ["second", bar(6), 4, 5],
    );
    assert.deepEqual([left.id, right.id], ["w", "w"]);
  });

  it("keeps bars 4-8 and shows nothing on 4-6 once the first is trimmed to bars 1-2", () => {
    const trimmed = [retimeSourceSpan(first, bar(1), 4, BPM), second];
    const [after] = syncClipsToSourceSpans([clip], spans, trimmed, BPM);
    assert.deepEqual(place(after), ["w", bar(4), 16]);
    assert.deepEqual(pieces(after, trimmed), [["second", bar(6), bar(8)]]);
    assert.deepEqual(
      getClipPieceClips(after, trimmed, BPM).map((piece) => [
        piece.mediaId,
        piece.trimStartSeconds,
      ]),
      [["second", 5]],
    );
  });

  it("keeps the layer clip when the first is deleted, showing nothing there", () => {
    const [after] = syncClipsToSourceSpans([clip], spans, [second], BPM);
    assert.deepEqual(place(after), ["w", bar(4), 16]);
    assert.deepEqual(pieces(after, [second]), [["second", bar(6), bar(8)]]);
  });

  it("keeps the layer clip with both deleted, showing nothing at all", () => {
    const [after] = syncClipsToSourceSpans([clip], spans, [], BPM);
    assert.deepEqual(place(after), ["w", bar(4), 16]);
    assert.deepEqual(pieces(after, []), []);
    assert.deepEqual(getClipPieceClips(after, [], BPM), []);
  });

  it("fills the gap again when a source clip is moved or added there", () => {
    const trimmed = [retimeSourceSpan(first, bar(1), 4, BPM), second];
    const [gap] = syncClipsToSourceSpans([clip], spans, trimmed, BPM);

    // The trimmed clip moved to bars 4-5.
    const moved = [{ ...trimmed[0], startQ: bar(4) }, second];
    const [refilled] = syncClipsToSourceSpans([gap], trimmed, moved, BPM);
    assert.deepEqual(place(refilled), ["w", bar(4), 16]);
    assert.deepEqual(pieces(refilled, moved), [
      ["first", bar(4), bar(5)],
      ["second", bar(6), bar(8)],
    ]);

    // A new clip added on bars 5-6.
    const added = [...moved, span("third", bar(5), bar(6))];
    const [full] = syncClipsToSourceSpans([refilled], moved, added, BPM);
    assert.deepEqual(pieces(full, added), [
      ["first", bar(4), bar(5)],
      ["third", bar(5), bar(6)],
      ["second", bar(6), bar(8)],
    ]);
  });
});

describe("getClipSourcePieces", () => {
  it("shows the source clip starting later where two overlap", () => {
    const spans = [span("a", 0, 8), span("b", 4, 12)];
    const clip = windowClip("w", spans[0], 0, 12);
    assert.deepEqual(pieces(clip, spans), [
      ["a", 0, 4],
      ["b", 4, 12],
    ]);
  });

  it("ignores source clips on other tracks", () => {
    const spans = [span("a", 0, 4), span("b", 4, 8, { trackId: "t2" })];
    assert.deepEqual(pieces(windowClip("w", spans[0], 0, 8), spans), [
      ["a", 0, 4],
    ]);
  });

  it("shows a slipped clip's window later on the track", () => {
    const spans = [span("a", 0, 4), span("b", 4, 8)];
    // At quarters 2-4 it shows the track's quarters 3-5.
    const clip = windowClip("w", spans[0], 2, 4, 1);
    assert.deepEqual(pieces(clip, spans), [
      ["a", 2, 3],
      ["b", 3, 4],
    ]);
  });

  it("gives fill, text and FX clips none", () => {
    const spans = [span("a", 0, 4)];
    const fill = { ...windowClip("f", spans[0], 0, 4), kind: "fill" as const };
    assert.deepEqual(pieces(fill, spans), []);
    assert.deepEqual(getClipPieceClips(fill, spans, BPM), [fill]);
  });
});

describe("syncClipsToSourceSpans", () => {
  it("returns the same clips when nothing they show changed", () => {
    const spans = [span("a", 0, 8)];
    const clips = [windowClip("w", spans[0], 2, 6)];
    assert.equal(
      syncClipsToSourceSpans(clips, spans, [{ ...spans[0] }], BPM),
      clips,
    );
  });

  it("keeps a slipped clip's window when the source clips move", () => {
    const spans = [span("a", 0, 8)];
    const clip = windowClip("w", spans[0], 2, 4, 1);
    const moved = [{ ...spans[0], startQ: 1 }];
    const [after] = syncClipsToSourceSpans([clip], spans, moved, BPM);
    // Quarters 2-4 still show the track's quarters 3-5.
    assert.deepEqual(
      getClipPieceClips(after, moved, BPM).map((piece) => [
        piece.startQ,
        piece.trimStartSeconds,
      ]),
      [[2, 1]],
    );
  });

  it("measures an older clip's window against the source clip it names", () => {
    const spans = [span("a", 0, 8, { trimStartSeconds: 3 })];
    const { sourceSpanOffsetSeconds: _offset, ...older } = windowClip(
      "w",
      spans[0],
      2,
      4,
      1,
    );
    const [after] = syncClipsToSourceSpans([older], spans, [], BPM);
    assert.deepEqual(place(after), ["w", 2, 2]);
    // Once that source clip is gone, the window it showed is kept.
    assert.deepEqual(pieces(after, [span("b", 0, 8)]), [["b", 2, 4]]);
    const [shifted] = getClipPieceClips(after, [span("b", 0, 8)], BPM);
    assert.equal(shifted.trimStartSeconds, 1.5);
  });
});
