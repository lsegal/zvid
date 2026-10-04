import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "./app/types.ts";
import { getClipFilmstripTiles } from "./clip-filmstrip.ts";
import {
  computeActiveClips,
  type MediaItem,
} from "./composition-active-clips.ts";
import { getRenderedEffects } from "./fx-stack.ts";
import { resolveRenderClips } from "./render-clips.ts";
import {
  deleteSourceSpan,
  type SourceClipProject,
  splitSourceSpan,
} from "./source-clip-edits.ts";
import {
  dragSourceSpan,
  resolveSourceSpanOverlaps,
  type SourceSpanDragKind,
} from "./source-span-edit.ts";
import {
  getClipPieceClips,
  syncClipsToSourceSpans,
} from "./source-track-content.ts";

// Every edit to a source track's clips changes what the layer clips over the
// edited range show, in the timeline's filmstrips and in what preview and
// export render, while layer clips elsewhere stay as they were (#936). Each
// edit here goes through the same functions the editor commits it with, and
// each check through the same resolution preview and export draw from.
//
// At 120 BPM a quarter lasts half a second. Source track "a" holds "s1",
// eight quarters of media-1 from quarter 0, and "s2", eight quarters of
// media-2 from quarter 16. Layer clip "over-s1" shows quarters 2 to 6 of the
// track, "over-s2" quarters 18 to 22.
const BPM = 120;
const QUARTER_PX = 20;

const TRACKS: SourceTrack[] = [
  { id: "a", name: "Track a", colorIndex: 0, recordingPaths: [] },
];
const LANES: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];
const MEDIA = new Map(
  ["media-1", "media-2", "media-3"].map(
    (id) =>
      [
        id,
        {
          id,
          name: `${id}.mp4`,
          kind: "video",
          durationSeconds: 60,
          width: 1080,
          height: 1920,
          hasAudio: false,
          hasVideo: true,
          previewUrl: `/${id}`,
        } satisfies MediaItem,
      ] as const,
  ),
);

function span(id: string, mediaId: string, startQ: number): SourceSpan {
  return {
    id,
    sourceTrackId: "a",
    label: id,
    mediaPath: `${mediaId}.mp4`,
    mediaId,
    startQ,
    durationSeconds: 4,
    trimStartSeconds: 0,
    tint: "#000",
    accent: "#fff",
  };
}

// A layer clip over quarters `startQ` to `endQ` of the track, made the way
// committing a selection makes one (see useClipInsertion).
function windowClip(
  id: string,
  sourceSpan: SourceSpan,
  spans: SourceSpan[],
  startQ: number,
  endQ: number,
): ArrangementClip {
  const sourceOffsetSeconds =
    sourceSpan.trimStartSeconds - (sourceSpan.startQ * 60) / BPM;
  const clip: ArrangementClip = {
    id,
    sourceSpanId: sourceSpan.id,
    sourceTrackId: "a",
    laneId: "1",
    label: id,
    mediaPath: sourceSpan.mediaPath,
    mediaId: sourceSpan.mediaId,
    startQ,
    durationSeconds: ((endQ - startQ) * 60) / BPM,
    trimStartSeconds: (startQ * 60) / BPM + sourceOffsetSeconds,
    sourceOffsetSeconds,
    sourceSpanOffsetSeconds: sourceOffsetSeconds,
    sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
    sourceWindowEndSeconds:
      sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
    tint: "#000",
    accent: "#fff",
  };
  return syncClipsToSourceSpans([clip], spans, spans, BPM)[0];
}

function initialProject(): SourceClipProject {
  const s1 = span("s1", "media-1", 0);
  const s2 = span("s2", "media-2", 16);
  const sourceSpans = [s1, s2];
  return {
    bpm: BPM,
    sourceTracks: TRACKS,
    sourceSpans,
    effects: [],
    clips: [
      windowClip("over-s1", s1, sourceSpans, 2, 6),
      windowClip("over-s2", s2, sourceSpans, 18, 22),
    ],
  };
}

