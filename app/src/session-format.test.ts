import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import {
  formatAlsImportSummary,
  probeAlsRecordings,
  type RecordingProbe,
  withFormatNotes,
} from "./als-import.ts";
import { mediaFrameRate } from "./app/session-project.ts";
import type { MediaItem } from "./media.ts";
import type { LvpSession } from "./session.ts";
import {
  applySessionFormat,
  detectOpenedSessionFormat,
  detectSessionFormat,
  displayedSize,
  snapFrameRate,
} from "./session-format.ts";
import { probeVideoInput } from "./video-format-probe.ts";

const NTSC = 30000 / 1001;

// ~320p, 3 s test videos. The portrait one is the 320×180 landscape one with
// a 90° rotation in its metadata, as a phone records portrait video.
const FIXTURES = {
  landscape: "landscape-320x180-29.97.mp4",
  portrait: "portrait-rotated-29.97.mp4",
  other: "landscape-320x240-25.mp4",
};

async function probeFixture(name: string) {
  const bytes = readFileSync(
    new URL(`../test/fixtures/video/${name}`, import.meta.url),
  );
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(bytes),
  });
  try {
    return await probeVideoInput(input);
  } finally {
    input.dispose();
  }
}

// A probe that reads the fixture a `blob:<name>` url names.
async function probeFixtureUrl(url: string) {
  return probeFixture(url.replace(/^blob:/, ""));
}

describe("snapFrameRate", () => {
  it("snaps a measured rate to the nearest standard rate", () => {
    assert.equal(snapFrameRate(29.97002997), NTSC);
    assert.equal(snapFrameRate(29.99), 30);
    assert.equal(snapFrameRate(23.98), 24000 / 1001);
    assert.equal(snapFrameRate(25.02), 25);
    assert.equal(snapFrameRate(59.9), 60000 / 1001);
  });

  it("keeps an unusual rate, rounded", () => {
    assert.equal(snapFrameRate(15.0004), 15);
    assert.equal(snapFrameRate(12.3456), 12.346);
  });

  it("tells NTSC rates from whole ones", () => {
    assert.equal(snapFrameRate(29.916666), NTSC);
    assert.equal(snapFrameRate(30.02), 30);
  });
});

describe("displayedSize", () => {
  it("swaps width and height for a quarter turn", () => {
    assert.deepEqual(displayedSize({ width: 1920, height: 1080 }), {
      width: 1920,
      height: 1080,
    });
    assert.deepEqual(
      displayedSize({ width: 1920, height: 1080, rotation: 90 }),
      { width: 1080, height: 1920 },
    );
    assert.deepEqual(
      displayedSize({ width: 1920, height: 1080, rotation: 180 }),
      { width: 1920, height: 1080 },
    );
    assert.deepEqual(
      displayedSize({ width: 1920, height: 1080, rotation: 270 }),
      { width: 1080, height: 1920 },
    );
  });

  it("has no size without one", () => {
    assert.equal(displayedSize({ frameRate: 30 }), null);
    assert.equal(displayedSize({ width: 0, height: 1080 }), null);
  });
});

describe("probeVideoInput", () => {
  it("reads a video's size, rotation and rate", async () => {
    const probe = await probeFixture(FIXTURES.portrait);
    assert.ok(probe);
    assert.equal(probe.numFrames, 90);
    assert.equal(snapFrameRate(probe.frameRate), NTSC);
    assert.deepEqual(displayedSize(probe), { width: 180, height: 320 });
  });
});

