import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "./app/constants.ts";
import { sessionToProject } from "./app/session-project.ts";
import type { ProjectState } from "./app/types.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import { projectToSession } from "./session-save.ts";
import {
  applyCanvasPreset,
  applySessionSettings,
  DEFAULT_SESSION_ENCODING,
  DEFAULT_SESSION_SETTINGS,
  exportAudioCodec,
  exportAudioSampleRate,
  exportContainer,
  formatFrameRate,
  hasSessionSettingsErrors,
  matchCanvasPreset,
  presetBitrateMbps,
  readSessionEncoding,
  resizeCanvas,
  resolveAutoCodec,
  type SessionSettings,
  sessionSettingsFromProject,
  swapCanvasOrientation,
  UNSUPPORTED_CODEC_REASON,
  validateSessionSettings,
  videoBitrateMbps,
  videoCodecOptions,
} from "./session-settings.ts";

const settings = (
  overrides: Partial<SessionSettings> = {},
): SessionSettings => ({ ...DEFAULT_SESSION_SETTINGS, ...overrides });

describe("session settings defaults", () => {
  it("gives a new session 1920x1080 at 30 fps with the default encoding", () => {
    assert.deepEqual(sessionSettingsFromProject(INITIAL_PROJECT_STATE), {
      canvasWidth: 1920,
      canvasHeight: 1080,
      fps: 30,
      encoding: {
        videoCodec: "auto",
        quality: "high",
        audioBitrateKbps: 192,
        audioSampleRate: 48000,
      },
    });
  });

  it("reads a missing or malformed encoding as the defaults", () => {
    assert.deepEqual(readSessionEncoding(undefined), DEFAULT_SESSION_ENCODING);
    assert.deepEqual(
      readSessionEncoding({
        videoCodec: "mpeg2",
        quality: 7,
        customBitrateMbps: -3,
        audioBitrateKbps: 96,
        audioSampleRate: 22050,
      }),
      DEFAULT_SESSION_ENCODING,
    );
  });
});

describe("canvas presets", () => {
  it("sets width and height from a preset", () => {
    const next = applyCanvasPreset(settings(), "1080x1920");
    assert.equal(next.canvasWidth, 1080);
    assert.equal(next.canvasHeight, 1920);
    assert.equal(applyCanvasPreset(settings(), "4k").canvasWidth, 3840);
  });

  it("matches the preset for the current size, else custom", () => {
    assert.equal(matchCanvasPreset(1920, 1080), "1080p");
    assert.equal(matchCanvasPreset(1280, 720), "720p");
    assert.equal(matchCanvasPreset(1000, 500), "custom");
  });

  it("swaps orientation", () => {
    const next = swapCanvasOrientation(settings());
    assert.equal(next.canvasWidth, 1080);
    assert.equal(next.canvasHeight, 1920);
  });
});

describe("resizeCanvas", () => {
  it("keeps the aspect when locked, at an even size", () => {
    const next = resizeCanvas(settings(), "width", 1280, true);
    assert.equal(next.canvasWidth, 1280);
    assert.equal(next.canvasHeight, 720);
    const odd = resizeCanvas(settings(), "height", 481, true);
    assert.equal(odd.canvasHeight, 481);
    assert.equal(odd.canvasWidth % 2, 0);
    assert.equal(odd.canvasWidth, 856);
  });

  it("changes only one dimension when unlocked", () => {
    const next = resizeCanvas(settings(), "height", 1000, false);
    assert.equal(next.canvasWidth, 1920);
    assert.equal(next.canvasHeight, 1000);
  });

  it("leaves the other dimension alone for a cleared field", () => {
    const next = resizeCanvas(settings(), "width", Number.NaN, true);
    assert.equal(next.canvasHeight, 1080);
  });
});

