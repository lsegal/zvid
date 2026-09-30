import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createExportOptions,
  defaultExportFileName,
  defaultExportRange,
  type ExportOptions,
  estimateExportBytes,
  exportSettings,
  exportTiming,
  formatFileSize,
  formatMusicalLength,
  hasExportOptionsErrors,
  modifiedExportFields,
  moveExportMarker,
  normalizeExportFileName,
  parseTimecode,
  reopenExportOptions,
  resetExportSettings,
  snapExportQ,
  snapToFrame,
  validateExportOptions,
} from "./export-options.ts";
import {
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
} from "./session-settings.ts";

const BPM = 120;
const session: SessionSettings = {
  ...DEFAULT_SESSION_SETTINGS,
  canvasWidth: 1280,
  canvasHeight: 720,
  fps: 30,
};

function options(extra: Partial<ExportOptions> = {}): ExportOptions {
  return {
    ...createExportOptions(session, { inQ: 0, outQ: 8 }, "Song.mp4"),
    ...extra,
  };
}

describe("defaultExportRange", () => {
  it("runs from the first clip's start to the last clip's end", () => {
    // At 120 bpm a quarter note is half a second.
    const range = defaultExportRange({
      clips: [
        { startQ: 4, durationSeconds: 2 },
        { startQ: 2, durationSeconds: 1 },
      ],
      bpm: BPM,
      fps: 30,
    });
    assert.deepEqual(range, { inQ: 2, outQ: 8 });
  });

  it("ends at the session length when the session has one", () => {
    const range = defaultExportRange({
      clips: [{ startQ: 0, durationSeconds: 2 }],
      bpm: BPM,
      fps: 30,
      projectDurationFrames: 300,
    });
    assert.deepEqual(range, { inQ: 0, outQ: 20 });
  });

  it("is empty with no clips", () => {
    assert.deepEqual(defaultExportRange({ clips: [], bpm: BPM, fps: 30 }), {
      inQ: 0,
      outQ: 0,
    });
  });
});

describe("export file names", () => {
  it("names the export after the session", () => {
    assert.equal(defaultExportFileName("My Song"), "My Song.mp4");
    assert.equal(defaultExportFileName(null), "zvid-session.mp4");
  });

  it("adds .mp4 once and replaces characters files can't use", () => {
    assert.equal(normalizeExportFileName(" take: 2 "), "take- 2.mp4");
    assert.equal(normalizeExportFileName("clip.MP4"), "clip.mp4");
  });
});

describe("overrides", () => {
  it("start from Session Settings with nothing modified", () => {
    const initial = options();
    assert.deepEqual(exportSettings(initial), session);
    assert.deepEqual(modifiedExportFields(initial, session), []);
  });

  it("list each setting that differs from Session Settings", () => {
    const changed = options({
      fps: 60,
      encoding: { ...session.encoding, videoCodec: "h264" },
    });
    assert.deepEqual(modifiedExportFields(changed, session), [
      "fps",
      "videoCodec",
    ]);
  });

  it("never change the Session Settings they start from", () => {
    const initial = options();
    initial.encoding.audioBitrateKbps = 320;
    assert.equal(session.encoding.audioBitrateKbps, 192);
  });

  it("reset to Session Settings, keeping the range and file name", () => {
    const changed = options({
      canvasWidth: 640,
      canvasHeight: 360,
      inQ: 2,
      outQ: 6,
      fileName: "Short.mp4",
      encoding: {
        ...session.encoding,
        quality: "custom",
        customBitrateMbps: 3,
      },
    });
    const reset = resetExportSettings(changed, session);
    assert.deepEqual(exportSettings(reset), session);
    assert.deepEqual(
      { inQ: reset.inQ, outQ: reset.outQ, fileName: reset.fileName },
      { inQ: 2, outQ: 6, fileName: "Short.mp4" },
    );
    assert.deepEqual(modifiedExportFields(reset, session), []);
  });

  it("stay when reopened, while untouched settings follow the session", () => {
    const remembered = options({ fps: 60, inQ: 1, outQ: 3 });
    const changedSession: SessionSettings = {
      ...session,
      canvasWidth: 1920,
      canvasHeight: 1080,
      fps: 25,
    };
    const reopened = reopenExportOptions(remembered, session, changedSession);
    assert.equal(reopened.fps, 60);
    assert.equal(reopened.canvasWidth, 1920);
    assert.equal(reopened.canvasHeight, 1080);
    assert.deepEqual([reopened.inQ, reopened.outQ], [1, 3]);
  });
});

