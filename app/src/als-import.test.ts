import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  AlsImportError,
  alsMainAudioPath,
  alsMediaCandidatePaths,
  alsMediaSearchDirs,
  alsRecordDirLocator,
  alsRecordRootDir,
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
import type { LvpSession } from "./session.ts";

function gzip(text: string) {
  return new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
}

const LAYERS_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="Ableton Live 12.1">
  <LiveSet><Tracks><AudioTrack Id="8"><PluginDesc Name="Layers Record" /></AudioTrack></Tracks></LiveSet>
</Ableton>`;

// A Live 12 set shaped like dogfood7.als: MIDI tracks without any plugins at
// 120 BPM in 4/4, whose clips loop a 4-beat pattern.
function midiOnlySet(
  tracks: Array<{ name: string; start: number; end: number }>,
) {
  const clip = (start: number, end: number) => `
    <MidiClip Id="0" Time="${start}">
      <CurrentStart Value="${start}" /><CurrentEnd Value="${end}" />
      <Loop>
        <LoopStart Value="0" /><LoopEnd Value="4" /><StartRelative Value="0" />
        <LoopOn Value="true" />
        <HiddenLoopStart Value="0" /><HiddenLoopEnd Value="4" />
      </Loop>
      <Name Value="" /><Disabled Value="false" />
    </MidiClip>`;
  const midiTracks = tracks.map(
    (track, index) => `
    <MidiTrack Id="${index + 10}">
      <Name><EffectiveName Value="${track.name}" /></Name>
      <DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
        ${clip(track.start, track.end)}
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain>
    </MidiTrack>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0b29">
  <LiveSet>
    <Tracks>${midiTracks.join("")}</Tracks>
    <MainTrack><DeviceChain><Mixer>
      <Tempo><Manual Value="120" /></Tempo>
      <TimeSignature><Manual Value="201" /></TimeSignature>
    </Mixer></DeviceChain></MainTrack>
    <Transport>
      <CurrentTime Value="0" /><LoopOn Value="false" />
      <LoopStart Value="0" /><LoopLength Value="16" />
    </Transport>
  </LiveSet>
