import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { warpSourceTime } from "../clip-warp.ts";
import type { MediaItem } from "../media.ts";
import type { LvpSession } from "../session.ts";
import { projectToLvpSession } from "../session-save.ts";
import { retimeSourceSpan } from "../source-span-edit.ts";
import { DEFAULT_LANES, INITIAL_PROJECT_STATE } from "./constants.ts";
import {
  buildStandaloneProject,
  mergeMediaItemsById,
  patchProjectState,
  pickMediaByPath,
  sessionToProject,
} from "./session-project.ts";
import { quartersToSeconds } from "./timeline-math.ts";

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "a",
  name: "take.mp4",
  kind: "video",
  durationSeconds: 5,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  availability: "ready",
  ...extra,
});

describe("patchProjectState", () => {
  it("returns the same state when nothing changes", () => {
    assert.equal(
      patchProjectState(INITIAL_PROJECT_STATE, { bpm: 120 }),
      INITIAL_PROJECT_STATE,
    );
  });

  it("applies changed fields", () => {
    const next = patchProjectState(INITIAL_PROJECT_STATE, { bpm: 90 });
    assert.notEqual(next, INITIAL_PROJECT_STATE);
    assert.equal(next.bpm, 90);
  });

  it("drops the stacks of source clips and tracks a patch removes", () => {
    const stack = (id: string, trackId: string) => ({
      id,
      trackId,
      effectName: "Pixelate",
      parameters: [],
      enabled: true,
    });
    const span = {
      sourceTrackId: "t1",
      label: "Cam",
      mediaPath: "cam.mov",
      startQ: 0,
      durationSeconds: 1,
      trimStartSeconds: 0,
      tint: "#000",
      accent: "#fff",
    };
    const current = {
      ...INITIAL_PROJECT_STATE,
      sourceTracks: [
        { id: "t1", name: "Cam", colorIndex: 0, recordingPaths: [] },
      ],
      sourceSpans: [
        { ...span, id: "s1" },
        { ...span, id: "s2" },
      ],
      effects: [
        stack("track", "source-track:t1"),
        stack("s1", "source-clip:s1"),
        stack("s2", "source-clip:s2"),
      ],
    };
    // An overlap that removes s2 takes its stack with it.
    const trimmed = patchProjectState(current, {
      sourceSpans: [current.sourceSpans[0]],
    });
    assert.deepEqual(
      trimmed.effects.map((effect) => effect.id),
      ["track", "s1"],
    );
    const emptied = patchProjectState(current, {
      sourceTracks: [],
      sourceSpans: [],
    });
    assert.deepEqual(emptied.effects, []);
  });
});

describe("mergeMediaItemsById", () => {
  it("replaces known items and ignores unknown ones", () => {
    const merged = mergeMediaItemsById(
      [media(), media({ id: "b" })],
      [media({ name: "new.mp4" }), media({ id: "c" })],
    );
    assert.deepEqual(
      merged.map((item) => [item.id, item.name]),
      [
        ["a", "new.mp4"],
        ["b", "take.mp4"],
      ],
    );
  });

  it("keeps the In/Out points of the items it replaces", () => {
    const [merged] = mergeMediaItemsById(
      [media({ durationSeconds: 0, rangeInSeconds: 1, rangeOutSeconds: 2 })],
      [media({ durationSeconds: 5 })],
    );
    assert.equal(merged?.durationSeconds, 5);
    assert.equal(merged?.rangeInSeconds, 1);
    assert.equal(merged?.rangeOutSeconds, 2);
  });
});

describe("pickMediaByPath", () => {
  it("matches the source path first, then the file name", () => {
    const bySource = media({ id: "src", sourcePath: "C:\\clips\\take.mp4" });
    const byName = media({ id: "name" });
    assert.equal(
      pickMediaByPath([byName, bySource], "c:/clips/take.mp4")?.id,
      "src",
    );
    assert.equal(pickMediaByPath([byName], "/elsewhere/TAKE.mp4")?.id, "name");
    assert.equal(pickMediaByPath([byName], " "), undefined);
  });
});

