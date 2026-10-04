import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "./media.ts";
import {
  clearMediaRange,
  effectiveMediaRange,
  hasMediaRange,
  mediaRangeFrameRate,
  mediaRangeOf,
  normalizeMediaRange,
  restoreMediaRanges,
  savedMediaRanges,
  setMediaRangePoint,
  updateMediaItem,
} from "./media-range.ts";
import type { ProjectSession } from "./session.ts";
import { readSessionMediaRanges } from "./session-save.ts";

const FPS = 30;
const FRAME = 1 / FPS;

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "a",
  name: "take.mp4",
  kind: "video",
  durationSeconds: 3,
  fps: FPS,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  sourcePath: "/media/take.mp4",
  availability: "ready",
  ...extra,
});

describe("mediaRangeOf", () => {
  it("is undefined without a range, so the whole file is used", () => {
    const item = media();
    assert.equal(mediaRangeOf(item), undefined);
    assert.equal(hasMediaRange(item), false);
    assert.deepEqual(effectiveMediaRange(item), {
      inSeconds: 0,
      outSeconds: 3,
    });
  });

  it("ignores stored values that are not a range", () => {
    assert.equal(
      mediaRangeOf(media({ rangeInSeconds: 2, rangeOutSeconds: 1 })),
      undefined,
    );
    assert.equal(
      mediaRangeOf(media({ rangeInSeconds: -1, rangeOutSeconds: 1 })),
      undefined,
    );
    assert.equal(
      mediaRangeOf(media({ rangeInSeconds: 1, rangeOutSeconds: Number.NaN })),
      undefined,
    );
  });
});

describe("normalizeMediaRange", () => {
  it("snaps both points to frames", () => {
    assert.deepEqual(
      normalizeMediaRange({ inSeconds: 0.51, outSeconds: 1.49 }, 3, FPS),
      { inSeconds: 15 / FPS, outSeconds: 45 / FPS },
    );
  });

  it("clamps to the file", () => {
    assert.deepEqual(
      normalizeMediaRange({ inSeconds: -1, outSeconds: 9 }, 3, FPS),
      { inSeconds: 0, outSeconds: 3 },
    );
  });

  it("never puts Out past the last whole frame", () => {
    const range = normalizeMediaRange(
      { inSeconds: 0, outSeconds: 2.99 },
      2.99,
      FPS,
    );
    assert.equal(range?.outSeconds, 89 / FPS);
  });

  it("keeps at least one frame between the points", () => {
    assert.deepEqual(
      normalizeMediaRange({ inSeconds: 1, outSeconds: 1 }, 3, FPS, "in"),
      { inSeconds: 1, outSeconds: 31 / FPS },
    );
    assert.deepEqual(
      normalizeMediaRange({ inSeconds: 1, outSeconds: 1 }, 3, FPS, "out"),
      { inSeconds: 29 / FPS, outSeconds: 1 },
    );
  });

  it("is undefined for media shorter than a frame", () => {
    assert.equal(
      normalizeMediaRange({ inSeconds: 0, outSeconds: 1 }, FRAME / 2, FPS),
      undefined,
    );
  });
});