</Ableton>`;
}

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

  it("rejects a set whose structure cannot be read", async () => {
    const message = await importError(gzip(LAYERS_SET));
    assert.match(message, /Song\.als could not be read: .*main track/);
  });

  it("imports a set without Layers tracks as placeholder clips", async () => {
    const imported = await importAls(
      gzip(
        midiOnlySet([
          { name: "1-Kit", start: 0, end: 16 },
          { name: "2-Bass", start: 0, end: 16 },
          { name: "3-Keys", start: 0, end: 16 },
          { name: "4-Pad", start: 0, end: 16 },
          { name: "5-808 Pure", start: 8, end: 12 },
          { name: "6-Lead", start: 0, end: 16 },
        ]),
      ),
      "/sets/dogfood3 Project/dogfood7.als",
    );

    assert.equal(imported.tracks?.length, 6);
    assert.deepEqual(imported.importReport, {
      skippedTracks: [],
      hasLayersVideo: false,
    });
    assert.equal(imported.timeline?.bpm, 120);
    // 120 BPM at the default 30 fps: one beat is 15 frames.
    const segments = (trackName: string) => {
      const track = imported.tracks?.find((entry) => entry.name === trackName);
      return imported.clips
        ?.filter((clip) => clip.trackId === track?.id)
        .map((clip) => [clip.frameStart / 15, clip.frameCount / 15]);
    };
    assert.deepEqual(segments("1-Kit"), [
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4],
    ]);
    assert.deepEqual(segments("5-808 Pure"), [[8, 4]]);
    assert.ok(imported.clips?.every((clip) => clip.filePath === ""));
    // The arrangement opens empty for the user to build.
    assert.deepEqual(imported.mainTracks, [
      { id: "1", name: "Layer 1", colorIndex: -1 },
    ]);
    assert.deepEqual(imported.selections, []);

    const { summary } = resolveAlsMedia(imported, () => null);
    assert.deepEqual(summary, {
      tracks: 6,
      clips: 21,
      skippedTracks: [],
      missingMedia: [],
      noLayersVideo: true,
    });
    assert.deepEqual(formatAlsImportSummary(summary, "dogfood7.als"), [
      "No Layers video in dogfood7.als. Imported 6 tracks and 21 clips as placeholders.",
    ]);
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
    // Like the Layers app, it drops 4-Audio, which has no video.
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
    assert.deepEqual(imported.mainTracks, [
      { id: "1", name: "Layer 1", colorIndex: -1 },
    ]);
    assert.deepEqual(imported.selections, []);
    assert.deepEqual(imported.importReport, {
      skippedTracks: ["Audio 11 on 3-Audio (shorter than a frame)"],
      hasLayersVideo: true,
      layersRecordTracks: ["12", "8", "16"],
    });

    // Every recording but one sits in the project's sibling Recorded folder.
    const missing = "video-12-13-23-20-19-23-2.mp4";
    const { session, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(
        alsMediaSearchDirs(alsPath, "/docs"),
        (path) =>
          path.startsWith("/sets/Recorded/video-") && !path.endsWith(missing),
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

  it("opens dogfood3.wav beside dogfood3.als as main audio", async () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("../test/fixtures/als/dogfood3.lvp", import.meta.url),
      ).toString("utf8"),
    );
    const alsPath = golden.audioFilename.replace(/\.wav$/, ".als");
    const audioFilename = alsMainAudioPath(alsPath, () => true);
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

describe("alsMainAudioPath", () => {
  it("finds the .wav mixdown beside the set", () => {
    const checked: string[] = [];
    const found = alsMainAudioPath("/sets/Song Project/Song.als", (path) => {
      checked.push(path);
      return true;
    });
    assert.equal(found, "/sets/Song Project/Song.wav");
    assert.deepEqual(checked, ["/sets/Song Project/Song.wav"]);
  });

  it("opens without main audio when there is no mixdown", () => {
    assert.equal(
      alsMainAudioPath("/sets/Song Project/Song.als", () => false),
      undefined,
    );
  });

  it("opens without main audio when the set has no known path", () => {
    assert.equal(
      alsMainAudioPath(undefined, () => true),
      undefined,
    );
  });

  it("resolves dogfood3.als from Windows paths the way the Tauri harness does", async () => {
    const alsPath = "C:\\Music\\dogfood3 Project\\dogfood3.als";
    const imported = await importAls(
      new Uint8Array(
        readFileSync(
          new URL("../test/fixtures/als/dogfood3.als", import.meta.url),
        ),
      ),
      alsPath,
    );
    const dirs = alsMediaSearchDirs(alsPath, "C:\\Users\\me\\Documents");
    // Tauri checks every candidate in one `files_exist` call, then locates
    // each recording from that batch's answers.
    const candidates = alsMediaCandidatePaths(imported, dirs);
    const onDisk = new Set([
      "C:\\Music\\Recorded\\video-12-13-23-20-13-46-0.mp4",
      "C:\\Music\\Recorded\\video-12-13-23-20-15-14-1.mp4",
      "C:\\Music\\Recorded\\video-12-13-23-20-19-23-2.mp4",
      "C:\\Users\\me\\Documents\\Layers\\Recorded\\video-12-13-23-20-19-23-2.mp4",
      "C:\\Users\\me\\Documents\\Layers\\Recorded\\video-12-13-23-21-6-51-0.mp4",
    ]);
    const found = new Set(candidates.filter((path) => onDisk.has(path)));
    const { session, recordingPaths, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(dirs, (path) => found.has(path)),
    );

    assert.equal(
      alsSavePath(alsPath),
      "C:\\Music\\dogfood3 Project\\dogfood3.lvp",
    );
    assert.deepEqual(summary, {
      tracks: 3,
      clips: 3,
      skippedTracks: ["Audio 11 on 3-Audio (shorter than a frame)"],
      missingMedia: [],
    });
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      [
        "C:\\Users\\me\\Documents\\Layers\\Recorded\\video-12-13-23-21-6-51-0.mp4",
        "C:\\Music\\Recorded\\video-12-13-23-20-15-14-1.mp4",
        "C:\\Music\\Recorded\\video-12-13-23-20-19-23-2.mp4",
      ],
    );
    // The set's sibling Recorded folder wins over Documents.
    assert.deepEqual(recordingPaths.sort(), [
      "C:\\Music\\Recorded\\video-12-13-23-20-13-46-0.mp4",
      "C:\\Music\\Recorded\\video-12-13-23-20-15-14-1.mp4",
      "C:\\Music\\Recorded\\video-12-13-23-20-19-23-2.mp4",
      "C:\\Users\\me\\Documents\\Layers\\Recorded\\video-12-13-23-21-6-51-0.mp4",
    ]);
  });
});

describe("Live set media resolution", () => {
  it("searches the set folder, the sibling Recorded folder, Documents, then the project's samples", () => {
    assert.deepEqual(
      alsMediaSearchDirs(
        "/Users/me/Music/Song Project/Song.als",
        "/Users/me/Documents",
      ),
      [
        "/Users/me/Music/Song Project",
        "/Users/me/Music/Recorded",
        "/Users/me/Documents/Layers/Recorded",
        "/Users/me/Music/Song Project/Samples/Recorded",
        "/Users/me/Music/Song Project/Samples/Imported",
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
        "C:\\Music\\Song Project\\Samples\\Recorded",
        "C:\\Music\\Song Project\\Samples\\Imported",
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

  it("finds a sample at its saved absolute path first", () => {
    const existing = new Set(["/old/Samples/kick.wav", "/set/kick.wav"]);
    const locate = createAlsMediaLocator(["/set"], (path) =>
      existing.has(path),
    );

    assert.equal(locate("/old/Samples/kick.wav"), "/old/Samples/kick.wav");
    assert.equal(locate("/moved/Samples/kick.wav"), "/set/kick.wav");
    assert.deepEqual(
      alsMediaCandidatePaths(
        {
          clips: [
            {
              id: "1-1",
              trackId: "1",
              frameStart: 0,
              frameCount: 1,
              filePath: "C:\\Samples\\kick.wav",
            },
            {
              id: "2-1",
              trackId: "2",
              frameStart: 0,
              frameCount: 1,
              filePath: "",
            },
          ],
        },
        ["/set"],
      ),
      ["C:\\Samples\\kick.wav", "/set/kick.wav"],
    );
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
    const { session: probed } = await probeAlsRecordings(
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

  describe("end-aligning capture offsets", () => {
    // Track 8 records with Layers Record and track 12 with ZVID Capture. On
    // track 8, two audio clips play different samples of one recording and a
    // MIDI clip plays it too. Track 9 is a Layers Record track whose video
    // cannot be read.
    const endAlignSession = (): LvpSession => {
      const clip = (
        id: string,
        trackId: string,
        filePath: string,
        captureOffset: number,
        audioFileDuration: number | "NaN",
      ) => ({
        id,
        trackId,
        frameStart: 0,
        frameCount: 30,
        filePath,
        captureOffset,
        audioFileDuration,
      });
      return {
        tracks: [
          {
            id: "8",
            name: "Vocals",
            recordings: [{ filename: "/rec/vocals.mp4", frameStart: 298 }],
          },
          {
            id: "9",
            name: "Bass",
            recordings: [{ filename: "/rec/bass.mp4", frameStart: 179 }],
          },
          {
            id: "12",
            name: "Cam A",
            recordings: [{ filename: "/rec/take.mp4", frameStart: 0 }],
          },
        ],
        clips: [
          clip("8-1", "8", "/rec/vocals.mp4", 298, 415.9 / 30),
          clip("8-2", "8", "/rec/vocals.mp4", 298, 400 / 30),
          clip("8-3", "8", "/rec/vocals.mp4", 298, "NaN"),
          clip("9-1", "9", "/rec/bass.mp4", 179, 227.6 / 30),
          clip("12-1", "12", "/rec/take.mp4", -45, 10),
        ],
        timeline: { fps: 30 },
      };
    };
    const refs = [
      { path: "/rec/vocals.mp4", url: "blob:vocals", exists: true },
      { path: "/rec/bass.mp4", url: "blob:bass", exists: true },
      { path: "/rec/take.mp4", url: "blob:take", exists: true },
    ];
    const offsets = (session: LvpSession) =>
      session.clips?.map((clip) => [clip.id, clip.captureOffset]);

    it("lines each audio clip's take up with the end of its probed video", async () => {
      const { session: probed } = await probeAlsRecordings(
        endAlignSession(),
        refs,
        async (url) => {
          if (url === "blob:bass") {
            return null;
          }
          return {
            numFrames: url === "blob:vocals" ? 750 : 900,
            frameRate: 30,
          };
        },
        ["8", "9"],
      );

      assert.deepEqual(offsets(probed), [
        // round(750 - 415.9) and round(750 - 400): per clip, by its sample.
        ["8-1", 334],
        ["8-2", 350],
        // MIDI clips have no sample and keep the recording's frameStart.
        ["8-3", 298],
        // An unreadable video keeps its frameStart.
        ["9-1", 179],
        // ZVID Capture takes keep the offset from the plugin's clock.
        ["12-1", -45],
      ]);
    });

    it("measures a video at its own frame rate", async () => {
      // 845 frames at 29.916666 fps is 28.245 s: 3.547 s longer than the
      // 24.699 s sample, or 106 frames at 30 fps (not 845 - 741 = 104).
      const session: LvpSession = {
        tracks: [
          {
            id: "16",
            name: "Guitar",
            recordings: [{ filename: "/rec/guitar.mp4", frameStart: 107 }],
          },
        ],
        clips: [
          {
            id: "16-2",
            trackId: "16",
            frameStart: 0,
            frameCount: 30,
            filePath: "/rec/guitar.mp4",
            captureOffset: 107,
            audioFileDuration: 24.6986675,
          },
        ],
        timeline: { fps: 30 },
      };
      const { session: probed } = await probeAlsRecordings(
        session,
        [{ path: "/rec/guitar.mp4", url: "blob:guitar", exists: true }],
        async () => ({ numFrames: 845, frameRate: 29.916666 }),
        ["16"],
      );

      assert.equal(probed.clips?.[0].captureOffset, 106);
    });

    it("keeps frameStart when no recording could be probed", async () => {
      const session = endAlignSession();
      const { session: probed } = await probeAlsRecordings(
        session,
        refs,
        async () => null,
        ["8", "9"],
      );

      assert.deepEqual(offsets(probed), offsets(session));
    });
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

  it("warns when the set had no Layers video", () => {
    assert.deepEqual(
      formatAlsImportSummary(
        {
          tracks: 6,
          clips: 6,
          skippedTracks: [],
          missingMedia: [],
          noLayersVideo: true,
        },
        "dogfood7.als",
      ),
      [
        "No Layers video in dogfood7.als. Imported 6 tracks and 6 clips as placeholders.",
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

describe("ZVID Capture media resolution", () => {
  const importFixture = (name: string, path: string) =>
    importAls(
      gzip(
        readFileSync(
          new URL(`../test/fixtures/als/${name}`, import.meta.url),
          "utf8",
        ),
      ),
      path,
    );

  it("places each record root beside the set or in Documents", () => {
    assert.equal(
      alsRecordRootDir("project", "/Music/Song Project/Song.als", "/Docs"),
      "/Music/Song Project/Recorded/ZVID",
    );
    assert.equal(
      alsRecordRootDir("documents", "/Music/Song Project/Song.als", "/Docs"),
      "/Docs/ZVID/Recorded",
    );
    assert.equal(
      alsRecordRootDir(
        "project",
        "C:\\Music\\Song Project\\Song.als",
        "C:\\Docs",
      ),
      "C:\\Music\\Song Project\\Recorded\\ZVID",
    );
    assert.equal(alsRecordRootDir("documents", "/Song.als", undefined), null);
    assert.equal(alsRecordRootDir("project", undefined, "/Docs"), null);
  });

  it("finds project-rooted takes in the set's Recorded/ZVID folder", async () => {
    const alsPath = "/Music/Song Project/Song.als";
    const imported = await importFixture("zvid-capture-vst3.xml", alsPath);
    assert.deepEqual(imported.importReport?.recordRoots, {
      "video-01-9-25-20-36-12-0.mp4": "project",
    });
    const dirs = alsMediaSearchDirs(alsPath, "/Docs");
    const recordDirOf = alsRecordDirLocator(imported, alsPath, "/Docs");
    const recorded =
      "/Music/Song Project/Recorded/ZVID/video-01-9-25-20-36-12-0.mp4";
    assert.ok(
      alsMediaCandidatePaths(imported, dirs, recordDirOf).includes(recorded),
    );

    // A same-named file beside the set loses to the record root folder.
    const onDisk = new Set([
      recorded,
      "/Music/Song Project/video-01-9-25-20-36-12-0.mp4",
    ]);
    const { session, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(dirs, (path) => onDisk.has(path), recordDirOf),
    );
    assert.deepEqual(
      session.tracks?.[0].recordings?.map((recording) => recording.filename),
      [recorded, recorded],
    );
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      [recorded, recorded],
    );
    assert.deepEqual(summary.missingMedia, []);
  });

  it("finds documents-rooted takes in Documents/ZVID/Recorded", async () => {
    const alsPath = "C:\\Music\\Song Project\\Song.als";
    const documentsDir = "C:\\Users\\me\\Documents";
    const imported = await importFixture("zvid-capture-au.xml", alsPath);
    const recordDirOf = alsRecordDirLocator(imported, alsPath, documentsDir);
    const found =
      "C:\\Users\\me\\Documents\\ZVID\\Recorded\\video-02-9-25-21-05-00-0.mp4";
    const { session, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(
        alsMediaSearchDirs(alsPath, documentsDir),
        (path) => path === found,
        recordDirOf,
      ),
    );
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      ["video-01-9-25-21-00-00-0.mp4", found],
    );
    // Missing takes keep their name and fall through to relinking.
    assert.deepEqual(summary.missingMedia, ["video-01-9-25-21-00-00-0.mp4"]);
  });

  it("falls back to the usual search folders when the record root lacks a take", async () => {
    const alsPath = "/Music/Song Project/Song.als";
    const imported = await importFixture(
      "layers-and-zvid-capture.xml",
      alsPath,
    );
    const beside = "/Music/Song Project/video-01-9-25-20-36-12-0.mp4";
    const layers = "/Docs/Layers/Recorded/video-12-13-23-20-15-14-1.mp4";
    const { session, summary } = resolveAlsMedia(
      imported,
      createAlsMediaLocator(
        alsMediaSearchDirs(alsPath, "/Docs"),
        (path) => path === beside || path === layers,
        alsRecordDirLocator(imported, alsPath, "/Docs"),
      ),
    );
    assert.deepEqual(
      session.clips?.map((clip) => clip.filePath),
      [layers, beside, beside],
    );
    assert.deepEqual(summary.missingMedia, ["video-12-13-23-20-13-46-0.mp4"]);
    assert.deepEqual(summary.skippedTracks, [
      "Outro on Cam A (no ZVID take at its position)",
    ]);
  });
});
