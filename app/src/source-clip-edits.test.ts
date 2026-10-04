import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClipClipboard } from "./app/clip-ops.ts";
import type { ArrangementClip, SourceSpan } from "./app/types.ts";
import { getSwatch } from "./app/util.ts";
import type { SessionEffect } from "./fx-stack.ts";
import { sourceClipEffectTrackId } from "./fx-stack.ts";
import {
  canPasteIntoSourceTrack,
  deleteSourceSpan,
  duplicateSourceSpan,
  pasteIntoSourceTrack,
  type SourceClipProject,
  splitSourceSpan,
} from "./source-clip-edits.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

function span(
  id: string,
  startQ: number,
  durationQ: number,
  { trackId = "t1", trimStartSeconds = 10 } = {},
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
    tint: "tint",
    accent: "accent",
  };
}

// A layer clip using `source` from `startQ` for `durationQ` quarters, at the
// span's own offset.
function windowClip(
  id: string,
  source: SourceSpan,
  startQ: number,
  durationQ: number,
  overrides: Partial<ArrangementClip> = {},
): ArrangementClip {
  const sourceOffsetSeconds = source.trimStartSeconds - source.startQ / 2;
  return {
    id,
    sourceSpanId: source.id,
    sourceTrackId: source.sourceTrackId,
    laneId: "lane-1",
    label: "Clip",
    mediaPath: source.mediaPath,
    mediaId: source.mediaId,
    startQ,
    durationSeconds: durationQ / 2,
    trimStartSeconds: startQ / 2 + sourceOffsetSeconds,
    sourceOffsetSeconds,
    sourceWindowStartSeconds: source.trimStartSeconds,
    sourceWindowEndSeconds: source.trimStartSeconds + source.durationSeconds,
    tint: "tint",
    accent: "accent",
    ...overrides,
  };
}

function effect(id: string, trackId: string) {
  return {
    id,
    trackId,
    effectName: "Colorize",
    parameters: [{ name: "Hue", value: 0.5 }],
  } as unknown as SessionEffect;
}

function project(
  sourceSpans: SourceSpan[],
  overrides: Partial<SourceClipProject> = {},
): SourceClipProject {
  return {
    bpm: BPM,
    clips: [],
    effects: [],
    sourceSpans,
    sourceTracks: [
      { id: "t1", name: "Track 1", colorIndex: 0, recordingPaths: ["m1.mp4"] },
      { id: "t2", name: "Track 2", colorIndex: 1, recordingPaths: [] },
    ],
    ...overrides,
  };
}

const ids = (...values: string[]) => {
  const queue = [...values];
  return () => queue.shift() ?? "extra";
};

const timing = (spans: readonly SourceSpan[] = []) =>
  spans.map(
    (item) =>
      `${item.id}@${item.sourceTrackId}:${item.startQ}+${item.durationSeconds * 2}q from ${item.trimStartSeconds}s`,
  );

describe("splitSourceSpan", () => {
  it("splits at the playhead with the media continuing in the new piece", () => {
    const patch = splitSourceSpan(project([span("a", 4, 8)]), "a", 6, "b");
    assert.deepEqual(timing(patch?.sourceSpans), [
      "a@t1:4+2q from 10s",
      "b@t1:6+6q from 11s",
    ]);
  });

  it("copies the clip's stack to the new piece", () => {
    const patch = splitSourceSpan(
      project([span("a", 0, 8)], {
        effects: [effect("e1", sourceClipEffectTrackId("a"))],
      }),
      "a",
      4,
      "b",
    );
    assert.deepEqual(
      patch?.effects?.map((item) => item.trackId),
      [sourceClipEffectTrackId("a"), sourceClipEffectTrackId("b")],
    );
    assert.notEqual(patch?.effects?.[1].id, "e1");
  });

  it("moves the layer clips that start in the new piece to it", () => {
    const source = span("a", 0, 8);
    const patch = splitSourceSpan(
      project([source], {
        clips: [
          windowClip("left", source, 0, 2),
          windowClip("right", source, 5, 2),
        ],
      }),
      "a",
      4,
      "b",
    );
    assert.deepEqual(
      patch?.clips?.map((clip) => [
        clip.id,
        clip.sourceSpanId,
        clip.sourceWindowStartSeconds,
        clip.sourceWindowEndSeconds,
      ]),
      [
        ["left", "a", 10, 12],
        ["right", "b", 12, 14],
      ],
    );
  });

  it("does nothing unless the playhead is strictly inside", () => {
    const current = project([span("a", 4, 8)]);
    assert.equal(splitSourceSpan(current, "a", 4, "b"), undefined);
    assert.equal(splitSourceSpan(current, "a", 12, "b"), undefined);
    assert.equal(splitSourceSpan(current, "missing", 6, "b"), undefined);
  });
});