describe("buildStandaloneProject", () => {
  it("lays imported media out across the default layers", () => {
    const project = buildStandaloneProject([
      media({ width: 640, height: 360 }),
      media({ id: "b", name: "b.mov" }),
    ]);
    assert.equal(project.lanes, DEFAULT_LANES);
    assert.equal(project.canvasWidth, 640);
    assert.equal(project.canvasHeight, 360);
    assert.deepEqual(
      project.arrangementClips.map((clip) => [clip.laneId, clip.startQ]),
      [
        [DEFAULT_LANES[0].id, 0],
        [DEFAULT_LANES[1].id, 4],
      ],
    );
    assert.equal(project.sourceTracks[1].name, "b");
  });
});

describe("a start-trimmed warped source clip", () => {
  const bpm = 120;
  const fps = 30;
  // Plays the source at half speed for 4 beats, then at 3/4 speed.
  const session: LvpSession = {
    mainTracks: [{ id: "main-1", name: "Layer 1" }],
    tracks: [{ id: "t1", name: "Cam" }],
    clips: [
      {
        id: "c1",
        trackId: "t1",
        frameStart: 0,
        frameCount: 240,
        clipStart: 30,
        captureOffset: 12,
        filePath: "/media/cam.mov",
        warpMarkers: [
          { id: "w0", clipId: "c1", beatTime: 0, secTime: 0 },
          { id: "w1", clipId: "c1", beatTime: 4, secTime: 1 },
          { id: "w2", clipId: "c1", beatTime: 8, secTime: 2.5 },
        ],
      },
    ],
    selections: [
      {
        id: 7,
        trackId: "t1",
        mainTrackId: "main-1",
        frameStart: 90,
        frameEnd: 150,
      },
    ],
    timeline: { bpm, fps },
  };

  // The project with its span's first 2 beats (1 s) trimmed off.
  function trimmedProject() {
    const project = sessionToProject(session, []);
    const [span] = project.sourceSpans;
    const durationQ = (span.durationSeconds * bpm) / 60;
    return {
      ...project,
      sourceSpans: [
        retimeSourceSpan(span, span.startQ + 2, durationQ - 2, bpm),
      ],
    };
  }

  function saveAndReopen(project: ReturnType<typeof trimmedProject>) {
    const saved = projectToLvpSession(
      {
        ...project,
        timelineMode: "musical",
        snapEnabled: true,
        clips: project.arrangementClips,
        mediaItems: [],
      },
      { playheadQ: 0 },
    );
    return sessionToProject(JSON.parse(JSON.stringify(saved)), []);
  }

  // Source seconds a clip plays at each song second from `fromSeconds`.
  function playedSeconds(
    clip: { warp?: Parameters<typeof warpSourceTime>[0] },
    sourceOffsetSeconds: number,
    fromSeconds: number,
  ) {
    assert.ok(clip.warp);
    const { warp } = clip;
    return [0, 0.5, 1, 1.75, 2.5, 4].map(
      (seconds) =>
        warpSourceTime(warp, fromSeconds + seconds + sourceOffsetSeconds, bpm)
          .seconds,
    );
  }

  it("plays the same media after a save and reopen", () => {
    const before = trimmedProject();
    const after = saveAndReopen(before);
    const offset = (span: (typeof before.sourceSpans)[number]) =>
      span.trimStartSeconds - quartersToSeconds(span.startQ, bpm);
    for (const [beforeSeconds, afterSeconds] of [
      [
        playedSeconds(before.sourceSpans[0], offset(before.sourceSpans[0]), 1),
        playedSeconds(after.sourceSpans[0], offset(after.sourceSpans[0]), 1),
      ],
      [
        playedSeconds(
          before.arrangementClips[0],
          before.arrangementClips[0].sourceOffsetSeconds ?? 0,
          3,
        ),
        playedSeconds(
          after.arrangementClips[0],
          after.arrangementClips[0].sourceOffsetSeconds ?? 0,
          3,
        ),
      ],
    ]) {
      afterSeconds.forEach((seconds, index) => {
        assert.ok(
          Math.abs(seconds - beforeSeconds[index]) < 1e-9,
          `${seconds} != ${beforeSeconds[index]}`,
        );
      });
    }
    assert.equal(after.sourceSpans[0].trimStartSeconds, 72 / fps);
  });

  it("anchors its warp at its source start in older sessions", () => {
    const saved = projectToLvpSession(
      {
        ...trimmedProject(),
        timelineMode: "musical",
        snapEnabled: true,
        clips: [],
        mediaItems: [],
      },
      { playheadQ: 0 },
    );
    const [clip] = saved.clips ?? [];
    assert.equal(clip?.warpAnchorSeconds, 42 / fps);
    delete clip.warpAnchorSeconds;
    const [span] = sessionToProject(saved, []).sourceSpans;
    assert.equal(span.warp?.anchorSeconds, span.trimStartSeconds);
  });

  it("writes no warp anchor for an untrimmed span", () => {
    const project = sessionToProject(session, []);
    const saved = projectToLvpSession(
      {
        ...project,
        timelineMode: "musical",
        snapEnabled: true,
        clips: [],
        mediaItems: [],
      },
      { playheadQ: 0 },
    );
    assert.equal(saved.clips?.[0].warpAnchorSeconds, undefined);
  });
});