describe("detectSessionFormat", () => {
  it("gives portrait recordings a portrait canvas at their rate", async () => {
    const probes = await Promise.all([
      probeFixture(FIXTURES.portrait),
      probeFixture(FIXTURES.portrait),
    ]);
    assert.deepEqual(detectSessionFormat(probes as RecordingProbe[]), {
      width: 180,
      height: 320,
      fps: NTSC,
      notes: [],
    });
  });

  it("uses the most common size and notes the others", () => {
    const hd = { width: 1920, height: 1080, frameRate: 30 };
    assert.deepEqual(
      detectSessionFormat([
        hd,
        { width: 1280, height: 720, frameRate: 30 },
        hd,
        hd,
      ]),
      {
        width: 1920,
        height: 1080,
        fps: 30,
        notes: [
          "3 recordings were 1920×1080, 1 was 1280×720; canvas set to 1920×1080.",
        ],
      },
    );
  });

  it("detects nothing without probes", () => {
    assert.deepEqual(detectSessionFormat([]), { notes: [] });
    assert.deepEqual(detectSessionFormat([{ frameRate: 0 }]), { notes: [] });
  });
});

describe("applySessionFormat", () => {
  it("rescales frame positions to a new rate", () => {
    const session: LvpSession = {
      tracks: [
        {
          id: "1",
          name: "Cam",
          recordings: [{ filename: "a", frameStart: 30 }],
        },
      ],
      clips: [
        {
          id: "1",
          trackId: "1",
          frameStart: 0,
          frameCount: 30,
          filePath: "a",
          captureOffset: 30,
        },
        {
          id: "2",
          trackId: "1",
          frameStart: 30,
          frameCount: 30,
          filePath: "a",
          captureOffset: -1,
        },
      ],
      timeline: { fps: 30, projectDuration: 60 },
      playPosition: 15,
    };
    const applied = applySessionFormat(session, { fps: 25 });
    assert.deepEqual(applied.timeline, { fps: 25, projectDuration: 50 });
    assert.equal(applied.playPosition, 13);
    assert.equal(applied.tracks?.[0].recordings?.[0].frameStart, 25);
    assert.deepEqual(
      applied.clips?.map((clip) => [
        clip.frameStart,
        clip.frameCount,
        clip.captureOffset,
      ]),
      [
        [0, 25, 25],
        [25, 25, -1],
      ],
    );
  });

  it("leaves frame positions alone at the same rate", () => {
    const session: LvpSession = {
      clips: [
        { id: "1", trackId: "1", frameStart: 7, frameCount: 9, filePath: "" },
      ],
      timeline: { fps: 30 },
    };
    const applied = applySessionFormat(session, {
      fps: 30,
      width: 180,
      height: 320,
    });
    assert.equal(applied.clips, session.clips);
    assert.deepEqual(applied.timeline, {
      fps: 30,
      canvasWidth: 180,
      canvasHeight: 320,
    });
  });
});

