import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "./media.ts";
import { readProjectArchive } from "./project-archive.ts";
import {
  assignArchiveMediaPaths,
  buildProjectArchive,
  collectLinkedMediaPaths,
  rewriteSessionMediaPaths,
} from "./project-archive-export.ts";
import type { LvpSession } from "./session.ts";

function clip(id: string, filePath: string) {
  return { id, trackId: "track-1", frameStart: 0, frameCount: 30, filePath };
}

const SESSION: LvpSession = {
  tracks: [
    {
      id: "track-1",
      name: "Cam 1",
      recordings: [
        { filename: "C:\\takes\\cam.mp4" },
        { filename: "D:/other/cam.MP4" },
      ],
    },
  ],
  clips: [
    clip("clip-1", "C:\\takes\\cam.mp4"),
    clip("clip-2", "c:/takes/CAM.mp4"),
    clip("clip-3", "/music/song.wav"),
    clip("clip-4", ""),
  ],
  mediaRanges: [{ path: "/music/song.wav", inSeconds: 1, outSeconds: 2 }],
  effects: [
    {
      id: "shape",
      trackId: "lane-1",
      effectName: "Shape",
      parameters: { Shape: { stringValue: "Custom:/art/logo.svg" } },
    },
    {
      id: "text",
      trackId: "lane-1",
      effectName: "Text",
      parameters: { Text: { stringValue: "Custom:/art/logo.svg" } },
    },
  ],
};

function mediaItem(id: string, name: string, sourcePath: string) {
  return { id, name, sourcePath } as MediaItem;
}

const MEDIA_ITEMS = [
  mediaItem("cam", "cam.mp4", "C:\\takes\\cam.mp4"),
  mediaItem("other", "cam.MP4", "D:/other/cam.MP4"),
  mediaItem("song", "song.wav", "/music/song.wav"),
  mediaItem("logo", "logo.svg", "/art/logo.svg"),
];

async function textOf(file: Blob) {
  return new TextDecoder().decode(await file.arrayBuffer());
}

describe("collectLinkedMediaPaths", () => {
  it("lists each clip, recording and main audio path once", () => {
    assert.deepEqual(
      collectLinkedMediaPaths({ ...SESSION, audioFilename: " old.wav " }),
      [
        "C:\\takes\\cam.mp4",
        "/music/song.wav",
        "D:/other/cam.MP4",
        "/art/logo.svg",
        "old.wav",
      ],
    );
  });
});

describe("assignArchiveMediaPaths", () => {
  it("puts each file under media/ and numbers filenames two paths share", () => {
    const assigned = assignArchiveMediaPaths([
      "C:\\takes\\cam.mp4",
      "D:/other/cam.MP4",
      "/music/song.wav",
      "/more/cam.mp4",
      "..",
    ]);
    assert.deepEqual(Array.from(assigned.values()), [
      "media/cam.mp4",
      "media/cam-2.MP4",
      "media/song.wav",
      "media/cam-3.mp4",
      "media/media",
    ]);
  });
});

describe("rewriteSessionMediaPaths", () => {
  it("rewrites every spelling of a mapped path, its ranges included", () => {
    const rewritten = rewriteSessionMediaPaths(
      SESSION,
      assignArchiveMediaPaths(["C:\\takes\\cam.mp4", "/music/song.wav"]),
    );
    assert.deepEqual(
      rewritten.clips?.map((entry) => entry.filePath),
      ["media/cam.mp4", "media/cam.mp4", "media/song.wav", ""],
    );
    assert.deepEqual(
      rewritten.tracks?.[0]?.recordings?.map((entry) => entry.filename),
      ["media/cam.mp4", "D:/other/cam.MP4"],
    );
    assert.deepEqual(rewritten.mediaRanges, [
      { path: "media/song.wav", inSeconds: 1, outSeconds: 2 },
    ]);
    // Only a Custom shape's SVG is a path; other text is left alone.
    const shapeRewrite = rewriteSessionMediaPaths(
      SESSION,
      assignArchiveMediaPaths(["/art/logo.svg"]),
    );
    assert.deepEqual(
      shapeRewrite.effects?.map((effect) => effect.parameters),
      [
        { Shape: { stringValue: "Custom:media/logo.svg" } },
        { Text: { stringValue: "Custom:/art/logo.svg" } },
      ],
    );
    assert.equal(SESSION.clips?.[0]?.filePath, "C:\\takes\\cam.mp4");
  });
});

describe("buildProjectArchive", () => {
  it("writes only project.json, paths unchanged, without media", async () => {
    let reads = 0;
    const { blob, skipped } = await buildProjectArchive({
      session: SESSION,
      includeMedia: false,
      mediaItems: MEDIA_ITEMS,
      readMedia: async () => {
        reads += 1;
        return new Blob(["x"]);
      },
    });
    assert.equal(blob.type, "application/gzip");
    const archive = await readProjectArchive(
      new Uint8Array(await blob.arrayBuffer()),
    );
    assert.deepEqual(archive.project, SESSION);
    assert.deepEqual(archive.media, []);
    assert.deepEqual(skipped, []);
    assert.equal(reads, 0);
  });

  it("bundles each readable file once and keeps offline paths", async () => {
    const { blob, skipped } = await buildProjectArchive({
      session: SESSION,
      includeMedia: true,
      mediaItems: MEDIA_ITEMS,
      readMedia: async (item) => {
        if (item.id === "song") throw new Error("offline");
        return new Blob([`bytes of ${item.id}`]);
      },
    });
    const archive = await readProjectArchive(
      new Uint8Array(await blob.arrayBuffer()),
    );
    assert.deepEqual(
      await Promise.all(
        archive.media.map(async (entry) => [
          entry.path,
          await textOf(entry.file),
        ]),
      ),
      [
        ["media/cam.mp4", "bytes of cam"],
        ["media/cam-2.MP4", "bytes of other"],
        ["media/logo.svg", "bytes of logo"],
      ],
    );
    assert.equal(
      archive.project.effects?.[0]?.parameters?.Shape?.stringValue,
      "Custom:media/logo.svg",
    );
    assert.deepEqual(
      archive.project.clips?.map((entry) => entry.filePath),
      ["media/cam.mp4", "media/cam.mp4", "/music/song.wav", ""],
    );
    assert.deepEqual(
      archive.project.tracks?.[0]?.recordings?.map((entry) => entry.filename),
      ["media/cam.mp4", "media/cam-2.MP4"],
    );
    assert.deepEqual(skipped, ["/music/song.wav"]);
  });

  it("skips paths no media item matches", async () => {
    const { skipped } = await buildProjectArchive({
      session: { clips: [clip("clip-1", "/gone/missing.mp4")] },
      includeMedia: true,
      mediaItems: MEDIA_ITEMS,
      readMedia: async () => new Blob(["x"]),
    });
    assert.deepEqual(skipped, ["/gone/missing.mp4"]);
  });
});
