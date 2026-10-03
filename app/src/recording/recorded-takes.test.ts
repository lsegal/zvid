import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { ProjectState, SourceSpan } from "../app/types.ts";
import type { MediaItem } from "../media.ts";
import {
  addRecordedTakes,
  recordedTakeFileName,
  withRecordedDuration,
} from "./recorded-takes.ts";

const take = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: `${id}.webm`,
  kind: "video",
  durationSeconds: 4,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  availability: "ready",
  ...extra,
});

const existingSpan: SourceSpan = {
  id: "span-old",
  sourceTrackId: "cam",
  label: "Old",
  mediaPath: "old.mp4",
  mediaId: "old",
  startQ: 0,
  durationSeconds: 20,
  trimStartSeconds: 0,
  tint: "#111",
  accent: "#222",
};

const project: ProjectState = {
  ...INITIAL_PROJECT_STATE,
  bpm: 120,
  sourceTracks: [
    { id: "cam", name: "Cam", colorIndex: 0, recordingPaths: [] },
    { id: "mic", name: "Mic", colorIndex: 1, recordingPaths: [] },
  ],
  sourceSpans: [existingSpan],
};

describe("addRecordedTakes", () => {
  it("adds each take to the media library and a clip at the playhead on its track", () => {
    const next = addRecordedTakes(project, [
      { trackId: "cam", item: take("take-cam"), startQ: 8 },
      {
        trackId: "mic",
        item: take("take-mic", { hasVideo: false }),
        startQ: 8,
      },
    ]);
    assert.deepEqual(
      next.mediaItems.map((item) => item.id),
      ["take-cam", "take-mic"],
    );
    const added = next.sourceSpans.filter((span) => span.mediaId !== "old");
    assert.deepEqual(
      added.map((span) => [span.sourceTrackId, span.mediaId, span.startQ]),
      [
        ["cam", "take-cam", 8],
        ["mic", "take-mic", 8],
      ],
    );
    assert.deepEqual(
      added.map((span) => [span.trimStartSeconds, span.durationSeconds]),
      [
        [0, 4],
        [0, 4],
      ],
    );
    assert.deepEqual(next.sourceTracks[0]?.recordingPaths, ["take-cam.webm"]);
  });

  it("overwrites what the take lands on, like dropped media", () => {
    const next = addRecordedTakes(project, [
      { trackId: "cam", item: take("take-cam"), startQ: 8 },
    ]);
    const cam = next.sourceSpans
      .filter((span) => span.sourceTrackId === "cam")
      .sort((a, b) => a.startQ - b.startQ);
    assert.deepEqual(
      cam.map((span) => span.mediaId),
      ["take-cam", "old"],
    );
    // The take covers quarters 8–16 (4 s at 120 BPM); the old clip now
    // starts after it, at the same point in its media.
    assert.deepEqual(
      cam.map((span) => [
        span.startQ,
        span.durationSeconds,
        span.trimStartSeconds,
      ]),
      [
        [8, 4, 0],
        [16, 12, 8],
      ],
    );
  });

  it("places a take where it was recorded on locked source tracks", () => {
    const next = addRecordedTakes({ ...project, sourceTracksLocked: true }, [
      { trackId: "mic", item: take("take-mic"), startQ: 6 },
    ]);
    assert.equal(
      next.sourceSpans.find((span) => span.mediaId === "take-mic")?.startQ,
      6,
    );
    assert.equal(next.sourceTracksLocked, true);
  });

  it("gives each take with sound a Gain", () => {
    const next = addRecordedTakes(project, [
      { trackId: "mic", item: take("take-mic"), startQ: 0 },
    ]);
    assert.ok(next.effects.length > project.effects.length);
  });

  it("leaves out takes whose track was deleted", () => {
    assert.equal(
      addRecordedTakes(project, [
        { trackId: "gone", item: take("take"), startQ: 0 },
      ]),
      project,
    );
  });
});

describe("recorded take files", () => {
  it("names a take after its track and when recording started", () => {
    assert.equal(
      recordedTakeFileName("Cam: A/B", new Date(2026, 9, 3, 9, 5, 7), "webm"),
      "Cam A B 2026-10-03 09.05.07.webm",
    );
    assert.equal(
      recordedTakeFileName("  ", new Date(2026, 0, 1, 0, 0, 0), "m4a"),
      "Recording 2026-01-01 00.00.00.m4a",
    );
  });

  it("uses the recorded length when the file reports none", () => {
    assert.equal(
      withRecordedDuration(take("a", { durationSeconds: Infinity }), 3.2)
        .durationSeconds,
      3.2,
    );
    assert.equal(
      withRecordedDuration(take("a", { durationSeconds: 0 }), 3.2)
        .durationSeconds,
      3.2,
    );
    assert.equal(
      withRecordedDuration(take("a", { durationSeconds: 3.1 }), 3.2)
        .durationSeconds,
      3.1,
    );
  });
});
