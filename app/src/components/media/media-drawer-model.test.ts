import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MEDIA_DRAWER_PREFS,
  describeMediaKind,
  filterMediaItems,
  formatMediaDuration,
  formatMediaItemCount,
  getListIconSize,
  getMediaDrawerMaxWidth,
  getNextMediaIndex,
  MEDIA_DRAWER_FALLBACK_MAX_WIDTH,
  MEDIA_DRAWER_MIN_WIDTH,
  middleEllipsis,
  parseMediaDrawerPrefs,
  THUMBNAIL_SIZE_MAX,
  THUMBNAIL_SIZE_MIN,
} from "./media-drawer-model.ts";

describe("media drawer search", () => {
  const items = [
    { name: "Screen Shot 2026-09-30 at 20.57.34.mov" },
    { name: "drums.WAV" },
    { name: "B-roll street.mp4" },
  ];

  it("matches names case-insensitively", () => {
    assert.deepEqual(
      filterMediaItems(items, "wav").map((item) => item.name),
      ["drums.WAV"],
    );
    assert.deepEqual(
      filterMediaItems(items, "  SCREEN ").map((item) => item.name),
      ["Screen Shot 2026-09-30 at 20.57.34.mov"],
    );
  });

  it("returns every item for an empty query", () => {
    assert.equal(filterMediaItems(items, "").length, 3);
    assert.equal(filterMediaItems(items, "   ").length, 3);
  });

  it("returns nothing when no name matches", () => {
    assert.deepEqual(filterMediaItems(items, "zzz"), []);
  });
});

describe("media drawer item count", () => {
  it("counts every item when not searching", () => {
    assert.equal(formatMediaItemCount(3, 3, false), "3 items");
    assert.equal(formatMediaItemCount(1, 1, false), "1 item");
    assert.equal(formatMediaItemCount(0, 0, false), "0 items");
  });

  it("counts the matches out of the total while searching", () => {
    assert.equal(formatMediaItemCount(1, 3, true), "1 of 3 items");
    assert.equal(formatMediaItemCount(0, 1, true), "0 of 1 item");
  });
});

describe("middle ellipsis", () => {
  it("keeps names that fit", () => {
    assert.equal(middleEllipsis("clip.mp4", 8), "clip.mp4");
    assert.equal(middleEllipsis("clip.mp4", 20), "clip.mp4");
  });

  it("drops characters from the middle, keeping the start and end", () => {
    const shortened = middleEllipsis(
      "Screen Shot 2026-09-30 at 20.57.34.mov",
      20,
    );
    assert.equal(shortened, "Screen Sho…57.34.mov");
    assert.equal(Array.from(shortened).length, 20);
  });

  it("handles tiny budgets", () => {
    assert.equal(middleEllipsis("abcdef", 1), "…");
    assert.equal(middleEllipsis("abcdef", 2), "a…");
    assert.equal(middleEllipsis("abcdef", 3), "a…f");
  });

  it("does not split surrogate pairs", () => {
    assert.equal(middleEllipsis("🎬🎬🎬🎬🎬🎬", 3), "🎬…🎬");
  });
});

describe("media drawer prefs", () => {
  it("defaults to a closed drawer", () => {
    assert.deepEqual(parseMediaDrawerPrefs(null), DEFAULT_MEDIA_DRAWER_PREFS);
    assert.equal(DEFAULT_MEDIA_DRAWER_PREFS.open, false);
  });

  it("reads stored values", () => {
    assert.deepEqual(
      parseMediaDrawerPrefs(
        JSON.stringify({
          open: true,
          width: 333,
          view: "list",
          thumbnailSize: 200,
        }),
      ),
      { open: true, width: 333, view: "list", thumbnailSize: 200 },
    );
  });

  it("falls back per field for bad values", () => {
    assert.deepEqual(
      parseMediaDrawerPrefs(
        JSON.stringify({
          open: "yes",
          width: 10,
          view: "tiles",
          thumbnailSize: 9999,
        }),
      ),
      {
        open: false,
        width: MEDIA_DRAWER_MIN_WIDTH,
        view: "icons",
        thumbnailSize: THUMBNAIL_SIZE_MAX,
      },
    );
    assert.deepEqual(
      parseMediaDrawerPrefs("{not json"),
      DEFAULT_MEDIA_DRAWER_PREFS,
    );
    assert.deepEqual(parseMediaDrawerPrefs("[]"), DEFAULT_MEDIA_DRAWER_PREFS);
  });

  it("caps the width at a share of the editor", () => {
    assert.equal(getMediaDrawerMaxWidth(0), MEDIA_DRAWER_FALLBACK_MAX_WIDTH);
    assert.equal(getMediaDrawerMaxWidth(1000), 450);
    assert.equal(getMediaDrawerMaxWidth(300), MEDIA_DRAWER_MIN_WIDTH);
  });

  it("maps the thumbnail slider onto list icon sizes", () => {
    assert.equal(getListIconSize(THUMBNAIL_SIZE_MIN), 16);
    assert.equal(getListIconSize(THUMBNAIL_SIZE_MAX), 48);
    assert.equal(getListIconSize(160), 32);
  });
});

describe("media kind and duration", () => {
  it("describes what the media holds", () => {
    assert.equal(
      describeMediaKind({ kind: "video", hasVideo: true, hasAudio: true }),
      "Video + Audio",
    );
    assert.equal(
      describeMediaKind({ kind: "video", hasVideo: true, hasAudio: false }),
      "Video",
    );
    assert.equal(
      describeMediaKind({ kind: "audio", hasVideo: false, hasAudio: true }),
      "Audio",
    );
  });

  it("formats durations", () => {
    assert.equal(formatMediaDuration(0), "0:00");
    assert.equal(formatMediaDuration(7.4), "0:07");
    assert.equal(formatMediaDuration(65), "1:05");
    assert.equal(formatMediaDuration(3909), "1:05:09");
    assert.equal(formatMediaDuration(Number.NaN), "0:00");
  });
});

describe("media drawer keyboard navigation", () => {
  it("moves one item at a time in a list", () => {
    assert.equal(getNextMediaIndex("ArrowDown", 0, 3, 1), 1);
    assert.equal(getNextMediaIndex("ArrowUp", 1, 3, 1), 0);
    assert.equal(getNextMediaIndex("ArrowDown", 2, 3, 1), 2);
    assert.equal(getNextMediaIndex("ArrowUp", 0, 3, 1), 0);
  });

  it("moves by rows in a grid", () => {
    assert.equal(getNextMediaIndex("ArrowDown", 1, 10, 4), 5);
    assert.equal(getNextMediaIndex("ArrowDown", 7, 10, 4), 9);
    assert.equal(getNextMediaIndex("ArrowUp", 5, 10, 4), 1);
    assert.equal(getNextMediaIndex("ArrowRight", 3, 10, 4), 4);
    assert.equal(getNextMediaIndex("ArrowLeft", 4, 10, 4), 3);
  });

  it("jumps to the ends", () => {
    assert.equal(getNextMediaIndex("Home", 5, 10, 4), 0);
    assert.equal(getNextMediaIndex("End", 5, 10, 4), 9);
  });

  it("starts from the first item when nothing is selected", () => {
    assert.equal(getNextMediaIndex("ArrowDown", -1, 3, 1), 0);
    assert.equal(getNextMediaIndex("End", -1, 3, 1), 2);
  });

  it("ignores other keys and empty lists", () => {
    assert.equal(getNextMediaIndex("a", 0, 3, 1), undefined);
    assert.equal(getNextMediaIndex("ArrowDown", 0, 0, 1), undefined);
  });
});
