import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrangementClip, SourceSpan, SourceTrack } from "./app/types.ts";
import type { MediaItem } from "./media.ts";
import {
  addMediaToSourceTrack,
  getMediaClipTrim,
} from "./source-track-media.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

function media(
  id: string,
  durationSeconds: number,
  range?: { inSeconds: number; outSeconds: number },
  availability: MediaItem["availability"] = "ready",
): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds,
    hasAudio: true,
    hasVideo: true,
    color: "#111",
    accent: "#222",
    previewUrl: availability === "ready" ? `blob:${id}` : "",
    sourcePath: `/media/${id}.mp4`,
    availability,
    ...(range
      ? { rangeInSeconds: range.inSeconds, rangeOutSeconds: range.outSeconds }
      : {}),
  };
}

function track(id: string, recordingPaths: string[] = []): SourceTrack {
  return { id, name: id, colorIndex: 0, recordingPaths };
}

function span(
  id: string,
  trackId: string,
  startQ: number,
  durationQ: number,
): SourceSpan {
  return {
    id,
    sourceTrackId: trackId,
    label: id,
    mediaPath: "old.mp4",
    mediaId: "old",
    startQ,
    durationSeconds: durationQ / 2,
    trimStartSeconds: 0,
    tint: "#111",
    accent: "#222",
  };
}

function project({
  sourceTracks = [track("t1")],
  sourceSpans = [] as SourceSpan[],
  clips = [] as ArrangementClip[],
  sourceTracksLocked = false,
} = {}) {
  return {
    sourceTracks,
    sourceSpans,
    clips,
    effects: [],
    sourceTracksLocked,
    bpm: BPM,
  };
}

// [media, track, start, end, media start] for each span, in quarters and
// seconds.
const layout = (spans: readonly SourceSpan[]) =>
  spans.map((item) => [
    item.mediaId,
    item.sourceTrackId,
    item.startQ,
    item.startQ + item.durationSeconds * 2,
    item.trimStartSeconds,
  ]);

describe("getMediaClipTrim", () => {
  it("plays the In/Out range of media that has one", () => {
    assert.deepEqual(
      getMediaClipTrim(media("a", 10, { inSeconds: 2, outSeconds: 5.5 })),
      {
        trimStartSeconds: 2,
        durationSeconds: 3.5,
      },
    );
  });

  it("plays the whole file without a range", () => {
    assert.deepEqual(getMediaClipTrim(media("a", 10)), {
      trimStartSeconds: 0,
      durationSeconds: 10,
    });
  });

  it("keeps a range shorter than a second at its own length", () => {
    assert.deepEqual(
      getMediaClipTrim(media("a", 10, { inSeconds: 1, outSeconds: 1.5 })),
      { trimStartSeconds: 1, durationSeconds: 0.5 },
    );
  });

  it("makes media without a duration yet a second long", () => {
    assert.deepEqual(getMediaClipTrim(media("a", 0)), {
      trimStartSeconds: 0,
      durationSeconds: 1,
    });
  });

  it("ignores a stored range that is out of order", () => {
    assert.deepEqual(
      getMediaClipTrim(media("a", 10, { inSeconds: 6, outSeconds: 4 })),
      { trimStartSeconds: 0, durationSeconds: 10 },
    );
  });
});