describe("markers", () => {
  it("snap to beats, or to frames with Shift", () => {
    const snap = { beatQ: 1, fps: 30, bpm: BPM };
    assert.equal(snapExportQ(2.4, { ...snap, free: false }), 2);
    // A frame at 30 fps and 120 bpm is 1/15 of a quarter note.
    assert.ok(
      Math.abs(snapExportQ(2.4, { ...snap, free: true }) - 36 / 15) < 1e-9,
    );
    assert.equal(snapExportQ(-1, { ...snap, free: false }), 0);
  });

  it("keep at least one frame between In and Out", () => {
    const range = { inQ: 2, outQ: 4 };
    assert.deepEqual(moveExportMarker(range, "in", 5, 0.1), {
      inQ: 3.9,
      outQ: 4,
    });
    assert.deepEqual(moveExportMarker(range, "out", 1, 0.1), {
      inQ: 2,
      outQ: 2.1,
    });
    assert.deepEqual(moveExportMarker(range, "in", -3, 0.1), {
      inQ: 0,
      outQ: 4,
    });
  });
});

describe("exportTiming", () => {
  it("renders only In→Out, as long as Out − In", () => {
    // 2 → 8 quarters at 120 bpm is 1 s → 4 s.
    const timing = exportTiming(options({ inQ: 2, outQ: 8, fps: 24 }), BPM);
    assert.equal(timing.startSeconds, 1);
    assert.equal(timing.frameCount, 72);
    assert.equal(timing.durationSeconds, 3);
  });

  it("renders at least one frame", () => {
    assert.equal(exportTiming(options({ inQ: 4, outQ: 4 }), BPM).frameCount, 1);
  });
});

describe("validateExportOptions", () => {
  it("accepts the defaults", () => {
    assert.equal(
      hasExportOptionsErrors(validateExportOptions(options(), BPM)),
      false,
    );
  });

  it("rejects an empty range, a blank file name and bad settings", () => {
    const errors = validateExportOptions(
      options({ inQ: 4, outQ: 4, fileName: " ", canvasWidth: 641 }),
      BPM,
      { hevc: false },
    );
    assert.ok(errors.range);
    assert.ok(errors.fileName);
    assert.ok(errors.canvasWidth);
    assert.equal(hasExportOptionsErrors(errors), true);
  });

  it("rejects a codec the device can't encode", () => {
    const errors = validateExportOptions(
      options({ encoding: { ...session.encoding, videoCodec: "av1" } }),
      BPM,
      { av1: false },
    );
    assert.ok(errors.codec);
  });
});

describe("estimates and formatting", () => {
  it("estimates size from the video and audio bitrates", () => {
    const custom = options({
      encoding: {
        ...session.encoding,
        quality: "custom",
        customBitrateMbps: 8,
      },
    });
    // (8 Mbps + 192 kbps) × 10 s / 8.
    assert.equal(estimateExportBytes(custom, 10, true), 10_240_000);
    assert.equal(estimateExportBytes(custom, 10, false), 10_000_000);
    assert.equal(formatFileSize(10_240_000), "10.2 MB");
    assert.equal(formatFileSize(1_500), "2 KB");
  });

  it("parses typed timecodes and seconds", () => {
    assert.equal(parseTimecode("00:02:15", 30), 2.5);
    assert.equal(parseTimecode("1:00:00:00", 30), 3600);
    assert.equal(parseTimecode("3.25", 30), 3.25);
    assert.equal(parseTimecode("00:02:45", 30), undefined);
    assert.equal(parseTimecode("abc", 30), undefined);
  });

  it("formats lengths as bars.beats.sixteenths from zero", () => {
    const fourFour = { numerator: 4, denominator: 4 };
    assert.equal(formatMusicalLength(9.5, fourFour), "2.1.2");
    assert.equal(formatMusicalLength(0, fourFour), "0.0.0");
  });

  it("snaps positions to whole frames", () => {
    assert.ok(Math.abs(snapToFrame(0.52, 30, BPM) - 8 / 15) < 1e-9);
  });
});
