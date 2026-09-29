import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClipWarp } from "./clip-warp.ts";
import { clipSourceFrame } from "./session.ts";
import {
  chooseSessionSaveTarget,
  projectToLvpSession,
  type SaveableProject,
} from "./session-save.ts";
import {
  parseWorkspaceSession,
  serializeWorkspaceSession,
  type WorkspaceSessionSource,
} from "./workspace-session.ts";

describe("chooseSessionSaveTarget", () => {
  it("writes a path-opened session back to its path", () => {
    assert.deepEqual(
      chooseSessionSaveTarget(
        { kind: "path", name: "set.lvp", path: "/Users/me/set.lvp" },
        "set.lvp",
      ),
      { kind: "path", path: "/Users/me/set.lvp" },
    );
  });

  it("targets the restored path after a refresh", () => {
    const source: WorkspaceSessionSource = {
      kind: "path",
      name: "set.lvp",
      path: "C:\\Sessions\\set.lvp",
    };
    const payload = serializeWorkspaceSession({
      history: { past: [], present: { clips: [] }, future: [] },
      view: {},
      source,
    });
    const restored = parseWorkspaceSession(payload, {
      normalizeState: (value) => value,
      normalizeView: (value) => value,
    });
    assert.deepEqual(chooseSessionSaveTarget(restored.source, "set.lvp"), {
      kind: "path",
      path: "C:\\Sessions\\set.lvp",
    });
  });

  it("prompts for a session opened from a browser file", () => {
    assert.deepEqual(
      chooseSessionSaveTarget({ kind: "file", name: "set.lvp" }, "set.lvp"),
      { kind: "prompt", filename: "set.lvp" },
    );
  });

  it("prompts for a session opened from a workspace", () => {
    assert.deepEqual(
      chooseSessionSaveTarget(
        { kind: "workspace", name: "session.json" },
        "session.json",
      ),
      { kind: "prompt", filename: "session.json" },
    );
  });

  it("prompts for an imported Live set, suggesting the sibling .lvp", () => {
    assert.deepEqual(
      chooseSessionSaveTarget({ kind: "import", name: "Song.als" }, "Song.als"),
      { kind: "prompt", filename: "Song.lvp" },
    );
  });

  it("prompts for a session with no source, named after the session", () => {
    assert.deepEqual(chooseSessionSaveTarget({ kind: "none" }, "Demo"), {
      kind: "prompt",
      filename: "Demo.lvp",
    });
    assert.deepEqual(chooseSessionSaveTarget({ kind: "none" }, null), {
      kind: "prompt",
      filename: "zvid-session.lvp",
    });
  });
});

function baseProject(
  overrides: Partial<SaveableProject> = {},
): SaveableProject {
  return {
    bpm: 120,
    fps: 30,
    canvasWidth: 1080,
    canvasHeight: 1920,
    zoom: 1.5,
    timelineMode: "musical",
    snapEnabled: true,
    lanes: [{ id: "main-1", name: "Layer 1", colorIndex: 2 }],
    sourceTracks: [
      {
        id: "t1",
        name: "Cam",
        colorIndex: 0,
        recordingPaths: ["/media/cam.mov"],
      },
    ],
    sourceSpans: [
      {
        id: "source-c1",
        sourceTrackId: "t1",
        label: "Cam",
        mediaPath: "/media/cam.mov",
        // 2 s at 120 bpm.
        startQ: 4,
        durationSeconds: 10,
        trimStartSeconds: 1,
      },
    ],
    clips: [
      {
        id: "selection-7",
        sourceTrackId: "t1",
        laneId: "main-1",
        startQ: 6,
        durationSeconds: 2,
      },
      {
        id: "clip-added",
        sourceTrackId: "t1",
        laneId: "main-1",
        startQ: 10,
        durationSeconds: 1,
      },
    ],
    effects: [
      {
        id: "fx1",
        trackId: "main-1",
        effectName: "Layout",
        parameters: [
          { key: "scale", value: "1.250", numericValue: 1.25 },
          { key: "anchor", value: "center" },
        ],
      },
    ],
    mediaItems: [{ id: "m1", name: "mix.wav", sourcePath: "/media/mix.wav" }],
    mainAudioId: "m1",
    projectDurationFrames: 900,
    ...overrides,
  };
}