describe("setMediaRangePoint", () => {
  it("starts the other point at the matching end of the file", () => {
    const withIn = setMediaRangePoint(media(), "in", 1, 25);
    assert.deepEqual(mediaRangeOf(withIn), { inSeconds: 1, outSeconds: 3 });
    const withOut = setMediaRangePoint(media(), "out", 2, 25);
    assert.deepEqual(mediaRangeOf(withOut), { inSeconds: 0, outSeconds: 2 });
  });

  it("moves Out when In is set past it", () => {
    const item = media({ rangeInSeconds: 0.5, rangeOutSeconds: 1 });
    assert.deepEqual(mediaRangeOf(setMediaRangePoint(item, "in", 2, FPS)), {
      inSeconds: 2,
      outSeconds: 61 / FPS,
    });
  });

  it("moves In when Out is set before it", () => {
    const item = media({ rangeInSeconds: 1, rangeOutSeconds: 2 });
    assert.deepEqual(mediaRangeOf(setMediaRangePoint(item, "out", 0.5, FPS)), {
      inSeconds: 14 / FPS,
      outSeconds: 0.5,
    });
  });

  it("keeps a frame before the end when In is set at the end", () => {
    assert.deepEqual(mediaRangeOf(setMediaRangePoint(media(), "in", 3, FPS)), {
      inSeconds: 89 / FPS,
      outSeconds: 3,
    });
  });

  it("snaps to the media's nominal frame rate, not its measured one", () => {
    const item = media({ fps: 15.0017 });
    assert.equal(setMediaRangePoint(item, "in", 1, 30).rangeInSeconds, 1);
    assert.equal(mediaRangeFrameRate({ fps: 29.9701 }, 30), 30000 / 1001);
    assert.equal(mediaRangeFrameRate({ fps: 12.3456 }, 30), 12.346);
  });

  it("snaps to the project frame rate when the media has none", () => {
    const item = media({ kind: "audio", fps: undefined });
    assert.equal(
      setMediaRangePoint(item, "in", 0.03, 25).rangeInSeconds,
      1 / 25,
    );
  });

  it("returns the same item when nothing changes", () => {
    const item = media({ rangeInSeconds: 1, rangeOutSeconds: 2 });
    assert.equal(setMediaRangePoint(item, "in", 1.001, FPS), item);
  });
});

describe("clearMediaRange", () => {
  it("removes both points", () => {
    const cleared = clearMediaRange(
      media({ rangeInSeconds: 1, rangeOutSeconds: 2 }),
    );
    assert.equal("rangeInSeconds" in cleared, false);
    assert.equal("rangeOutSeconds" in cleared, false);
  });

  it("returns the same item without a range", () => {
    const item = media();
    assert.equal(clearMediaRange(item), item);
  });
});

describe("updateMediaItem", () => {
  it("returns the same list when the item is unchanged", () => {
    const items = [media(), media({ id: "b" })];
    assert.equal(
      updateMediaItem(items, "a", (item) => item),
      items,
    );
    assert.equal(updateMediaItem(items, "missing", clearMediaRange), items);
  });

  it("updates only the matching item", () => {
    const items = [media(), media({ id: "b" })];
    const next = updateMediaItem(items, "b", (item) =>
      setMediaRangePoint(item, "in", 1, FPS),
    );
    assert.notEqual(next, items);
    assert.equal(next[0], items[0]);
    assert.equal(next[1]?.rangeInSeconds, 1);
  });
});

describe("saving media ranges", () => {
  it("round-trips through a session by file path", () => {
    const saved = [
      media({ rangeInSeconds: 1, rangeOutSeconds: 2 }),
      media({ id: "b", sourcePath: "/media/other.mp4" }),
    ];
    const session = JSON.parse(
      JSON.stringify({ mediaRanges: savedMediaRanges(saved) }),
    ) as ProjectSession;
    assert.deepEqual(session.mediaRanges, [
      { path: "/media/take.mp4", inSeconds: 1, outSeconds: 2 },
    ]);

    // Media opens as placeholders with new ids and no duration yet.
    const reopened = restoreMediaRanges(
      [
        media({ id: "x", durationSeconds: 0, sourcePath: "\\MEDIA\\take.mp4" }),
        media({ id: "y", durationSeconds: 0, sourcePath: "/media/other.mp4" }),
      ],
      readSessionMediaRanges(session),
    );
    assert.deepEqual(mediaRangeOf(reopened[0] as MediaItem), {
      inSeconds: 1,
      outSeconds: 2,
    });
    assert.equal(hasMediaRange(reopened[1] as MediaItem), false);
  });

  it("skips malformed saved ranges", () => {
    const session = {
      mediaRanges: [
        { path: "/media/take.mp4", inSeconds: 2, outSeconds: 1 },
        { path: "", inSeconds: 0, outSeconds: 1 },
        { path: "/media/take.mp4", inSeconds: "0", outSeconds: 1 },
        null,
      ],
    } as unknown as ProjectSession;
    assert.deepEqual(readSessionMediaRanges(session), []);
  });
});
