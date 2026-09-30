import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PALETTE } from "./constants.ts";
import {
  basename,
  buildDraggedMediaKey,
  clamp,
  getSwatch,
  normalizeMediaPath,
  pickRandom,
  pluralize,
  sanitizeFilenameSegment,
  stripFilenameExtension,
} from "./util.ts";

describe("util", () => {
  it("clamps and pluralizes", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(pluralize(1, "clip"), "1 clip");
    assert.equal(pluralize(2, "clip"), "2 clips");
  });

  it("reads file names from either path separator", () => {
    assert.equal(basename("C:\\media\\take.mp4"), "take.mp4");
    assert.equal(basename("/media/take.mp4"), "take.mp4");
    assert.equal(basename(undefined), "");
    assert.equal(stripFilenameExtension("take.mp4"), "take");
    assert.equal(stripFilenameExtension(".mp4"), ".mp4");
    assert.equal(
      normalizeMediaPath("C:/Media/Take.MP4"),
      "c:\\media\\take.mp4",
    );
  });

  it("wraps swatches around the palette", () => {
    assert.equal(getSwatch(PALETTE.length), PALETTE[0]);
    assert.equal(getSwatch(-1), PALETTE[1]);
  });

  it("replaces characters filenames cannot hold", () => {
    assert.equal(sanitizeFilenameSegment('a:b/c*"d'), "a-b-c--d");
    assert.equal(sanitizeFilenameSegment("  "), "zvid-session");
  });

  it("keys dragged files by name, size and date", () => {
    const file = { name: "a.mp4", size: 3, lastModified: 7 } as File;
    assert.equal(buildDraggedMediaKey([file, file]), "a.mp4:3:7|a.mp4:3:7");
  });

  it("picks nothing from an empty list", () => {
    assert.equal(pickRandom([]), undefined);
    assert.equal(pickRandom(["only"]), "only");
  });
});
