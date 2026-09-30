import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FX_CLIP_LABEL } from "../fx-clip.ts";
import type { MediaItem } from "../media.ts";
import {
  buildOrderLayerOptions,
  getFxClip,
  getFxClipScope,
  getFxKind,
  getPlayheadVisualLaneIds,
  getSelectedFxClipRank,
  isBeneathFxClipRank,
} from "./fx-panel-model.ts";
import type { ArrangementClip, Lane } from "./types.ts";
import { getSwatch } from "./util.ts";

const clip: ArrangementClip = {
  id: "clip",
  sourceSpanId: "span",
  sourceTrackId: "track",
  laneId: "1",
  label: "Clip",
  mediaPath: "clip.mp4",
  mediaId: "video",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 10,
  tint: "#000",
  accent: "#fff",
};

const fxClip: ArrangementClip = {
  ...clip,
  id: "fx",
  laneId: "2",
  label: "",
  kind: "fx",
  mediaId: undefined,
};

function media(
  id: string,
  kind: MediaItem["kind"],
  availability: MediaItem["availability"] = "ready",
): MediaItem {
  return {
    id,
    name: id,
    kind,
    durationSeconds: 10,
    hasAudio: kind === "audio",
    hasVideo: kind === "video",
    color: "#000",
    accent: "#fff",
    previewUrl: "",
    availability,
  };
}

const mediaItemsById = new Map([
  ["video", media("video", "video")],
  ["audio", media("audio", "audio")],
  ["offline", media("offline", "video", "offline")],
]);

describe("getFxKind", () => {
  it("returns the selected clip's media kind", () => {
    assert.equal(getFxKind(clip, mediaItemsById), "video");
    assert.equal(
      getFxKind({ ...clip, mediaId: "audio" }, mediaItemsById),
      "audio",
    );
  });

  it("is undefined without a media clip", () => {
    assert.equal(getFxKind(undefined, mediaItemsById), undefined);
    assert.equal(getFxKind(fxClip, mediaItemsById), undefined);
  });
});

describe("getPlayheadVisualLaneIds", () => {
  it("lists layers with an online video clip at the playhead", () => {
    const clips = [
      clip,
      { ...clip, id: "audio", laneId: "2", mediaId: "audio" },
      { ...clip, id: "offline", laneId: "3", mediaId: "offline" },
      { ...clip, id: "later", laneId: "4", startQ: 100 },
    ];

    assert.deepEqual(
      [...getPlayheadVisualLaneIds(clips, mediaItemsById, 0, 120)],
      ["1"],
    );
  });
});

describe("FX clip rank", () => {
  const lanePriority = new Map([
    ["1", 0],
    ["2", 1],
    ["3", 2],
  ]);

  it("ranks only a selected FX clip", () => {
    assert.equal(getSelectedFxClipRank(fxClip, lanePriority), 1);
    assert.equal(getSelectedFxClipRank(clip, lanePriority), undefined);
  });

  it("finds layers beneath the FX clip", () => {
    assert.equal(isBeneathFxClipRank(lanePriority, 1, "3"), true);
    assert.equal(isBeneathFxClipRank(lanePriority, 1, "1"), false);
    assert.equal(isBeneathFxClipRank(lanePriority, 1, "missing"), false);
    assert.equal(isBeneathFxClipRank(lanePriority, undefined, "3"), false);
  });
});

describe("buildOrderLayerOptions", () => {
  it("numbers layers in timeline order with their swatch", () => {
    const lanes: Lane[] = [
      { id: "a", name: "Layer A", colorIndex: 2 },
      { id: "b", name: "Layer B", colorIndex: -1 },
    ];

    assert.deepEqual(buildOrderLayerOptions(lanes), [
      { id: "a", number: 1, name: "Layer A", color: getSwatch(2).accent },
      { id: "b", number: 2, name: "Layer B", color: undefined },
    ]);
  });
});

describe("getFxClip", () => {
  it("names the selected clip on the FX layer", () => {
    assert.deepEqual(getFxClip(clip, "1", []), { id: "clip", name: "Clip" });
    assert.deepEqual(getFxClip(fxClip, "2", []), {
      id: "fx",
      name: FX_CLIP_LABEL,
    });
  });

  it("is undefined for a clip on another layer", () => {
    assert.equal(getFxClip(clip, "2", []), undefined);
    assert.equal(getFxClip(undefined, "1", []), undefined);
  });
});

describe("getFxClipScope", () => {
  it("scopes an FX clip's stack to composite effects", () => {
    assert.equal(getFxClipScope(fxClip), "fxClip");
    assert.equal(getFxClipScope(clip), "clip");
    assert.equal(getFxClipScope(undefined), "clip");
  });
});
