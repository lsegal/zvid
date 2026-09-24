import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  AlsImportError,
  alsMasterAudioPath,
  alsMediaCandidatePaths,
  alsMediaSearchDirs,
  alsSavePath,
  createAlsMediaLocator,
  formatAlsImportSummary,
  type ImportedAlsSession,
  importAls,
  isAlsBackupPath,
  isAlsSession,
  isGzipBytes,
  probeAlsRecordings,
  rankWorkspaceSessions,
  resolveAlsMedia,
} from "./als-import.ts";

function gzip(text: string) {
  return new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
}

const LAYERS_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="Ableton Live 12.1">
  <LiveSet><Tracks><AudioTrack Id="8"><PluginDesc Name="Layers Record" /></AudioTrack></Tracks></LiveSet>
</Ableton>`;

function importedSession(): ImportedAlsSession {
  return {
    tracks: [
      {
        id: "8",
        name: "Vocals",
        recordings: [
          { filename: "video-1.mp4", frameStart: 0 },
          { filename: "video-2.mp4", frameStart: 57 },
        ],
      },
      {
        id: "12",
        name: "Keys",
        recordings: [{ filename: "video-3.mp4", frameStart: 0 }],
      },
    ],
    clips: [
      {
        id: "8-6",
        trackId: "8",
        frameStart: 0,
        frameCount: 317,
        filePath: "video-2.mp4",
      },
      {
        id: "12-4",
        trackId: "12",
        frameStart: 317,
        frameCount: 120,
        filePath: "video-3.mp4",
      },
    ],
    importReport: { skippedTracks: ["Drums", "Bass"] },
  };
}

describe("Live set detection", () => {
  it("sniffs the gzip magic rather than trusting the extension", () => {
    const set = gzip(LAYERS_SET);
    assert.equal(isGzipBytes(set), true);
    assert.equal(isAlsSession(set, "renamed.lvp"), true);
    assert.equal(isAlsSession(new TextEncoder().encode("{}"), "a.lvp"), false);
    assert.equal(isAlsSession(new Uint8Array([0x1f]), "a.lvp"), false);
  });

  it("routes an .als file with the wrong contents to the importer", () => {
    assert.equal(
      isAlsSession(new TextEncoder().encode("{}"), "C:\\Sets\\Song.ALS"),
      true,
    );
  });

  it("recognises Ableton's backup copies", () => {
    assert.equal(isAlsBackupPath("Song Project/Backup/Song [2026].als"), true);
    assert.equal(isAlsBackupPath("Song Project\\backup\\Song.als"), true);
    assert.equal(isAlsBackupPath("Song Project/Song.als"), false);
    assert.equal(isAlsBackupPath("Backup/notes.lvp"), false);
  });

  it("saves an imported set as the sibling .lvp", () => {
    assert.equal(
      alsSavePath("/sets/Song Project/Song.als"),
      "/sets/Song Project/Song.lvp",
    );
    assert.equal(alsSavePath("C:\\Sets\\Song.ALS"), "C:\\Sets\\Song.lvp");
  });
});

describe("rankWorkspaceSessions", () => {
  const entry = (path: string) => ({ path });

  it("prefers .lvp sessions over Live sets and JSON", () => {
    const ranked = rankWorkspaceSessions(
      ["a.json", "Song Project/Song.als", "dogfood3.lvp"].map(entry),
    );
    assert.deepEqual(ranked, [entry("dogfood3.lvp")]);
  });

  it("falls back to Live sets, ignoring Ableton backups", () => {
    const ranked = rankWorkspaceSessions(
      [
        "data.json",
        "Song Project/Backup/Song [2026-09-24 101500].als",
        "Song Project/Song.als",
      ].map(entry),
    );
    assert.deepEqual(ranked, [entry("Song Project/Song.als")]);
  });

  it("falls back to JSON when only backups exist", () => {
    const ranked = rankWorkspaceSessions(
      ["Backup/Song.als", "session.json"].map(entry),
    );
    assert.deepEqual(ranked, [entry("session.json")]);
  });
});

describe("importAls", () => {
  async function importError(bytes: Uint8Array, path = "Song.als") {
    try {
      await importAls(bytes, path);
    } catch (error) {
      assert.ok(error instanceof AlsImportError);
      return error.message;
    }
    assert.fail("expected the import to fail");
  }

  it("rejects a file that is not gzip-compressed", async () => {
    const message = await importError(new TextEncoder().encode("{}"));
    assert.match(message, /Song\.als is not an Ableton Live set/);
  });

  it("rejects a truncated set", async () => {
    const set = gzip(LAYERS_SET);
    const message = await importError(set.subarray(0, 20));
    assert.match(message, /could not be decompressed/);
  });

  it("rejects gzip data that is not a Live set", async () => {
    const message = await importError(gzip("<html></html>"));
    assert.match(message, /is not an Ableton Live set/);
  });

  it("rejects a Live set without Layers tracks", async () => {
    const message = await importError(
      gzip('<?xml version="1.0"?><Ableton><LiveSet /></Ableton>'),
      "/sets/Plain.als",
    );
    assert.match(message, /Plain\.als has no tracks with the Layers Record/);
  });

  it("rejects a set whose structure cannot be read", async () => {
    const message = await importError(gzip(LAYERS_SET));
    assert.match(message, /Song\.als could not be read: .*master track/);
  });

  it("rejects a set that only mentions Layers outside its tracks", async () => {
    const message = await importError(
      gzip(`<?xml version="1.0"?>