describe("validateSessionSettings", () => {
  it("accepts the defaults", () => {
    assert.deepEqual(validateSessionSettings(settings()), {});
  });

  it("rejects odd, out-of-range and non-integer sizes", () => {
    assert.match(
      validateSessionSettings(settings({ canvasWidth: 1921 })).canvasWidth ??
        "",
      /even/,
    );
    assert.match(
      validateSessionSettings(settings({ canvasHeight: 8 })).canvasHeight ?? "",
      /16–7680/,
    );
    assert.match(
      validateSessionSettings(settings({ canvasWidth: 8000 })).canvasWidth ??
        "",
      /16–7680/,
    );
    assert.ok(
      validateSessionSettings(settings({ canvasWidth: Number.NaN }))
        .canvasWidth,
    );
  });

  it("rejects a frame rate that is not above 0", () => {
    assert.ok(validateSessionSettings(settings({ fps: 0 })).fps);
    assert.ok(validateSessionSettings(settings({ fps: Number.NaN })).fps);
    assert.equal(
      validateSessionSettings(settings({ fps: 12.5 })).fps,
      undefined,
    );
  });

  it("requires a positive custom bitrate", () => {
    const custom = (customBitrateMbps?: number) =>
      settings({
        encoding: {
          ...DEFAULT_SESSION_ENCODING,
          quality: "custom",
          customBitrateMbps,
        },
      });
    assert.ok(validateSessionSettings(custom()).bitrate);
    assert.ok(validateSessionSettings(custom(0)).bitrate);
    assert.equal(validateSessionSettings(custom(20)).bitrate, undefined);
  });

  it("rejects a codec the device can't encode", () => {
    const hevc = settings({
      encoding: { ...DEFAULT_SESSION_ENCODING, videoCodec: "hevc" },
    });
    const errors = validateSessionSettings(hevc, { hevc: false });
    assert.equal(errors.codec, UNSUPPORTED_CODEC_REASON);
    assert.ok(hasSessionSettingsErrors(errors));
    assert.deepEqual(validateSessionSettings(hevc, {}), {});
  });
});

describe("video codecs", () => {
  it("disables codecs the device can't encode, with the reason", () => {
    const options = videoCodecOptions({
      h264: true,
      hevc: false,
      av1: false,
      vp8: false,
      vp9: true,
    });
    assert.deepEqual(
      options.map(({ value, disabled, reason }) => ({
        value,
        disabled,
        reason,
      })),
      [
        { value: "auto", disabled: false, reason: undefined },
        { value: "h264", disabled: false, reason: undefined },
        { value: "hevc", disabled: true, reason: UNSUPPORTED_CODEC_REASON },
        { value: "av1", disabled: true, reason: UNSUPPORTED_CODEC_REASON },
        { value: "vp8", disabled: true, reason: UNSUPPORTED_CODEC_REASON },
        { value: "vp9", disabled: false, reason: undefined },
      ],
    );
  });

  it("leaves codecs enabled until they are checked", () => {
    assert.ok(videoCodecOptions({}).every((option) => !option.disabled));
  });

  it("resolves Auto to HEVC, then AV1, then H.264", () => {
    assert.equal(
      resolveAutoCodec({ hevc: true, av1: true, h264: true }),
      "hevc",
    );
    assert.equal(
      resolveAutoCodec({ hevc: false, av1: true, h264: true }),
      "av1",
    );
    assert.equal(
      resolveAutoCodec({ hevc: false, av1: false, h264: true }),
      "h264",
    );
    assert.equal(resolveAutoCodec({}), undefined);
    // Auto stays on MP4, never picking a WebM codec.
    assert.equal(resolveAutoCodec({ vp8: true, vp9: true }), undefined);
  });

  it("exports VP8 and VP9 to WebM with 48 kHz Opus, the rest to MP4 with AAC", () => {
    for (const codec of ["auto", "h264", "hevc", "av1"] as const) {
      assert.equal(exportContainer(codec), "mp4");
    }
    for (const codec of ["vp8", "vp9"] as const) {
      assert.equal(exportContainer(codec), "webm");
    }
    assert.equal(exportAudioCodec("mp4"), "aac");
    assert.equal(exportAudioCodec("webm"), "opus");
    const encoding = {
      ...DEFAULT_SESSION_ENCODING,
      audioSampleRate: 44100,
    } as const;
    assert.equal(exportAudioSampleRate(encoding), 44100);
    assert.equal(
      exportAudioSampleRate({ ...encoding, videoCodec: "vp9" }),
      48000,
    );
  });

  it("reads a saved WebM codec back", () => {
    assert.equal(
      readSessionEncoding({ ...DEFAULT_SESSION_ENCODING, videoCodec: "vp8" })
        .videoCodec,
      "vp8",
    );
  });
});

