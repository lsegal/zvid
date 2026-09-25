import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  collectSessionMediaPaths,
  formatClipsWithoutFile,
  type LvpSession,
  normalizeLvpSession,
} from "./session.ts";

// A clip as a session file may hold it: parsed JSON, so `filePath` can be
// missing or not a string despite the type.
function clip(id: string, filePath: unknown, name?: string) {
  return {
    id,
    trackId: "1",
    name,
    frameStart: 0,
    frameCount: 30,
    filePath,
  } as unknown as NonNullable<LvpSession["clips"]>[number];
}

describe("normalizeLvpSession", () => {
  it("turns a clip without a filePath into a reported placeholder", () => {
    const { session, clipsWithoutFile } = normalizeLvpSession({
      clips: [
        clip("a", "C:\\media\\a.mov"),
        clip("b", undefined, "Bass"),
        clip("c", null),
        clip("d", ""),
      ],
    });

    assert.deepEqual(
      session.clips?.map((entry) => entry.filePath),
      ["C:\\media\\a.mov", "", "", ""],
    );
    // An empty path is an intentional placeholder, so only clips whose path
    // is missing are reported.
    assert.deepEqual(clipsWithoutFile, ["Bass", "c"]);
    assert.deepEqual(collectSessionMediaPaths(session), ["C:\\media\\a.mov"]);
  });

  it("drops non-string recording filenames and main audio", () => {
    const { session } = normalizeLvpSession({
      tracks: [
        {
          id: "1",
          name: "Video",
          recordings: [
            { filename: "take.mov" },
            { filename: undefined as unknown as string },
          ],
        },
      ],
      audioFilename: 42 as unknown as string,
    });

    assert.deepEqual(
      session.tracks?.[0]?.recordings?.map((recording) => recording.filename),
      ["take.mov", ""],
    );
    assert.equal(session.audioFilename, undefined);
  });

  it("leaves a well-formed session file unchanged", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../test/fixtures/als/dogfood3.lvp", import.meta.url),
        "utf8",
      ),
    ) as LvpSession;
    const { session, clipsWithoutFile } = normalizeLvpSession(fixture);

    assert.deepEqual(session, fixture);
    assert.deepEqual(clipsWithoutFile, []);
  });
});

describe("collectSessionMediaPaths", () => {
  it("skips clips whose filePath is missing or not a string", () => {
    const session = {
      clips: [clip("a", "a.mov"), clip("b", undefined), clip("c", 7)],
    } as LvpSession;

    assert.deepEqual(collectSessionMediaPaths(session), ["a.mov"]);
  });
});

describe("formatClipsWithoutFile", () => {
  it("names the clips that opened as placeholders", () => {
    assert.equal(
      formatClipsWithoutFile(["Bass"]),
      "1 clip has no media file and opened as a placeholder: Bass.",
    );
    assert.equal(
      formatClipsWithoutFile(["Bass", "Keys"]),
      "2 clips have no media file and opened as placeholders: Bass, Keys.",
    );
  });
});