describe("source track lock", () => {
  const session: LvpSession = {
    mainTracks: [{ id: "main-1", name: "Layer 1" }],
    tracks: [{ id: "t1", name: "Cam" }],
    clips: [
      {
        id: "c1",
        trackId: "t1",
        frameStart: 0,
        frameCount: 60,
        filePath: "/media/cam.mov",
      },
    ],
    timeline: { bpm: 120, fps: 30 },
  };

  it("opens a session without the flag unlocked", () => {
    assert.equal(sessionToProject(session, []).sourceTracksLocked, false);
    assert.equal(INITIAL_PROJECT_STATE.sourceTracksLocked, false);
  });

  it("opens a locked session locked", () => {
    assert.equal(
      sessionToProject({ ...session, sourceTracksLocked: true }, [])
        .sourceTracksLocked,
      true,
    );
  });

  it("survives a save and reopen, locked or unlocked", () => {
    for (const locked of [true, false]) {
      const project = sessionToProject(
        { ...session, sourceTracksLocked: locked },
        [],
      );
      const saved = projectToLvpSession(
        {
          ...INITIAL_PROJECT_STATE,
          ...project,
          clips: project.arrangementClips,
          timelineMode: "musical",
          snapEnabled: true,
          mediaItems: [],
        },
        { playheadQ: 0 },
      );
      // Unlocking is written too, so it isn't lost on reopen.
      assert.equal(saved.sourceTracksLocked, locked);
      const reopened = JSON.parse(JSON.stringify(saved)) as LvpSession;
      assert.equal(sessionToProject(reopened, []).sourceTracksLocked, locked);
    }
  });
});

describe("source track FX switch", () => {
  const session: LvpSession = {
    mainTracks: [{ id: "main-1", name: "Layer 1" }],
    tracks: [
      { id: "t1", name: "Cam A", fxEnabled: false },
      { id: "t2", name: "Cam B" },
    ],
    timeline: { bpm: 120, fps: 30 },
  };

  it("opens a bypassed source track bypassed, and others on", () => {
    const { sourceTracks } = sessionToProject(session, []);
    assert.equal(sourceTracks[0].fxEnabled, false);
    assert.equal("fxEnabled" in sourceTracks[1], false);
  });

  it("survives a save and reopen", () => {
    const project = sessionToProject(session, []);
    const saved = projectToLvpSession(
      {
        ...INITIAL_PROJECT_STATE,
        ...project,
        clips: project.arrangementClips,
        timelineMode: "musical",
        snapEnabled: true,
        mediaItems: [],
      },
      { playheadQ: 0 },
    );
    const reopened = JSON.parse(JSON.stringify(saved)) as LvpSession;
    assert.deepEqual(
      sessionToProject(reopened, []).sourceTracks.map((track) => [
        track.id,
        track.fxEnabled,
      ]),
      [
        ["t1", false],
        ["t2", undefined],
      ],
    );
  });
});
