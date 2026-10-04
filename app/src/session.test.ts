import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  clipSourceFrame,
  collectSessionMediaPaths,
  formatClipsWithoutFile,
  type ProjectSession,
  normalizeSession,
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
  } as unknown as NonNullable<ProjectSession["clips"]>[number];
}

describe("normalizeSession", () => {
  it("turns a clip without a filePath into a reported placeholder", () => {
    const { session, clipsWithoutFile } = normalizeSession({
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
    const { session } = normalizeSession({
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
    ) as ProjectSession;
    const { session, clipsWithoutFile } = normalizeSession(fixture);

    assert.deepEqual(session, fixture);
    assert.deepEqual(clipsWithoutFile, []);
  });
});

describe("collectSessionMediaPaths", () => {
  it("skips clips whose filePath is missing or not a string", () => {
    const session = {
      clips: [clip("a", "a.mov"), clip("b", undefined), clip("c", 7)],
    } as ProjectSession;

    assert.deepEqual(collectSessionMediaPaths(session), ["a.mov"]);
  });

  it("includes the SVGs Custom shapes take their masks from", () => {
    const session: ProjectSession = {
      clips: [clip("a", "a.mov")],
      effects: [
        {
          id: "s",
          trackId: "lane-1",
          effectName: "Shape",
          parameters: { Shape: { stringValue: "Custom:C:\\art\\logo.svg" } },
        },
        {
          id: "t",
          trackId: "lane-2",
          effectName: "Shape",
          parameters: { Shape: { stringValue: "Star" } },
        },
      ],
    };

    assert.deepEqual(collectSessionMediaPaths(session), [
      "a.mov",
      "C:\\art\\logo.svg",
    ]);
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

describe("clipSourceFrame", () => {
  // Shaped like the Layers app's reference export at 72 BPM and 30 fps,
  // where a clip's file frame is clipStart + frameOffset + captureOffset.
  const referenceClip = (
    fields: Partial<NonNullable<ProjectSession["clips"]>[number]>,
  ) => ({ ...clip("a", "take.mp4"), frameOffset: 0, ...fields });

  it("adds the capture offset to the content start", () => {
    // Loop start at beat 48 (40 s), recorded 393 frames into the file:
    // 53.1 s.
    assert.equal(
      clipSourceFrame(referenceClip({ clipStart: 1200, captureOffset: 393 })),
      1593,
    );
    // A MIDI clip from its content start, on a recording 241 frames in.
    assert.equal(
      clipSourceFrame(referenceClip({ clipStart: 0, captureOffset: 241 })),
      241,
    );
    assert.equal(
      clipSourceFrame(
        referenceClip({ clipStart: 375, frameOffset: 15, captureOffset: 207 }),
      ),
      597,
    );
  });

  it("treats the imported-video sentinel as no offset", () => {
    assert.equal(
      clipSourceFrame(referenceClip({ clipStart: 90, captureOffset: -1 })),
      90,
    );
  });

  it("defaults missing fields and never goes before the file start", () => {
    assert.equal(clipSourceFrame(clip("a", "take.mp4")), 0);
    assert.equal(
      clipSourceFrame(referenceClip({ clipStart: 10, captureOffset: -60 })),
      0,
    );
  });
});