describe("probeAlsRecordings format detection", () => {
  // Each recording is its own file, playing the named fixture.
  const recordingsOf = (fixtures: string[]) =>
    fixtures.map((fixture, index) => `/rec/${index}/${fixture}`);
  const importedSet = (filenames: string[]): LvpSession => ({
    tracks: filenames.map((filename, index) => ({
      id: String(index + 1),
      name: `Cam ${index + 1}`,
      recordings: [{ filename, frameStart: 0 }],
    })),
    clips: filenames.map((filename, index) => ({
      id: String(index + 1),
      trackId: String(index + 1),
      frameStart: 0,
      frameCount: 60,
      filePath: filename,
    })),
    // The plugin metadata named a landscape 30 fps canvas.
    timeline: { fps: 30, canvasWidth: 1920, canvasHeight: 1080 },
  });
  const refsFor = (filenames: string[]) =>
    filenames.map((filename) => ({
      path: filename,
      url: `blob:${filename.split("/").pop()}`,
      exists: true,
    }));

  it("sets a portrait canvas and 29.97 fps from portrait recordings", async () => {
    const files = recordingsOf([FIXTURES.portrait, FIXTURES.portrait]);
    const { session, formatNotes } = await probeAlsRecordings(
      importedSet(files),
      refsFor(files),
      probeFixtureUrl,
    );
    assert.deepEqual(session.timeline, {
      fps: NTSC,
      canvasWidth: 180,
      canvasHeight: 320,
    });
    assert.deepEqual(formatNotes, []);
    // Recordings only keep their frame metadata.
    assert.deepEqual(Object.keys(session.tracks?.[0].recordings?.[0] ?? {}), [
      "filename",
      "frameStart",
      "numFrames",
      "frameRate",
    ]);
  });

  it("uses the most common size and notes the mixed sizes", async () => {
    const files = recordingsOf([
      FIXTURES.landscape,
      FIXTURES.other,
      FIXTURES.landscape,
    ]);
    const { session, formatNotes } = await probeAlsRecordings(
      importedSet(files),
      refsFor(files),
      probeFixtureUrl,
    );
    assert.equal(session.timeline?.canvasWidth, 320);
    assert.equal(session.timeline?.canvasHeight, 180);
    assert.equal(session.timeline?.fps, NTSC);
    assert.deepEqual(formatNotes, [
      "2 recordings were 320×180, 1 was 320×240; canvas set to 320×180.",
    ]);
    const summary = withFormatNotes(
      { tracks: 3, clips: 3, skippedTracks: [], missingMedia: [] },
      formatNotes,
    );
    assert.deepEqual(formatAlsImportSummary(summary), [
      "Imported 3 tracks and 3 clips.",
      "2 recordings were 320×180, 1 was 320×240; canvas set to 320×180.",
    ]);
  });

  it("keeps the plugin metadata when nothing can be probed", async () => {
    const files = recordingsOf([FIXTURES.portrait]);
    const set = importedSet(files);
    const { session, formatNotes } = await probeAlsRecordings(
      set,
      refsFor(files),
      async () => null,
    );
    assert.equal(session, set);
    assert.deepEqual(formatNotes, []);
  });
});

describe("detectOpenedSessionFormat", () => {
  const refs = [
    { path: "/rec/cam.mp4", url: `blob:${FIXTURES.portrait}`, exists: true },
    { path: "/rec/missing.mp4", url: "", exists: false },
  ];

  it("keeps an .lvp session's saved canvas and rate", async () => {
    const session: LvpSession = {
      timeline: { fps: 25, canvasWidth: 1920, canvasHeight: 1080 },
    };
    let probed = false;
    const opened = await detectOpenedSessionFormat(session, refs, async () => {
      probed = true;
      return null;
    });
    assert.equal(opened, session);
    assert.equal(probed, false);
  });

  it("detects them for an .lvp session without them", async () => {
    const session: LvpSession = {
      clips: [
        { id: "1", trackId: "1", frameStart: 9, frameCount: 9, filePath: "" },
      ],
      timeline: { bpm: 120 },
    };
    const opened = await detectOpenedSessionFormat(
      session,
      refs,
      probeFixtureUrl,
    );
    assert.deepEqual(opened.timeline, {
      bpm: 120,
      fps: NTSC,
      canvasWidth: 180,
      canvasHeight: 320,
    });
    assert.equal(opened.clips, session.clips);
  });

  it("only fills in what an .lvp session lacks", async () => {
    const opened = await detectOpenedSessionFormat(
      { timeline: { fps: 60 } },
      refs,
      probeFixtureUrl,
    );
    assert.deepEqual(opened.timeline, {
      fps: 60,
      canvasWidth: 180,
      canvasHeight: 320,
    });
  });
});

describe("mediaFrameRate", () => {
  const item = (patch: Partial<MediaItem>) =>
    ({ hasVideo: true, ...patch }) as MediaItem;

  it("takes the first video's rate, snapped", () => {
    assert.equal(
      mediaFrameRate([
        item({ hasVideo: false }),
        item({ fps: 29.97003 }),
        item({ fps: 25 }),
      ]),
      NTSC,
    );
  });

  it("has none without a video rate", () => {
    assert.equal(mediaFrameRate([item({ hasVideo: false })]), undefined);
    assert.equal(mediaFrameRate([]), undefined);
  });
});
