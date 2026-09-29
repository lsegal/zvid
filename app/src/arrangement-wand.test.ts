import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyWandArrangement,
  createWandLanes,
  getWandEndQ,
  MAX_WAND_LAYERS,
  planWandWindows,
  type WandSourceSpan,
} from "./arrangement-wand.ts";
import type { SessionEffect } from "./fx-stack.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";

const BPM = 120;
const FPS = 25;
const BAR = 4;

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
): WandSourceSpan => ({
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
    const lanes = createWandLanes(importedLanes);
    assert.equal(MAX_WAND_LAYERS, 3);
    assert.deepEqual(
      lanes.map((lane) => lane.name),
      ["Layer 1", "Layer 2", "Layer 3"],
    );
    const oldIds = new Set(importedLanes.map((lane) => lane.id));
    assert.ok(lanes.every((lane) => !oldIds.has(lane.id)));
    assert.equal(new Set(lanes.map((lane) => lane.id)).size, 3);
  });
});

describe("planWandWindows", () => {
  const sourceSpans = [span("a", 0, 124), span("b", 0, 124)];
  const plan = (endQ: number, seed: number) =>
    planWandWindows({
      lanes: createWandLanes(importedLanes),
      sourceTrackIds: ["a", "b"],
      endQ,
      barLength: BAR,
      chooseSourceSpan: (sourceTrackId) =>
        sourceSpans.find((candidate) => candidate.sourceTrackId === sourceTrackId),
      random: seededRandom(seed),
    });

  it("never places a window past the session end", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = plan(52, seed);
      assert.ok(windows.length > 0);
      for (const window of windows) {
        assert.ok(window.startQ < 52, `seed ${seed} starts at ${window.startQ}`);
        assert.ok(
          window.startQ + window.durationQ <= 52 + 1e-9,
          `seed ${seed} ends at ${window.startQ + window.durationQ}`,
        );
      }
    }
  });

  it("fills Layer 1 up to a session end off the quarter-bar grid", () => {
    // 51.5 quarters leaves half a quarter after the last grid step.
    for (let seed = 1; seed <= 50; seed += 1) {
      const windows = plan(51.5, seed);
      const layerOne = windows.filter(
        (window) => window.laneId === windows[0].laneId,
      );
      const last = layerOne[layerOne.length - 1];
      assert.equal(last.startQ + last.durationQ, 51.5, `seed ${seed}`);
    }
  });

  it("only uses the wand layers", () => {
    const laneIds = new Set(
      createWandLanes(importedLanes).map((lane) => lane.id),
    );
    for (const window of plan(52, 7)) {
      assert.ok(laneIds.has(window.laneId));
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
    const wandLanes = createWandLanes(initial.lanes);
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
      ["Layer 1", "Layer 2", "Layer 3"],
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
