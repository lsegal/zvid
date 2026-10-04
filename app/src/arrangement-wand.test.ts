import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyWandArrangement,
  createWandLanes,
  getWandEndQ,
  type WandSourceSpan,
} from "./arrangement-wand.ts";
import type { SessionEffect } from "./fx-stack.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import { buildRandomArrangement } from "./random-arrangement.ts";

const BPM = 120;
const FPS = 25;
const BAR = 4;
const WAND_LAYERS = 3;

// Mulberry32, so every run of a test sees the same windows.
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

// One quarter lasts half a second at 120 BPM.
const span = (
  sourceTrackId: string,
  startQ: number,
  endQ: number,
  mediaId = `${sourceTrackId}-media`,
): WandSourceSpan & { sourceTrackId: string } => ({
  sourceTrackId,
  mediaId,
  startQ,
  durationSeconds: (endQ - startQ) / 2,
});

const layoutEffect = (id: string, trackId: string): SessionEffect => ({
  id,
  trackId,
  effectName: "Layout",
  parameters: [],
  enabled: true,
});

// An imported set: 9 layers named after source tracks.
const importedLanes = Array.from({ length: 9 }, (_, index) => ({
  id: `${index + 1}`,
  name: `${index * 10 + 3}-Audio`,
  colorIndex: index,
}));

describe("getWandEndQ", () => {
  const spans = [
    span("video", 0, 48),
    // A frozen audio-only track that runs to about bar 31.
    span("frozen", 0, 124, "frozen.wav"),
  ];
  const isVideoSpan = (candidate: WandSourceSpan) =>
    candidate.mediaId !== "frozen.wav";

  it("uses the session length when there is one", () => {
    // 13 bars = 52 quarters = 26 seconds = 650 frames at 25 fps.
    assert.equal(
      getWandEndQ({
        projectDurationFrames: 650,
        fps: FPS,
        bpm: BPM,
        barLength: BAR,
        sourceSpans: spans,
        isVideoSpan,
      }),
      52,
    );
  });

  it("otherwise ends with the last video span, not audio-only ones", () => {
    assert.equal(
      getWandEndQ({
        fps: FPS,
        bpm: BPM,
        barLength: BAR,
        sourceSpans: spans,
        isVideoSpan,
      }),
      48,
    );
  });

  it("falls back to every span when none has video", () => {
    assert.equal(
      getWandEndQ({
        fps: FPS,
        bpm: BPM,
        barLength: BAR,
        sourceSpans: spans,
        isVideoSpan: () => false,
      }),
      124,
    );
  });
});

describe("createWandLanes", () => {
  it("creates Layer 1 to Layer 3 with ids no old layer uses", () => {
    const { videoLanes, lanes } = createWandLanes(importedLanes, WAND_LAYERS);
    assert.deepEqual(
      videoLanes.map((lane) => lane.name),
      ["Layer 1", "Layer 2", "Layer 3"],
    );
    const oldIds = new Set(importedLanes.map((lane) => lane.id));
    assert.ok(lanes.every((lane) => !oldIds.has(lane.id)));
    assert.equal(new Set(lanes.map((lane) => lane.id)).size, 4);
  });

  it("adds an Audio layer last that does not count toward the max", () => {
    const { audioLane, lanes } = createWandLanes(importedLanes, WAND_LAYERS);
    assert.equal(lanes.length, WAND_LAYERS + 1);
    assert.equal(audioLane.name, "Audio");
    assert.equal(lanes.at(-1), audioLane);
  });
});

describe("the wand on an imported set", () => {
  // The video runs to bar 12; a frozen audio-only track runs to about bar
  // 31. The session is 13 bars long.
  const sourceSpans = [
    span("video-a", 0, 48),
    span("video-b", 8, 48),
    span("frozen", 0, 124, "frozen.wav"),
  ];
  const endQ = getWandEndQ({
    projectDurationFrames: 650,
    fps: FPS,
    bpm: BPM,
    barLength: BAR,
    sourceSpans,
    isVideoSpan: (candidate) => candidate.mediaId !== "frozen.wav",
  });
  const wandLanes = createWandLanes(importedLanes, WAND_LAYERS);
  const arrange = (seed: number) =>
    buildRandomArrangement({
      laneIds: wandLanes.videoLanes.map((lane) => lane.id),
      audioLaneId: wandLanes.audioLane.id,
      isAudioOnly: (candidate) => candidate.mediaId === "frozen.wav",
      sourceTrackIds: ["video-a", "video-b", "frozen"],
      spans: sourceSpans,
      spanEndQ: (candidate) => candidate.startQ + candidate.durationSeconds * 2,
      timelineEndQ: endQ,
      stepQ: BAR / 4,
      durationSteps: [1, 2, 3, 4, 5, 6, 7, 8],
      random: seededRandom(seed),
    });

  it("never places a window past the session end", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = arrange(seed);
      assert.ok(windows.length > 0);
      for (const window of windows) {
        assert.ok(
          window.startQ + window.durationQ <= 52 + 1e-9,
          `seed ${seed} ends at ${window.startQ + window.durationQ}`,
        );
      }
    }
  });

  it("only uses Layer 1 to Layer 3 for video", () => {
    const laneIds = new Set(wandLanes.videoLanes.map((lane) => lane.id));
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const window of arrange(seed)) {
        if (window.span.sourceTrackId !== "frozen") {
          assert.ok(laneIds.has(window.laneId));
        }
      }
    }
  });

  it("puts the frozen audio on the Audio layer as one uncut clip", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const audio = arrange(seed).filter(
        (window) => window.laneId === wandLanes.audioLane.id,
      );
      assert.equal(audio.length, 1);
      assert.equal(audio[0].span.sourceTrackId, "frozen");
      assert.equal(audio[0].startQ, 0);
      assert.equal(audio[0].durationQ, 52);
    }
  });
});

describe("applyWandArrangement", () => {
  const initial = {
    lanes: importedLanes,
    clips: [{ id: "old-clip", laneId: "1" }],
    effects: [
      layoutEffect("layout-1", "1"),
      layoutEffect("layout-9", "9"),
      layoutEffect("global", "__group_main"),
    ],
  };

  it("replaces the old layers, and undo restores them", () => {
    const wandLanes = createWandLanes(initial.lanes, WAND_LAYERS).lanes;
    const wandClips = [{ id: "wand-clip", laneId: wandLanes[0].id }];
    const committed = projectHistoryReducer(
      createProjectHistoryState(initial),
      {
        type: "commit",
        label: "Randomize arrangement",
        updater: (current) =>
          applyWandArrangement(current, wandLanes, wandClips),
      },
    );

    assert.deepEqual(
      committed.present.lanes.map((lane) => lane.name),
      ["Layer 1", "Layer 2", "Layer 3", "Audio"],
    );
    assert.ok(
      committed.present.lanes.every((lane) => !lane.name.endsWith("-Audio")),
    );
    assert.deepEqual(committed.present.clips, wandClips);
    const oldIds = new Set(initial.lanes.map((lane) => lane.id));
    assert.ok(
      committed.present.effects.every((effect) => !oldIds.has(effect.trackId)),
    );
    for (const lane of wandLanes) {
      assert.ok(
        committed.present.effects.some(
          (effect) =>
            effect.trackId === lane.id && effect.effectName === "Layout",
        ),
      );
    }

    const undone = projectHistoryReducer(committed, { type: "undo" });
    assert.equal(undone.present, initial);
  });
});