describe("projectToLvpSession", () => {
  it("writes tracks, clips, selections, effects and timeline", () => {
    const { session, skippedFillClips } = projectToLvpSession(baseProject(), {
      playheadQ: 2,
      selectedClipId: "clip-added",
    });

    assert.equal(skippedFillClips, 0);
    assert.deepEqual(session.mainTracks, [
      { id: "main-1", name: "Layer 1", colorIndex: 2 },
    ]);
    assert.deepEqual(session.tracks, [
      {
        id: "t1",
        name: "Cam",
        colorIndex: 0,
        recordings: [{ filename: "/media/cam.mov" }],
      },
    ]);
    assert.deepEqual(session.clips, [
      {
        id: "c1",
        trackId: "t1",
        name: "Cam",
        frameStart: 60,
        frameCount: 300,
        clipStart: 30,
        filePath: "/media/cam.mov",
      },
    ]);
    assert.deepEqual(session.selections, [
      {
        id: 7,
        trackId: "t1",
        mainTrackId: "main-1",
        frameStart: 90,
        frameEnd: 150,
      },
      {
        id: 0,
        trackId: "t1",
        mainTrackId: "main-1",
        frameStart: 150,
        frameEnd: 180,
        selected: true,
      },
    ]);
    assert.deepEqual(session.effects, [
      {
        id: "fx1",
        trackId: "main-1",
        effectName: "Layout",
        parameters: {
          scale: { floatValue: 1.25 },
          anchor: { stringValue: "center" },
        },
      },
    ]);
    assert.deepEqual(session.timeline, {
      bpm: 120,
      fps: 30,
      canvasWidth: 1080,
      canvasHeight: 1920,
      displaySeconds: false,
      snapToBeat: true,
      zoom: 1.5,
      projectDuration: 900,
    });
    assert.equal(session.playPosition, 30);
    assert.equal(session.audioFilename, "/media/mix.wav");
  });

  it("does not reuse a selection id another clip keeps", () => {
    const { session } = projectToLvpSession(
      baseProject({
        clips: [
          {
            id: "new-a",
            sourceTrackId: "t1",
            laneId: "main-1",
            startQ: 0,
            durationSeconds: 1,
          },
          {
            id: "selection-0",
            sourceTrackId: "t1",
            laneId: "main-1",
            startQ: 4,
            durationSeconds: 1,
          },
        ],
      }),
      { playheadQ: 0 },
    );
    assert.deepEqual(
      session.selections?.map((selection) => selection.id),
      [1, 0],
    );
  });

  it("leaves out fill clips and counts them", () => {
    const project = baseProject();
    const { session, skippedFillClips } = projectToLvpSession(
      {
        ...project,
        clips: [
          ...project.clips,
          {
            id: "fill-1",
            kind: "fill",
            sourceTrackId: "",
            laneId: "main-1",
            startQ: 0,
            durationSeconds: 1,
          },
        ],
      },
      { playheadQ: 0 },
    );
    assert.equal(skippedFillClips, 1);
    assert.equal(session.selections?.length, 2);
  });

  it("keeps a warped span's source start and warp anchor", () => {
    const fps = 30;
    const bpm = 120;
    const markers = [
      { beatTime: 0, secTime: 0 },
      { beatTime: 8, secTime: 2 },
    ];
    // Opened with clipStart 30, frameOffset 0, captureOffset 12.
    const trimStartSeconds = 42 / fps;
    const warp = createClipWarp(markers, 30 / fps, trimStartSeconds, bpm);
    assert.ok(warp);

    const { session } = projectToLvpSession(
      baseProject({
        sourceSpans: [
          {
            id: "source-c1",
            sourceTrackId: "t1",
            label: "Cam",
            mediaPath: "/media/cam.mov",
            startQ: 0,
            durationSeconds: 4,
            trimStartSeconds,
            warp,
          },
        ],
      }),
      { playheadQ: 0 },
    );
    const clip = session.clips?.[0];
    assert.ok(clip);
    assert.equal(clip.clipStart, 30);
    assert.equal(clip.captureOffset, 12);
    assert.equal(clipSourceFrame(clip), 42);
    assert.deepEqual(
      clip.warpMarkers?.map(({ beatTime, secTime }) => ({ beatTime, secTime })),
      markers,
    );
    assert.deepEqual(
      createClipWarp(
        clip.warpMarkers,
        ((clip.clipStart ?? 0) + (clip.frameOffset ?? 0)) / fps,
        clipSourceFrame(clip) / fps,
        bpm,
      ),
      warp,
    );
  });
});