describe("bitrates", () => {
  it("derives the preset bitrate from resolution and frame rate", () => {
    assert.equal(presetBitrateMbps(1920, 1080, 30, "high"), 12);
    assert.equal(presetBitrateMbps(3840, 2160, 30, "high"), 45);
    assert.ok(
      presetBitrateMbps(1920, 1080, 30, "low") <
        presetBitrateMbps(1920, 1080, 30, "medium"),
    );
    assert.ok(
      presetBitrateMbps(1920, 1080, 60, "high") >
        presetBitrateMbps(1920, 1080, 30, "high"),
    );
  });

  it("uses the custom bitrate for Custom quality", () => {
    assert.equal(
      videoBitrateMbps(
        settings({
          encoding: {
            ...DEFAULT_SESSION_ENCODING,
            quality: "custom",
            customBitrateMbps: 20,
          },
        }),
      ),
      20,
    );
    assert.equal(videoBitrateMbps(settings()), 12);
  });

  it("formats frame rates as the dropdown lists them", () => {
    assert.equal(formatFrameRate(30000 / 1001), "29.97");
    assert.equal(formatFrameRate(30), "30");
    assert.equal(formatFrameRate(12.3456), "12.346");
  });
});

describe("applySessionSettings", () => {
  const project: ProjectState = {
    ...INITIAL_PROJECT_STATE,
    projectDurationFrames: 300,
  };

  it("returns the same project when nothing changes", () => {
    assert.equal(
      applySessionSettings(project, sessionSettingsFromProject(project)),
      project,
    );
  });

  it("applies canvas, frame rate and encoding, rescaling the length", () => {
    const next = applySessionSettings(project, {
      canvasWidth: 1080,
      canvasHeight: 1920,
      fps: 60,
      encoding: { ...DEFAULT_SESSION_ENCODING, videoCodec: "h264" },
    });
    assert.equal(next.canvasWidth, 1080);
    assert.equal(next.canvasHeight, 1920);
    assert.equal(next.fps, 60);
    assert.equal(next.encoding?.videoCodec, "h264");
    // 10 s stays 10 s.
    assert.equal(next.projectDurationFrames, 600);
    // Clips are placed in beats, so they don't move.
    assert.equal(next.clips, project.clips);
  });

  it("is a single undo step", () => {
    const history = projectHistoryReducer(createProjectHistoryState(project), {
      type: "commit",
      label: "Session Settings",
      updater: (current) =>
        applySessionSettings(current, {
          canvasWidth: 1280,
          canvasHeight: 720,
          fps: 25,
          encoding: { ...DEFAULT_SESSION_ENCODING, audioBitrateKbps: 320 },
        }),
    });
    assert.equal(history.past.length, 1);
    assert.equal(history.past[0]?.label, "Session Settings");
    const undone = projectHistoryReducer(history, { type: "undo" });
    assert.equal(undone.present, project);
  });
});

describe("session settings save and load", () => {
  it("round-trips canvas, frame rate and encoding through a session", () => {
    const encoding = {
      videoCodec: "av1",
      quality: "custom",
      customBitrateMbps: 18.5,
      audioBitrateKbps: 256,
      audioSampleRate: 44100,
    } as const;
    const project = applySessionSettings(INITIAL_PROJECT_STATE, {
      canvasWidth: 1280,
      canvasHeight: 720,
      fps: 24000 / 1001,
      encoding,
    });
    const saved = JSON.parse(
      JSON.stringify(projectToSession(project, { playheadQ: 0 })),
    );
    const loaded = sessionToProject(saved, []);
    assert.equal(loaded.canvasWidth, 1280);
    assert.equal(loaded.canvasHeight, 720);
    assert.equal(loaded.fps, 24000 / 1001);
    assert.deepEqual(loaded.encoding, encoding);
  });

  it("writes no encoding for a session that never set one", () => {
    const saved = projectToSession(INITIAL_PROJECT_STATE, { playheadQ: 0 });
    assert.equal(saved.timeline?.encoding, undefined);
    assert.equal(sessionToProject(saved, []).encoding, undefined);
  });

  it("keeps a small canvas", () => {
    const project = applySessionSettings(INITIAL_PROJECT_STATE, {
      ...sessionSettingsFromProject(INITIAL_PROJECT_STATE),
      canvasWidth: 240,
      canvasHeight: 240,
    });
    const loaded = sessionToProject(
      projectToSession(project, { playheadQ: 0 }),
      [],
    );
    assert.equal(loaded.canvasWidth, 240);
    assert.equal(loaded.canvasHeight, 240);
  });
});
