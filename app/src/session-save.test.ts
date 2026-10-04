import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionToProject } from "./app/session-project.ts";
import { createClipWarp } from "./clip-warp.ts";
import type { EffectAnimation } from "./fx-animation-defaults.ts";
import type { EffectModulation } from "./fx-modulation-defaults.ts";
import { hasGlobalOrder, mapEffects, pruneClipEffects } from "./fx-stack.ts";
import { migrateDefaultOrder } from "./project-state-compat.ts";
import { clipSourceFrame, type LvpSession } from "./session.ts";
import {
  projectExportFilename,
  projectToLvpSession,
  readSelectionSlip,
  readSelectionTrackOffset,
  readSessionFills,
  readSessionFxClips,
  readSessionTexts,
  type SaveableProject,
} from "./session-save.ts";
import { renameSourceTrack } from "./source-track-edits.ts";
import {
  parseWorkspaceSession,
  serializeWorkspaceSession,
  type WorkspaceSessionSource,
} from "./workspace-session.ts";

describe("projectExportFilename", () => {
  it("names a path-opened session's export after its file, as .zvd", () => {
    assert.equal(
      projectExportFilename(
        { kind: "path", name: "set.lvp", path: "/Users/me/set.lvp" },
        "set.lvp",
      ),
      "set.zvd",
    );
  });

  it("keeps the opened file's name after a refresh", () => {
    const source: WorkspaceSessionSource = {
      kind: "path",
      name: "set.zvd",
      path: "C:\\Sessions\\set.zvd",
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
    assert.equal(projectExportFilename(restored.source, "set.zvd"), "set.zvd");
  });

  it("swaps a browser file session's extension for .zvd", () => {
    assert.equal(
      projectExportFilename({ kind: "file", name: "set.LVP" }, "set.LVP"),
      "set.zvd",
    );
    assert.equal(
      projectExportFilename(
        { kind: "file", name: "session.json" },
        "session.json",
      ),
      "session.zvd",
    );
  });

  it("names an imported Live set's export after the set", () => {
    assert.equal(
      projectExportFilename({ kind: "import", name: "Song.als" }, "Song.als"),
      "Song.zvd",
    );
  });

  it("names a session with no source after the session", () => {
    assert.equal(projectExportFilename({ kind: "none" }, "Demo"), "Demo.zvd");
    assert.equal(
      projectExportFilename({ kind: "none" }, null),
      "zvid-session.zvd",
    );
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
    // Audio comes only from clips, so no main audio file is written.
    assert.equal("audioFilename" in session, false);
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

  it("keeps FX clips out of selections and reads them back with their stack", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        clips: [
          ...project.clips,
          {
            id: "fx-1",
            kind: "fx",
            sourceTrackId: "",
            laneId: "main-1",
            startQ: 2,
            durationSeconds: 1.5,
          },
        ],
        effects: [
          ...project.effects,
          {
            id: "fx-colorize",
            trackId: "clip:fx-1",
            effectName: "Colorize",
            parameters: [{ key: "_HueOffset", value: "0.25" }],
          },
        ],
      },
      { playheadQ: 0, selectedClipId: "fx-1" },
    );
    assert.equal(session.selections?.length, 2);
    assert.equal(session.fills, undefined);
    assert.equal(session.texts, undefined);
    assert.deepEqual(session.fxClips, [
      {
        id: "fx-1",
        mainTrackId: "main-1",
        frameStart: 30,
        frameEnd: 75,
        selected: true,
      },
    ]);
    const reopened = JSON.parse(JSON.stringify(session)) as LvpSession;
    assert.deepEqual(readSessionFxClips(reopened, 120, 30), [
      {
        id: "fx-1",
        laneId: "main-1",
        startQ: 2,
        durationQ: 3,
        selected: true,
      },
    ]);
    assert.deepEqual(
      pruneClipEffects(mapEffects(reopened.effects), [{ id: "fx-1" }])
        .filter((effect) => effect.trackId === "clip:fx-1")
        .map((effect) => effect.effectName),
      ["Colorize"],
    );
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

  it("saves a source track's FX bypass, leaving the default unwritten", () => {
    const session = projectToLvpSession(
      {
        ...baseProject(),
        sourceTracks: [
          {
            id: "s1",
            name: "Camera A",
            colorIndex: 0,
            recordingPaths: [],
            fxEnabled: false,
          },
          {
            id: "s2",
            name: "Camera B",
            colorIndex: 1,
            recordingPaths: [],
            fxEnabled: true,
          },
        ],
      },
      { playheadQ: 0 },
    );
    assert.deepEqual(
      session.tracks?.map((track) => track.fxEnabled),
      [false, undefined],
    );
    assert.equal("fxEnabled" in (session.tracks?.[1] ?? {}), false);
  });

  it("round-trips effect animation settings", () => {
    const animation: EffectAnimation = {
      enabled: true,
      mode: "lfo",
      clip: { motionIn: "Linear", motionOut: "Ease In Out", timing: "Fast" },
      reactive: {
        motion: "Wobble",
        timing: "Slow",
        reactivity: 0.7,
        parameters: ["_LowIntensity"],
      },
      lfo: {
        shape: "Triangle",
        sync: true,
        rate: 2.5,
        syncRate: "1/8D",
        depth: 0.4,
        phase: 90,
        parameters: ["_NumPixels"],
      },
    };
    const session = projectToLvpSession(
      baseProject({
        effects: [
          {
            id: "animated",
            trackId: "main-1",
            effectName: "Pixelate",
            parameters: [],
            animation,
          },
          {
            id: "plain",
            trackId: "main-1",
            effectName: "Pixelate",
            parameters: [],
          },
        ],
      }),
      { playheadQ: 0 },
    );
    assert.deepEqual(session.effects?.[0]?.animation, animation);
    assert.equal("animation" in (session.effects?.[1] ?? {}), false);

    const [animated, plain] = mapEffects(
      JSON.parse(JSON.stringify(session)).effects,
    );
    assert.deepEqual(animated.animation, animation);
    assert.equal(plain.animation, undefined);
  });

  it("round-trips audio effect modulation settings", () => {
    const modulation: EffectModulation = {
      enabled: true,
      mode: "lfo",
      transient: {
        motion: "Wobble",
        timing: "Fast",
        reactivity: 0.4,
        parameters: ["Frequency"],
      },
      lfo: {
        shape: "Saw Down",
        sync: true,
        rate: 2.5,
        syncRate: "1/8D",
        depth: 0.6,
        phase: 90,
        parameters: ["Frequency", "Resonance"],
      },
    };
    const session = projectToLvpSession(
      baseProject({
        effects: [
          {
            id: "modulated",
            trackId: "main-1",
            effectName: "High Cut",
            parameters: [],
            modulation,
          },
          {
            id: "plain",
            trackId: "main-1",
            effectName: "High Cut",
            parameters: [],
          },
        ],
      }),
      { playheadQ: 0 },
    );
    assert.deepEqual(session.effects?.[0]?.modulation, modulation);
    assert.equal("modulation" in (session.effects?.[1] ?? {}), false);

    const [modulated, plain] = mapEffects(
      JSON.parse(JSON.stringify(session)).effects,
    );
    assert.deepEqual(modulated.modulation, modulation);
    assert.equal(plain.modulation, undefined);
  });

  it("drops an Order's exclusions of layers that no longer exist", () => {
    const project = baseProject();
    const session = projectToLvpSession(
      {
        ...project,
        effects: [
          ...project.effects,
          {
            id: "order",
            trackId: "__group_main",
            effectName: "Order",
            parameters: [
              { key: "Arrangement", value: "Grid" },
              { key: "ExcludedLayers", value: "main-1,main-9" },
            ],
          },
        ],
      },
      { playheadQ: 0 },
    );
    assert.deepEqual(session.effects?.[1]?.parameters, {
      Arrangement: { stringValue: "Grid" },
      ExcludedLayers: { stringValue: "main-1" },
    });
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

  it("round-trips a renamed source track with its span and clip labels", () => {
    const project = baseProject();
    const { sourceTracks, sourceSpans, clips } = renameSourceTrack(
      {
        sourceTracks: project.sourceTracks,
        sourceSpans: project.sourceSpans.map((span) => ({
          ...span,
          tint: "#000",
          accent: "#fff",
        })),
        clips: project.clips.map((clip) => ({
          ...clip,
          sourceSpanId: "source-c1",
          label: "Cam",
        })),
        effects: [],
      },
      "t1",
      "Wide",
    );
    const session = projectToLvpSession(
      { ...project, sourceTracks, sourceSpans, clips },
      { playheadQ: 0 },
    );
    assert.deepEqual(
      session.tracks?.map((track) => track.name),
      ["Wide"],
    );

    const restored = sessionToProject(session, []);
    assert.deepEqual(
      restored.sourceTracks.map((track) => track.name),
      ["Wide"],
    );
    assert.deepEqual(
      restored.sourceSpans.map((span) => span.label),
      ["Wide"],
    );
    assert.deepEqual(
      restored.arrangementClips.map((clip) => clip.label),
      ["Wide", "Wide"],
    );
  });

  it("round-trips a slipped clip's source track offset", () => {
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
    assert.equal("sourceTrackOffsetSeconds" in unslipped, false);
    assert.equal("sourceClipId" in slipped, false);
    // It shows its source track 3.25 s after its own position.
    assert.equal(slipped.sourceTrackOffsetSeconds, 3.25);

    const spans = sessionToProject(session, []).sourceSpans;
    assert.equal(readSelectionTrackOffset(unslipped, spans, 120), 0);
    assert.equal(readSelectionTrackOffset(slipped, spans, 120), 3.25);
  });

  it("keeps a clip's window once its source clip was trimmed away from its start", () => {
    const project = baseProject();
    // The span now starts at 4 s (8 quarters), after the clip's start. The
    // clip was made when the span played at the same offset, -1 s, so it
    // still shows the track at its own position, where nothing is now.
    const session = projectToLvpSession(
      {
        ...project,
        sourceSpans: [
          {
            ...project.sourceSpans[0],
            startQ: 8,
            durationSeconds: 8,
            trimStartSeconds: 3,
          },
        ],
        clips: [
          {
            ...project.clips[0],
            sourceSpanId: "source-c1",
            sourceOffsetSeconds: -1,
            sourceSpanOffsetSeconds: -1,
          },
        ],
      },
      { playheadQ: 0 },
    );
    const [selection] = session.selections ?? [];
    assert.ok(selection);
    assert.equal("sourceTrackOffsetSeconds" in selection, false);
    assert.equal(readSelectionTrackOffset(selection, [], 120), 0);
  });

  it("reads an older build's slip against the source clip it names", () => {
    const project = baseProject();
    const session = projectToLvpSession(project, { playheadQ: 0 });
    const spans = sessionToProject(session, []).sourceSpans;
    // Saved against c1, whose offset is -1 s, with a 2.25 s offset.
    const [selection] = session.selections ?? [];
    assert.ok(selection);
    const older = {
      ...selection,
      sourceClipId: "c1",
      sourceOffsetSeconds: 2.25,
    };
    assert.equal(readSelectionTrackOffset(older, spans, 120), 3.25);
  });

  it("opens sessions without zvid-only fields as before", () => {
    const session = projectToLvpSession(baseProject(), { playheadQ: 0 });
    assert.equal(session.fills, undefined);
    assert.equal(session.texts, undefined);
    assert.equal(session.fxClips, undefined);
    assert.equal("fxEnabled" in (session.mainTracks?.[0] ?? {}), false);
    assert.deepEqual(readSessionFills(session, 120, 30), []);
    assert.deepEqual(readSessionTexts(session, 120, 30), []);
    assert.deepEqual(readSessionFxClips(session, 120, 30), []);
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

  it("round-trips source track and source clip stacks", () => {
    const project = baseProject();
    const stackEffect = (id: string, trackId: string) => ({
      id,
      trackId,
      effectName: "Pixelate",
      parameters: [{ key: "Size", value: "0.500", numericValue: 0.5 }],
    });
    const session = projectToLvpSession(
      {
        ...project,
        sourceSpans: [
          ...project.sourceSpans,
          {
            ...project.sourceSpans[0],
            id: "span-added",
            startQ: 40,
          },
        ],
        effects: [
          ...project.effects,
          stackEffect("track", "source-track:t1"),
          stackEffect("kept-id", "source-clip:source-c1"),
          stackEffect("new-span", "source-clip:span-added"),
          stackEffect("gone", "source-track:gone"),
        ],
      },
      { playheadQ: 0 },
    );
    // span-added loads back as source-span-added, so its stack is saved
    // under that id.
    assert.deepEqual(
      session.effects?.map((effect) => effect.trackId),
      [
        "main-1",
        "source-track:t1",
        "source-clip:source-c1",
        "source-clip:source-span-added",
        "source-track:gone",
      ],
    );

    const restored = sessionToProject(
      JSON.parse(JSON.stringify(session)) as LvpSession,
      [],
    );
    assert.deepEqual(
      restored.sourceSpans.map((span) => span.id),
      ["source-c1", "source-span-added"],
    );
    // A stack whose source track no longer exists is dropped.
    assert.deepEqual(
      restored.effects
        .filter((effect) => effect.trackId.startsWith("source-"))
        .map((effect) => [effect.id, effect.trackId]),
      [
        ["track", "source-track:t1"],
        ["kept-id", "source-clip:source-c1"],
        ["new-span", "source-clip:source-span-added"],
      ],
    );
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