describe("addMediaToSourceTrack", () => {
  it("starts the clip at the drop position, pre-trimmed to the range", () => {
    const placed = addMediaToSourceTrack(
      project(),
      [media("a", 10, { inSeconds: 2, outSeconds: 4 })],
      { kind: "track", trackId: "t1", startQ: 8 },
    );
    assert.deepEqual(layout(placed.sourceSpans), [["a", "t1", 8, 12, 2]]);
  });

  it("places several items back to back", () => {
    const placed = addMediaToSourceTrack(
      project(),
      [media("a", 10, { inSeconds: 2, outSeconds: 4 }), media("b", 3)],
      { kind: "track", trackId: "t1", startQ: 4 },
    );
    assert.deepEqual(layout(placed.sourceSpans), [
      ["a", "t1", 4, 8, 2],
      ["b", "t1", 8, 14, 0],
    ]);
  });

  it("overwrites the clips it lands on like a moved clip", () => {
    const placed = addMediaToSourceTrack(
      project({
        sourceSpans: [span("old", "t1", 0, 8), span("other", "t2", 0, 8)],
        sourceTracks: [track("t1"), track("t2")],
      }),
      [media("a", 10, { inSeconds: 0, outSeconds: 2 })],
      { kind: "track", trackId: "t1", startQ: 6 },
    );
    assert.deepEqual(layout(placed.sourceSpans), [
      ["old", "t1", 0, 6, 0],
      ["old", "t2", 0, 8, 0],
      ["a", "t1", 6, 10, 0],
    ]);
  });

  it("appends after the last clip of a locked track", () => {
    const placed = addMediaToSourceTrack(
      project({
        sourceSpans: [span("old", "t1", 0, 16)],
        sourceTracksLocked: true,
      }),
      [media("a", 10, { inSeconds: 1, outSeconds: 3 })],
      { kind: "track", trackId: "t1", startQ: 4 },
    );
    assert.deepEqual(layout(placed.sourceSpans), [
      ["old", "t1", 0, 16, 0],
      ["a", "t1", 16, 20, 1],
    ]);
  });

  it("creates a track named after the first item on the new-track row", () => {
    const current = project();
    const placed = addMediaToSourceTrack(
      current,
      [media("intro", 4), media("b", 2)],
      { kind: "new-track", startQ: 2 },
    );
    assert.equal(placed.sourceTracks.length, 2);
    const created = placed.sourceTracks[1];
    assert.equal(created.name, "intro");
    assert.deepEqual(created.recordingPaths, [
      "/media/intro.mp4",
      "/media/b.mp4",
    ]);
    assert.deepEqual(layout(placed.sourceSpans), [
      ["intro", created.id, 2, 10, 0],
      ["b", created.id, 10, 14, 0],
    ]);
  });

  it("reuses the media items without adding any", () => {
    const item = media("a", 10, { inSeconds: 2, outSeconds: 4 });
    const placed = addMediaToSourceTrack(project(), [item], {
      kind: "track",
      trackId: "t1",
      startQ: 0,
    });
    assert.equal("mediaItems" in placed, false);
    assert.equal(placed.sourceSpans[0].mediaId, item.id);
    assert.equal(placed.sourceSpans[0].mediaPath, item.sourcePath);
  });

  it("lists a file on the track once", () => {
    const placed = addMediaToSourceTrack(
      project({ sourceTracks: [track("t1", ["/media/a.mp4"])] }),
      [media("a", 10), media("a", 10)],
      { kind: "track", trackId: "t1", startQ: 0 },
    );
    assert.deepEqual(placed.sourceTracks[0].recordingPaths, ["/media/a.mp4"]);
  });

  it("places offline media like any other", () => {
    const placed = addMediaToSourceTrack(
      project(),
      [media("a", 6, { inSeconds: 1, outSeconds: 2 }, "offline")],
      { kind: "track", trackId: "t1", startQ: 0 },
    );
    assert.deepEqual(layout(placed.sourceSpans), [["a", "t1", 0, 2, 1]]);
  });

  it("gives each clip of media with sound a Gain, and none without", () => {
    const placed = addMediaToSourceTrack(
      project(),
      [media("a", 2), { ...media("b", 2), hasAudio: false }],
      { kind: "track", trackId: "t1", startQ: 0 },
    );
    const [withSound, silent] = placed.sourceSpans;
    assert.ok(withSound && silent);
    assert.deepEqual(
      placed.effects.map((effect) => [effect.trackId, effect.effectName]),
      [[`source-clip:${withSound.id}`, "Gain"]],
    );
  });
});