// Source clip `spanId` dragged by `deltaQ` quarters, committed the way
// useSourceSpanDrag commits a move or trim.
function drag(
  project: SourceClipProject,
  spanId: string,
  kind: SourceSpanDragKind,
  deltaQ: number,
): SourceClipProject {
  const origin = project.sourceSpans.find((item) => item.id === spanId);
  assert.ok(origin);
  const active = dragSourceSpan(origin, kind, deltaQ, {
    bpm: BPM,
    fps: 30,
    snapUnit: 1,
    snap: false,
  });
  const sourceSpans = resolveSourceSpanOverlaps(
    project.sourceSpans,
    active,
    BPM,
  );
  return {
    ...project,
    sourceSpans,
    clips: syncClipsToSourceSpans(
      project.clips,
      project.sourceSpans,
      sourceSpans,
      BPM,
    ),
  };
}

// Source clip `spanId` patched the way the source clip properties commit a
// change (see useSourceClipProperties).
function patch(
  project: SourceClipProject,
  spanId: string,
  fields: Partial<SourceSpan>,
): SourceClipProject {
  const sourceSpans = project.sourceSpans.map((item) =>
    item.id === spanId ? { ...item, ...fields } : item,
  );
  return {
    ...project,
    sourceSpans,
    clips: syncClipsToSourceSpans(
      project.clips,
      project.sourceSpans,
      sourceSpans,
      BPM,
    ),
  };
}

function apply(
  project: SourceClipProject,
  edit: Partial<SourceClipProject> | undefined,
): SourceClipProject {
  assert.ok(edit);
  return { ...project, ...edit };
}

// What preview and export draw of layer clip `clipId` at song quarter
// `playheadQ`: the media and media second, or nothing.
function renderedAt(
  project: SourceClipProject,
  clipId: string,
  playheadQ: number,
) {
  const render = resolveRenderClips({
    clips: project.clips,
    lanes: LANES,
    sourceTracks: project.sourceTracks,
    sourceSpans: project.sourceSpans,
    bpm: BPM,
    effects: project.effects,
  });
  const active = computeActiveClips(
    render.clips,
    MEDIA,
    playheadQ,
    BPM,
    new Map(render.lanes.map((lane, index) => [lane.id, index])),
    getRenderedEffects(render.effects, render.lanes, render.clips),
  ).filter((entry) => entry.clip.id === clipId);
  assert.ok(active.length <= 1);
  return active[0]
    ? { mediaId: active[0].clip.mediaId, mediaTime: active[0].mediaTime }
    : null;
}

// The timeline's filmstrip for layer clip `clipId`: per piece, its span,
// where it starts and the media second of its first tile (see
// useTimelineThumbnails).
function filmstripOf(project: SourceClipProject, clipId: string) {
  const clip = project.clips.find((item) => item.id === clipId);
  assert.ok(clip);
  return getClipPieceClips(clip, project.sourceSpans, BPM).map((piece) => {
    const clipLeftPx = piece.startQ * QUARTER_PX;
    const [firstTile] = getClipFilmstripTiles({
      clip: piece,
      mediaDurationSeconds: 60,
      clipLeftPx,
      clipWidthPx: ((piece.durationSeconds * BPM) / 60) * QUARTER_PX,
      tileWidthPx: 10,
      secondsPerPx: 60 / BPM / QUARTER_PX,
      range: { startPx: 0, endPx: 10_000 },
      bpm: BPM,
    });
    return {
      spanId: piece.sourceSpanId,
      mediaId: piece.mediaId,
      startQ: piece.startQ,
      firstTileSeconds: firstTile?.timeSeconds,
    };
  });
}

// Layer clip "over-s2", outside every edit to s1, is unchanged.
function assertOverS2Untouched(
  before: SourceClipProject,
  after: SourceClipProject,
) {
  assert.equal(
    after.clips.find((clip) => clip.id === "over-s2"),
    before.clips.find((clip) => clip.id === "over-s2"),
  );
  assert.deepEqual(
    filmstripOf(after, "over-s2"),
    filmstripOf(before, "over-s2"),
  );
  assert.deepEqual(renderedAt(after, "over-s2", 20), {
    mediaId: "media-2",
    mediaTime: 2,
  });
}

