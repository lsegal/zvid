import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signatureById } from "../app/constants.ts";
import type { ArrangementClip } from "../app/types.ts";
import type { MediaItem, MediaKind } from "../composition-active-clips.ts";
import { resolvePreviewLayersAt } from "./usePreviewLayers.ts";

const BPM = 120;

function media(id: string, kind: MediaKind): MediaItem {
  return {
    id,
    name: id,
    kind,
    durationSeconds: kind === "image" ? 0 : 4,
    width: 1080,
    height: 1920,
    hasAudio: kind === "audio",
    hasVideo: kind === "video",
    previewUrl: `/${id}`,
  };
}

function clipOf(item: MediaItem, laneId: string): ArrangementClip {
  return {
    id: `clip-${item.id}`,
    sourceTrackId: "source-1",
    laneId,
    label: item.name,
    mediaPath: item.name,
    mediaId: item.id,
    startQ: 0,
    durationSeconds: 4,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 4,
    tint: "#000",
    accent: "#fff",
  };
}

describe("resolvePreviewLayersAt", () => {
  it("outlines image clips, such as a Lottie, as it does video clips", () => {
    const items = [
      media("video", "video"),
      media("lottie", "image"),
      media("tone", "audio"),
    ];
    const lanes = ["1", "2", "3"].map((id) => ({
      id,
      name: `Layer ${id}`,
      colorIndex: -1,
    }));
    const layers = resolvePreviewLayersAt(
      {
        clips: items.map((item, index) => clipOf(item, lanes[index].id)),
        mediaItemsById: new Map(items.map((item) => [item.id, item])),
        bpm: BPM,
        fps: 30,
        signature: signatureById("4/4"),
        projectDurationFrames: undefined,
        lanes,
        lanePriority: new Map(lanes.map((lane, index) => [lane.id, index])),
        effects: [],
        canvasWidth: 1920,
        canvasHeight: 1080,
      },
      1,
    );
    assert.deepEqual(layers.map((layer) => layer.clipId).sort(), [
      "clip-lottie",
      "clip-video",
    ]);
  });
});
