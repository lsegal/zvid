import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClipWarp } from "./clip-warp.ts";
import { hasGlobalOrder, mapEffects, pruneClipEffects } from "./fx-stack.ts";
import { migrateDefaultOrder } from "./project-state-compat.ts";
import { clipSourceFrame, type LvpSession } from "./session.ts";
import {
  chooseSessionSaveTarget,
  projectToLvpSession,
  readSelectionSlip,
  readSessionFills,
  readSessionTexts,
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
    const session = projectToLvpSession(baseProject(), {
      playheadQ: 2,
      selectedClipId: "clip-added",
    });

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
    const session = projectToLvpSession(
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

  it("keeps fill clips out of selections and reads them back", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        clips: [
          ...project.clips,
          {
            id: "fill-1",
            kind: "fill",
            sourceTrackId: "",
            laneId: "main-1",
            // 1 s at 120 bpm.
            startQ: 2,
            durationSeconds: 1.5,
          },
        ],
      },
      { playheadQ: 0, selectedClipId: "fill-1" },
    );
    assert.equal(session.selections?.length, 2);
    assert.deepEqual(session.fills, [
      {
        id: "fill-1",
        mainTrackId: "main-1",
        frameStart: 30,
        frameEnd: 75,
        selected: true,
      },
    ]);
    assert.deepEqual(readSessionFills(session, 120, 30), [
      {
        id: "fill-1",
        laneId: "main-1",
        startQ: 2,
        durationQ: 3,
        selected: true,
      },
    ]);
  });

  it("round-trips effect and layer FX bypass", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        lanes: [
          { id: "main-1", name: "Layer 1", colorIndex: 2, fxEnabled: false },
          { id: "main-2", name: "Layer 2", colorIndex: 3, fxEnabled: true },
        ],
        effects: [
          { ...project.effects[0], enabled: false },
          { ...project.effects[0], id: "fx2", enabled: true },
        ],
      },
      { playheadQ: 0 },
    );
    assert.deepEqual(session.mainTracks, [
      { id: "main-1", name: "Layer 1", colorIndex: 2, fxEnabled: false },
      { id: "main-2", name: "Layer 2", colorIndex: 3 },
    ]);
    assert.equal(session.effects?.[0]?.enabled, false);
    assert.equal("enabled" in (session.effects?.[1] ?? {}), false);
    assert.deepEqual(
      mapEffects(session.effects).map((effect) => effect.enabled),
      [false, true],
    );
  });

  it("keeps a removed Order removed when reopened", () => {
    const session = projectToLvpSession(baseProject(), { playheadQ: 0 });
    assert.equal(session.orderDefaulted, true);

    const reopened = JSON.parse(JSON.stringify(session)) as typeof session;
    const effects = migrateDefaultOrder(
      mapEffects(reopened.effects),
      reopened.orderDefaulted,
    );
    assert.equal(hasGlobalOrder(effects), false);
    assert.deepEqual(
      effects.map((effect) => effect.id),
      ["fx1"],
    );
  });

  it("round-trips a slipped clip's span and source offset", () => {
    const project = baseProject();
    // The span's offset is trimStart 1 s minus its 2 s start: -1 s.
    const session = projectToLvpSession(
      {
        ...project,
        clips: [
          {
            ...project.clips[0],
            sourceSpanId: "source-c1",
            sourceOffsetSeconds: -1,
          },
          {
            ...project.clips[1],
            sourceSpanId: "source-c1",
            sourceOffsetSeconds: 2.25,
          },
        ],
      },
      { playheadQ: 0 },
    );
    const [unslipped, slipped] = session.selections ?? [];
    assert.ok(unslipped && slipped);
    assert.equal("sourceClipId" in unslipped, false);
    assert.equal(readSelectionSlip(unslipped), undefined);
    assert.equal(slipped.sourceClipId, "c1");
    assert.deepEqual(readSelectionSlip(slipped), {
      sourceSpanId: "source-c1",
      sourceOffsetSeconds: 2.25,
    });
  });

  it("opens sessions without zvid-only fields as before", () => {
    const session = projectToLvpSession(baseProject(), { playheadQ: 0 });
    assert.equal(session.fills, undefined);
    assert.equal(session.texts, undefined);
    assert.equal("fxEnabled" in (session.mainTracks?.[0] ?? {}), false);
    assert.deepEqual(readSessionFills(session, 120, 30), []);
    assert.deepEqual(readSessionTexts(session, 120, 30), []);
    assert.ok(
      session.selections?.every(
        (selection) => readSelectionSlip(selection) === undefined,
      ),
    );
    assert.deepEqual(
      mapEffects(session.effects).map((effect) => effect.enabled),
      [true],
    );
  });

  it("skips malformed zvid-only fields", () => {
    const session = JSON.parse(
      JSON.stringify({
        fills: [
          { id: "ok", mainTrackId: "main-1", frameStart: 0, frameEnd: 30 },
          { id: "bad", mainTrackId: 3, frameStart: 0, frameEnd: 30 },
          null,
        ],
        texts: [
          { id: "ok", mainTrackId: "main-1", frameStart: 0, frameEnd: 30 },
          { id: "", mainTrackId: "main-1", frameStart: 0, frameEnd: 30 },
          { id: "bad", mainTrackId: "main-1", frameStart: "0", frameEnd: 30 },
        ],
      }),
    );
    assert.deepEqual(
      readSessionFills(session, 120, 30).map((fill) => fill.id),
      ["ok"],
    );
    assert.deepEqual(
      readSessionTexts(session, 120, 30).map((text) => text.id),
      ["ok"],
    );
    assert.deepEqual(
      readSessionTexts({ texts: "nope" } as unknown as LvpSession, 120, 30),
      [],
    );
    assert.equal(
      readSelectionSlip({
        id: 0,
        trackId: "t1",
        mainTrackId: "main-1",
        frameStart: 0,
        frameEnd: 30,
        sourceClipId: "c1",
        sourceOffsetSeconds: "2" as unknown as number,
      }),
      undefined,
    );
  });

  it("keeps text clips out of selections and reads them back", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        clips: [
          ...project.clips,
          {
            id: "text-1",
            kind: "text",
            sourceTrackId: "",
            laneId: "main-2",
            // 1 s at 120 bpm.
            startQ: 2,
            durationSeconds: 1.5,
          },
        ],
      },
      { playheadQ: 0, selectedClipId: "text-1" },
    );
    assert.equal(session.selections?.length, 2);
    assert.equal(session.fills, undefined);
    assert.deepEqual(session.texts, [
      {
        id: "text-1",
        mainTrackId: "main-2",
        frameStart: 30,
        frameEnd: 75,
        selected: true,
      },
    ]);
    assert.deepEqual(readSessionTexts(session, 120, 30), [
      {
        id: "text-1",
        laneId: "main-2",
        startQ: 2,
        durationQ: 3,
        selected: true,
      },
    ]);
    assert.deepEqual(readSessionFills(session, 120, 30), []);
    const reopened = JSON.parse(JSON.stringify(session));
    assert.deepEqual(
      readSessionTexts(reopened, 120, 30),
      readSessionTexts(session, 120, 30),
    );
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

    const session = projectToLvpSession(
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

describe("clip stacks in a saved session", () => {
  it("saves a media clip's stack under the id it loads back with", () => {
    const project = baseProject();
    const stackEffect = (id: string, trackId: string) => ({
      id,
      trackId,
      effectName: "Transform",
      parameters: [{ key: "ScaleX", value: "0.500", numericValue: 0.5 }],
    });
    const session = projectToLvpSession(
      {
        ...project,
        effects: [
          ...project.effects,
          stackEffect("kept-id", "clip:selection-7"),
          stackEffect("new-clip", "clip:clip-added"),
        ],
      },
      { playheadQ: 0 },
    );
    // clip-added is saved as selection 0, selection-7 keeps its number.
    assert.deepEqual(
      session.effects?.map((effect) => effect.trackId),
      ["main-1", "clip:selection-7", "clip:selection-0"],
    );

    const reopened = JSON.parse(JSON.stringify(session)) as LvpSession;
    const loadedClipIds = (reopened.selections ?? []).map((selection) => ({
      id: `selection-${selection.id}`,
    }));
    const effects = pruneClipEffects(
      mapEffects(reopened.effects),
      loadedClipIds,
    );
    assert.deepEqual(
      effects.map((effect) => [effect.id, effect.trackId]),
      [
        ["fx1", "main-1"],
        ["kept-id", "clip:selection-7"],
        ["new-clip", "clip:selection-0"],
      ],
    );
    assert.equal(effects[2].parameters[0]?.numericValue, 0.5);
  });

  it("keeps a fill or text clip's stack under its own id", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        clips: [
          ...project.clips,
          {
            id: "text-1",
            kind: "text",
            sourceTrackId: "",
            laneId: "main-1",
            startQ: 0,
            durationSeconds: 1,
          },
        ],
        effects: [
          {
            id: "text",
            trackId: "clip:text-1",
            effectName: "Text",
            parameters: [{ key: "Text", value: "Hi" }],
          },
        ],
      },
      { playheadQ: 0 },
    );
    assert.deepEqual(
      session.texts?.map((clip) => clip.id),
      ["text-1"],
    );
    assert.deepEqual(
      session.effects?.map((effect) => effect.trackId),
      ["clip:text-1"],
    );
  });
});
