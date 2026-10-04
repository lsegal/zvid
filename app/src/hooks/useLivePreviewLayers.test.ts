import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrangementClip, Lane } from "../app/types.ts";
import type {
  MediaItem,
  SessionEffect,
} from "../composition-active-clips.ts";
import { createDefaultAnimation } from "../fx-animation-defaults.ts";
import { createPlayheadSignal } from "../playhead-signal.ts";
import type { PreviewLayer } from "../preview-edit.ts";
import {
  followSelectedPreviewLayer,
  selectedPreviewLayerKey,
} from "./useLivePreviewLayers.ts";
import { resolvePreviewLayersAt } from "./usePreviewLayers.ts";

const BPM = 120;
const FPS = 30;
const CANVAS = { width: 1080, height: 1920 };

function secondsToQ(seconds: number) {
  return (seconds * BPM) / 60;
}

const MEDIA: MediaItem = {
  id: "clip-media",
  name: "clip-media.mp4",
  kind: "video",
  durationSeconds: 8,
  width: 1080,
  height: 1920,
  hasAudio: false,
  hasVideo: true,
  previewUrl: "/clip-media",
};

const CLIP: ArrangementClip = {
  id: "clip-1",
  laneId: "1",
  label: "Box",
  mediaPath: "clip-media.mp4",
  mediaId: MEDIA.id,
  startQ: 0,
  durationSeconds: 4,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 8,
  tint: "#000",
  accent: "#fff",
};

const LANES: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];

// The layer's Transform, its position swung back and forth by an LFO once a
// second, like a box sliding across the canvas.
function slidingTransform(): SessionEffect {
  const animation = createDefaultAnimation("Transform");
  assert.ok(animation?.lfo);
  return {
    id: "transform",
    trackId: "1",
    effectName: "Transform",
    parameters: [{ key: "PositionX", value: "0", numericValue: 0 }],
    animation: {
      ...animation,
      mode: "lfo",
      lfo: {
        ...animation.lfo,
        sync: false,
        rate: 1,
        depth: 1,
        parameters: ["PositionX"],
      },
    },
  };
}

function resolveAt(seconds: number, effects = [slidingTransform()]) {
  return resolvePreviewLayersAt(
    {
      clips: [CLIP],
      mediaItemsById: new Map([[MEDIA.id, MEDIA]]),
      bpm: BPM,
      fps: FPS,
      signature: { numerator: 4, denominator: 4 },
      projectDurationFrames: undefined,
      lanes: LANES,
      lanePriority: new Map([["1", 0]]),
      effects,
      canvasWidth: CANVAS.width,
      canvasHeight: CANVAS.height,
    },
    secondsToQ(seconds),
  );
}

function left(layers: readonly PreviewLayer[]) {
  const [layer] = layers;
  assert.ok(layer);
  return Math.min(...layer.corners.map((corner) => corner.x));
}

describe("resolvePreviewLayersAt", () => {
  it("moves an animating layer's box on every frame", () => {
    const lefts = [0, 1, 2, 3, 4, 5].map((frame) =>
      left(resolveAt((15 + frame) / FPS)),
    );
    for (let index = 1; index < lefts.length; index += 1) {
      assert.notEqual(lefts[index], lefts[index - 1]);
    }
  });

  it("keeps a still layer's box in place", () => {
    const still = { ...slidingTransform(), animation: undefined };
    assert.equal(left(resolveAt(0.5, [still])), left(resolveAt(1.5, [still])));
  });
});

describe("followSelectedPreviewLayer", () => {
  it("follows the live playhead while the selected layer animates", () => {
    const signal = createPlayheadSignal(secondsToQ(0.5));
    const shown: Array<readonly PreviewLayer[]> = [];
    const resolveLayersAt = (playheadQ: number) =>
      resolveAt((playheadQ * 60) / BPM);
    const stop = followSelectedPreviewLayer({
      layers: resolveAt(0.5),
      resolveLayersAt,
      playheadSignal: signal,
      selectedLaneId: "1",
      onChange: (layers) => shown.push(layers),
    });
    // Already showing the live playhead.
    assert.equal(shown.length, 0);

    for (let frame = 1; frame <= 3; frame += 1) {
      signal.set(secondsToQ(0.5 + frame / FPS));
      assert.equal(shown.length, frame);
      assert.equal(
        selectedPreviewLayerKey(shown[frame - 1], "1"),
        selectedPreviewLayerKey(resolveAt(0.5 + frame / FPS), "1"),
      );
    }

    stop();
    signal.set(secondsToQ(1));
    assert.equal(shown.length, 3);
  });

  it("re-renders nothing while the selected layer holds still", () => {
    const signal = createPlayheadSignal(0);
    const still = [{ ...slidingTransform(), animation: undefined }];
    let changes = 0;
    followSelectedPreviewLayer({
      layers: resolveAt(0, still),
      resolveLayersAt: (playheadQ) => resolveAt((playheadQ * 60) / BPM, still),
      playheadSignal: signal,
      selectedLaneId: "1",
      onChange: () => {
        changes += 1;
      },
    });
    for (let frame = 1; frame <= 5; frame += 1) {
      signal.set(secondsToQ(frame / FPS));
    }
    assert.equal(changes, 0);
  });
});