describe("duplicateSourceSpan", () => {
  it("places the copy right after the clip, overwriting what is there", () => {
    const patch = duplicateSourceSpan(
      project([
        span("a", 0, 4),
        span("next", 6, 4, { trimStartSeconds: 40 }),
        span("other", 4, 4, { trackId: "t2" }),
      ]),
      "a",
      "copy",
    );
    assert.deepEqual(timing(patch?.sourceSpans), [
      "a@t1:0+4q from 10s",
      "next@t1:8+2q from 41s",
      "other@t2:4+4q from 10s",
      "copy@t1:4+4q from 10s",
    ]);
  });

  it("copies the clip's stack", () => {
    const patch = duplicateSourceSpan(
      project([span("a", 0, 4)], {
        effects: [effect("e1", sourceClipEffectTrackId("a"))],
      }),
      "a",
      "copy",
    );
    assert.deepEqual(
      patch?.effects?.map((item) => item.trackId),
      [sourceClipEffectTrackId("a"), sourceClipEffectTrackId("copy")],
    );
  });
});

describe("pasteIntoSourceTrack", () => {
  const sourceClipboard = (source: SourceSpan): ClipClipboard => ({
    fragments: [{ clip: windowClip(source.id, source, 0, 4), offsetQ: 0 }],
    durationQ: 4,
    sourceSpan: source,
    effects: [effect("e1", sourceClipEffectTrackId(source.id))],
  });

  it("pastes a copied source clip at the playhead with its stack", () => {
    // The copied clip was cut, so its stack is only on the clipboard.
    const patch = pasteIntoSourceTrack(
      project([span("a", 0, 4)]),
      sourceClipboard(span("cut", 0, 4, { trimStartSeconds: 20 })),
      "t1",
      2,
      ids("pasted"),
    );
    assert.deepEqual(timing(patch?.sourceSpans), [
      "a@t1:0+2q from 10s",
      "pasted@t1:2+4q from 20s",
    ]);
    assert.deepEqual(
      patch?.effects?.map((item) => item.trackId),
      [sourceClipEffectTrackId("pasted")],
    );
  });

  it("takes the target track's color and lists its media there", () => {
    const patch = pasteIntoSourceTrack(
      project([]),
      sourceClipboard(span("a", 0, 4)),
      "t2",
      0,
      ids("pasted"),
    );
    const swatch = getSwatch(1);
    assert.equal(patch?.sourceSpans?.[0].tint, swatch.color);
    assert.equal(patch?.sourceSpans?.[0].accent, swatch.accent);
    assert.deepEqual(
      patch?.sourceTracks?.find((track) => track.id === "t2")?.recordingPaths,
      ["m1.mp4"],
    );
  });

  it("refuses layer clips, which paste only onto layers", () => {
    const source = span("a", 0, 8);
    const media = windowClip("clip", source, 0, 4);
    const fill = windowClip("fill", source, 0, 4, { kind: "fill" });
    for (const clip of [media, fill]) {
      const clipboard = { fragments: [{ clip, offsetQ: 0 }], durationQ: 4 };
      assert.equal(canPasteIntoSourceTrack(clipboard), false);
      assert.equal(
        pasteIntoSourceTrack(project([]), clipboard, "t1", 0, ids("x")),
        undefined,
      );
    }
    assert.equal(canPasteIntoSourceTrack(null), false);
    assert.equal(canPasteIntoSourceTrack(sourceClipboard(source)), true);
  });
});

describe("deleteSourceSpan", () => {
  it("removes the clip and relinks the layer clips still covered", () => {
    const removed = span("a", 0, 4);
    const kept = span("b", 4, 4, { trimStartSeconds: 30 });
    const patch = deleteSourceSpan(
      project([removed, kept], { clips: [windowClip("clip", removed, 2, 4)] }),
      "a",
    );
    assert.deepEqual(timing(patch?.sourceSpans), ["b@t1:4+4q from 30s"]);
    assert.equal(patch?.clips?.[0].sourceSpanId, "b");
  });

  it("removes the layer clips left with no source clip", () => {
    const removed = span("a", 0, 4);
    const kept = span("b", 4, 4, { trimStartSeconds: 30 });
    const patch = deleteSourceSpan(
      project([removed, kept], {
        clips: [
          windowClip("gone", removed, 0, 2),
          windowClip("stays", kept, 4, 2),
        ],
      }),
      "a",
    );
    assert.deepEqual(
      patch?.clips?.map((clip) => clip.id),
      ["stays"],
    );
  });

  it("does nothing for a missing clip", () => {
    assert.equal(deleteSourceSpan(project([]), "a"), undefined);
  });
});