<Ableton><LiveSet>
  <Tracks />
  <MainTrack><DeviceChain><Mixer><Tempo><Manual Value="120" /></Tempo></Mixer></DeviceChain></MainTrack>
  <Annotation Value="Layers Record" />
</LiveSet></Ableton>`),
    );
    assert.match(message, /Song\.als has no tracks with the Layers Record/);
  });

  it("converts dogfood3.als into the timeline of dogfood3.lvp", async () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`../test/fixtures/als/${name}`, import.meta.url));
    const golden = JSON.parse(fixture("dogfood3.lvp").toString("utf8"));
    const alsPath = "/sets/dogfood3 Project/dogfood3.als";
    const imported = await importAls(
      new Uint8Array(fixture("dogfood3.als")),
      alsPath,
    );

    assert.equal(imported.sessionFile, alsPath);
    assert.deepEqual(
      imported.tracks?.map((track) => track.name),
      golden.tracks.map((track: { name: string }) => track.name),
    );
    assert.equal(imported.timeline?.fps, golden.timeline.fps);
    assert.equal(
      imported.timeline?.projectDuration,
      golden.timeline.projectDuration,
    );
    // Layers stored bare filenames for the harnesses to resolve.
    for (const clip of imported.clips ?? []) {
      assert.equal(clip.filePath, clip.filePath.split(/[/\\]/).at(-1));
    }
    assert.deepEqual(imported.importReport, {
      skippedTracks: [
        "4-Audio (no Layers Record)",
        "Audio 11 on 3-Audio (shorter than a frame)",
      ],
    });

    // Every recording but one sits in the project's sibling Recorded folder.
    const missing = "video-12-13-23-20-19-23-2.mp4";
    const { session, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(
        alsMediaSearchDirs(alsPath, "/docs"),
        (path) => path.startsWith("/sets/Recorded/") && !path.endsWith(missing),
      ),
    );
    assert.deepEqual(summary, {
      tracks: 3,
      // dogfood3.lvp's fourth clip, 16-3, is shorter than a frame.
      clips: golden.clips.length - 1,
      skippedTracks: imported.importReport?.skippedTracks,
      missingMedia: [missing],
    });
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      [
        "/sets/Recorded/video-12-13-23-21-6-51-0.mp4",
        "/sets/Recorded/video-12-13-23-20-15-14-1.mp4",
        missing,
      ],
    );
    assert.equal(imported.audioFilename, undefined);
  });

  it("opens dogfood3.wav beside dogfood3.als as master audio", async () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("../test/fixtures/als/dogfood3.lvp", import.meta.url),
      ).toString("utf8"),
    );
    const alsPath = golden.audioFilename.replace(/\.wav$/, ".als");
    const audioFilename = alsMasterAudioPath(alsPath, () => true);
    assert.equal(audioFilename, golden.audioFilename);

    const imported = await importAls(
      new Uint8Array(
        readFileSync(
          new URL("../test/fixtures/als/dogfood3.als", import.meta.url),
        ),
      ),
      alsPath,
      { audioFilename },
    );
    assert.equal(imported.audioFilename, golden.audioFilename);

    const { session } = resolveAlsMedia(imported, () => null);
    assert.equal(session.audioFilename, golden.audioFilename);
  });
});

describe("alsMasterAudioPath", () => {
  it("finds the .wav mixdown beside the set", () => {
    const checked: string[] = [];
    const found = alsMasterAudioPath("/sets/Song Project/Song.als", (path) => {
      checked.push(path);
      return true;
    });
    assert.equal(found, "/sets/Song Project/Song.wav");
    assert.deepEqual(checked, ["/sets/Song Project/Song.wav"]);
  });

  it("opens without master audio when there is no mixdown", () => {
    assert.equal(
      alsMasterAudioPath("/sets/Song Project/Song.als", () => false),
      undefined,
    );
  });

  it("opens without master audio when the set has no known path", () => {
    assert.equal(
      alsMasterAudioPath(undefined, () => true),
      undefined,
    );
  });
});

describe("Live set media resolution", () => {
  it("searches the set folder, the sibling Recorded folder, then Documents", () => {
    assert.deepEqual(
      alsMediaSearchDirs(
        "/Users/me/Music/Song Project/Song.als",
        "/Users/me/Documents",
      ),
      [
        "/Users/me/Music/Song Project",
        "/Users/me/Music/Recorded",
        "/Users/me/Documents/Layers/Recorded",
      ],
    );
    assert.deepEqual(
      alsMediaSearchDirs(
        "C:\\Music\\Song Project\\Song.als",
        "C:\\Users\\me\\Documents",
      ),
      [
        "C:\\Music\\Song Project",
        "C:\\Music\\Recorded",
        "C:\\Users\\me\\Documents\\Layers\\Recorded",
      ],
    );
    assert.deepEqual(alsMediaSearchDirs(undefined, "/home/me/Documents"), [
      "/home/me/Documents/Layers/Recorded",
    ]);
  });

  it("locates each file in the first folder that has it", () => {
    const dirs = ["/set", "/Recorded", "/docs/Layers/Recorded"];
    const existing = new Set([
      "/Recorded/video-1.mp4",
      "/set/video-1.mp4",
      "/docs/Layers/Recorded/video-2.mp4",
    ]);
    const locate = createAlsMediaLocator(dirs, (path) => existing.has(path));

    assert.equal(locate("video-1.mp4"), "/set/video-1.mp4");
    assert.equal(locate("video-2.mp4"), "/docs/Layers/Recorded/video-2.mp4");
    assert.equal(locate("video-3.mp4"), null);
  });

  it("lists every candidate path for a batch existence check", () => {
    assert.deepEqual(alsMediaCandidatePaths(importedSession(), ["/a", "/b"]), [
      "/a/video-1.mp4",
      "/b/video-1.mp4",
      "/a/video-2.mp4",
      "/b/video-2.mp4",
      "/a/video-3.mp4",
      "/b/video-3.mp4",
    ]);
  });

  it("points recordings and clips at located files and reports the rest", () => {
    const located: Record<string, string> = {
      "video-1.mp4": "/rec/video-1.mp4",
      "video-2.mp4": "/rec/video-2.mp4",
    };
    const { session, recordingPaths, summary } = resolveAlsMedia(
      importedSession(),
      (name) => located[name] ?? null,
    );

    assert.deepEqual(
      session.tracks?.map((track) =>
        track.recordings?.map((recording) => recording.filename),
      ),
      [["/rec/video-1.mp4", "/rec/video-2.mp4"], ["video-3.mp4"]],
    );
    assert.equal(session.tracks?.[0].recordings?.[1].frameStart, 57);
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      ["/rec/video-2.mp4", "video-3.mp4"],
    );
    assert.deepEqual(recordingPaths, ["/rec/video-1.mp4", "/rec/video-2.mp4"]);
    assert.deepEqual(summary, {
      tracks: 2,
      clips: 2,
      skippedTracks: ["Drums", "Bass"],
      missingMedia: ["video-3.mp4"],
    });
    assert.equal("importReport" in session, false);
  });

  it("fills frame metadata from probes and skips files it cannot read", async () => {
    const { session } = resolveAlsMedia(importedSession(), (name) =>
      name === "video-3.mp4" ? null : `/rec/${name}`,
    );
    const probed = await probeAlsRecordings(
      session,
      [
        { path: "/rec/video-1.mp4", url: "blob:1", exists: true },
        { path: "/rec/video-2.mp4", url: "blob:2", exists: true },
        { path: "video-3.mp4", url: "", exists: false },
      ],
      async (url) => {
        if (url === "blob:2") {
          throw new Error("unreadable");
        }
        return { numFrames: 2043, frameRate: 30 };
      },
    );

    assert.deepEqual(probed.tracks?.[0].recordings, [
      {
        filename: "/rec/video-1.mp4",
        frameStart: 0,
        numFrames: 2043,
        frameRate: 30,
      },
      { filename: "/rec/video-2.mp4", frameStart: 57 },
    ]);
    assert.deepEqual(probed.tracks?.[1].recordings, [
      { filename: "video-3.mp4", frameStart: 0 },
    ]);
  });
});

describe("formatAlsImportSummary", () => {
  it("summarises imported, skipped and missing items", () => {
    assert.deepEqual(
      formatAlsImportSummary({
        tracks: 3,
        clips: 1,
        skippedTracks: ["Drums (no Layers Record)"],
        missingMedia: ["a.mp4", "b.mp4"],
      }),
      [
        "Imported 3 tracks and 1 clip.",
        "Skipped 1 track or clip: Drums (no Layers Record).",
        "2 media files could not be found and will open offline: a.mp4, b.mp4.",
      ],
    );
  });

  it("omits empty sections", () => {
    assert.deepEqual(
      formatAlsImportSummary({
        tracks: 1,
        clips: 4,
        skippedTracks: [],
        missingMedia: [],
      }),
      ["Imported 1 track and 4 clips."],
    );
  });
});