describe("layer clips after a source track edit (#936)", () => {
  const before = initialProject();

  it("starts showing s1 under over-s1", () => {
    assert.deepEqual(filmstripOf(before, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 2, firstTileSeconds: 1 },
    ]);
    assert.deepEqual(renderedAt(before, "over-s1", 4), {
      mediaId: "media-1",
      mediaTime: 2,
    });
  });

  it("follows a move of the source clip", () => {
    // s1 now plays from quarter 2, so quarter 4 shows its second 1.
    const after = drag(before, "s1", "move", 2);
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 2, firstTileSeconds: 0 },
    ]);
    assert.deepEqual(renderedAt(after, "over-s1", 4), {
      mediaId: "media-1",
      mediaTime: 1,
    });
    assertOverS2Untouched(before, after);
  });

  it("shows nothing where trimming the start opens a gap", () => {
    // s1 now starts at quarter 4, so quarters 2 to 4 are a gap.
    const after = drag(before, "s1", "resize-start", 4);
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 4, firstTileSeconds: 2 },
    ]);
    assert.equal(renderedAt(after, "over-s1", 3), null);
    assert.deepEqual(renderedAt(after, "over-s1", 5), {
      mediaId: "media-1",
      mediaTime: 2.5,
    });
    assertOverS2Untouched(before, after);
  });

  it("shows nothing where trimming the end opens a gap", () => {
    // s1 now ends at quarter 4, so quarters 4 to 6 are a gap.
    const after = drag(before, "s1", "resize-end", -4);
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 2, firstTileSeconds: 1 },
    ]);
    assert.deepEqual(renderedAt(after, "over-s1", 3), {
      mediaId: "media-1",
      mediaTime: 1.5,
    });
    assert.equal(renderedAt(after, "over-s1", 5), null);
    assertOverS2Untouched(before, after);
  });

  it("follows an Offset change of the source clip", () => {
    const after = patch(before, "s1", { trimStartSeconds: 1 });
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 2, firstTileSeconds: 2 },
    ]);
    assert.deepEqual(renderedAt(after, "over-s1", 4), {
      mediaId: "media-1",
      mediaTime: 3,
    });
    assertOverS2Untouched(before, after);
  });

  it("follows the source clip being pointed at other media", () => {
    const after = patch(before, "s1", {
      mediaId: "media-3",
      mediaPath: "media-3.mp4",
    });
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-3", startQ: 2, firstTileSeconds: 1 },
    ]);
    assert.deepEqual(renderedAt(after, "over-s1", 4), {
      mediaId: "media-3",
      mediaTime: 2,
    });
    assertOverS2Untouched(before, after);
  });

  it("shows the same content from both halves of a split", () => {
    const after = apply(before, splitSourceSpan(before, "s1", 4, "s1-b"));
    assert.deepEqual(filmstripOf(after, "over-s1"), [
      { spanId: "s1", mediaId: "media-1", startQ: 2, firstTileSeconds: 1 },
      { spanId: "s1-b", mediaId: "media-1", startQ: 4, firstTileSeconds: 2 },
    ]);
    assert.deepEqual(renderedAt(after, "over-s1", 3), {
      mediaId: "media-1",
      mediaTime: 1.5,
    });
    assert.deepEqual(renderedAt(after, "over-s1", 5), {
      mediaId: "media-1",
      mediaTime: 2.5,
    });
    assertOverS2Untouched(before, after);
  });

  it("shows nothing once the source clip is deleted, but keeps the clip", () => {
    const after = apply(before, deleteSourceSpan(before, "s1"));
    assert.ok(after.clips.some((clip) => clip.id === "over-s1"));
    assert.deepEqual(filmstripOf(after, "over-s1"), []);
    assert.equal(renderedAt(after, "over-s1", 4), null);
    assertOverS2Untouched(before, after);
  });
});
