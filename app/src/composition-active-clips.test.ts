import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  computeActiveClips,
  GROUP_TRACK_ID,
  type MediaItem,
  resolveVisualState,
} from "./composition-active-clips.ts";
import {
  orderStackedLayers,
  resolveLayerPlacement,
} from "./composition-layout.ts";

// dogfood3.lvp: 126.4 BPM at 30 fps, mapped the way sessionToProject maps a
// session's selections onto its source clips.
const BPM = 126.404495;
const FPS = 30;
const LANES = ["1", "5", "6", "7", "8"];
const LANE_PRIORITY = new Map(LANES.map((id, index) => [id, index]));
// 2.2.4 (00:02:24): Layer 1 plays 2-Audio and Layer 2 plays 3-Audio.
const PLAYHEAD_Q = frameToQ(84);

function frameToQ(frame: number) {
  return ((frame / FPS) * BPM) / 60;
}

function media(id: string, durationSeconds: number, previewUrl = `/${id}`) {
  const item: MediaItem = {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds,
    width: 1080,
    height: 1920,
    hasAudio: true,
    hasVideo: true,
    previewUrl,
  };
  return item;
}

// Source clips 12-4, 8-6 and 16-3, and 16-2 whose relative path is offline.
const MEDIA = [
  media("akustichord", 12.049),
  media("audio-2", 24.759),
  media("audio-3", 28.278),
  media("audio-3-relative", 0, ""),
];
const SOURCES = {
  "12": { mediaId: "akustichord", clipStart: 42, frameCount: 317 },
  "8": { mediaId: "audio-2", clipStart: 316, frameCount: 317 },
  "16": { mediaId: "audio-3", clipStart: 2, frameCount: 220 },
} as const;

function selection(
  id: number,
  trackId: keyof typeof SOURCES,
  laneId: string,
  frameStart: number,
  frameEnd: number,
  mediaId: string = SOURCES[trackId].mediaId,
): ArrangementClip {
  const source = SOURCES[trackId];
  const trimStartSeconds = source.clipStart / FPS;
  return {
    id: `selection-${id}`,
    sourceTrackId: trackId,
    laneId,
    label: trackId,
    mediaPath: `${mediaId}.mp4`,
    mediaId,
    startQ: frameToQ(frameStart),
    durationSeconds: (frameEnd - frameStart) / FPS,
    trimStartSeconds: frameStart / FPS + trimStartSeconds,
    sourceOffsetSeconds: trimStartSeconds,
    sourceWindowStartSeconds: trimStartSeconds,
    sourceWindowEndSeconds: trimStartSeconds + source.frameCount / FPS,
    tint: "#000",
    accent: "#fff",
  };
}

const DOGFOOD3_CLIPS = [
  selection(5, "12", "1", 128, 157),
  selection(29, "12", "6", 256, 313),
  selection(14, "8", "1", 0, 128),
  selection(25, "8", "1", 185, 313),
  selection(16, "16", "5", 57, 114),
  selection(23, "16", "5", 157, 185),
];

function activeAt(clips: ArrangementClip[], playheadQ = PLAYHEAD_Q) {
  return computeActiveClips(
    clips,
    new Map(MEDIA.map((item) => [item.id, item])),
    playheadQ,
    BPM,
    LANE_PRIORITY,
    [],
  );
}

describe("computeActiveClips", () => {
  it("keeps Layer 1 and Layer 2 active and in bounds at 2.2.4", () => {
    const active = activeAt(DOGFOOD3_CLIPS);

    assert.deepEqual(
      active.map((entry) => [entry.clip.id, entry.clip.laneId]),
      [
        ["selection-14", "1"],
        ["selection-16", "5"],
      ],
    );
    for (const entry of active) {
      assert.ok(entry.isInBounds, `${entry.clip.id} is in bounds`);
    }
  });

  it("keeps other lanes when a higher lane's clip is offline", () => {
    const offline = selection(90, "16", "6", 60, 120, "audio-3-relative");
    const active = activeAt([...DOGFOOD3_CLIPS, offline]);

    assert.deepEqual(
      active.map((entry) => entry.clip.id),
      ["selection-14", "selection-16"],
      "the offline clip is skipped and hides nothing",
    );
  });

  it("gives each clip of the same media its own source", () => {
    const sameMedia = selection(91, "8", "6", 60, 120);
    const clips = [
      ...DOGFOOD3_CLIPS,
      { ...sameMedia, sourceOffsetSeconds: sameMedia.sourceOffsetSeconds + 5 },
    ];
    const active = activeAt(clips).filter(
      (entry) => entry.media.id === "audio-2",
    );

    assert.equal(active.length, 2, "one entry per lane");
    const [first, second] = active;
    assert.equal(first.clip.laneId, "1");
    assert.equal(first.sourceKey, "audio-2");
    assert.equal(second.clip.laneId, "6");
    assert.notEqual(second.sourceKey, first.sourceKey);
    assert.ok(
      Math.abs(second.mediaTime - first.mediaTime - 5) < 1e-9,
      "each entry keeps its own source time",
    );
  });

  it("keeps a lane's extra source from one clip to the next", () => {
    const first = selection(92, "8", "6", 60, 90);
    const next = selection(93, "8", "6", 90, 120);
    const clips = [...DOGFOOD3_CLIPS, first, next];
    const keyAt = (frame: number) =>
      activeAt(clips, frameToQ(frame)).find(
        (entry) => entry.clip.laneId === "6",
      )?.sourceKey;

    assert.equal(keyAt(70), keyAt(100));
  });

  it("draws only the latest-starting clip where a lane's clips overlap", () => {
    const clips = [
      ...DOGFOOD3_CLIPS,
      selection(94, "12", "1", 60, 120),
      selection(95, "16", "1", 70, 120),
    ];
    const active = activeAt(clips);

    assert.deepEqual(
      active.map((entry) => [entry.clip.id, entry.clip.laneId]),
      [
        ["selection-95", "1"],
        ["selection-16", "5"],
      ],
      "three overlapping clips on Layer 1 collapse to one",
    );
    const [layer1] = active;
    assert.equal(layer1.sourceKey, "audio-3", "the kept clip claims a source");
    assert.ok(layer1.isInBounds);
  });

  it("keeps the later clip in the arrangement when starts tie", () => {
    const clips = [
      selection(96, "8", "1", 60, 120),
      selection(97, "16", "1", 60, 120),
    ];

    assert.deepEqual(
      activeAt(clips).map((entry) => entry.clip.id),
      ["selection-97"],
    );
  });

  it("lets an online clip draw under an offline one on the same lane", () => {
    const clips = [
      selection(98, "8", "1", 60, 120),
      selection(99, "16", "1", 70, 120, "audio-3-relative"),
    ];

    assert.deepEqual(
      activeAt(clips).map((entry) => entry.clip.id),
      ["selection-98"],
    );
  });

  it("gives a single overlapping layer one full-frame band", () => {
    const clips = [
      selection(100, "8", "1", 0, 128),
      selection(101, "16", "1", 57, 114),
    ];
    const stacked = orderStackedLayers(activeAt(clips));

    assert.equal(stacked.length, 1);
    const placement = resolveLayerPlacement({
      index: 0,
      count: stacked.length,
      canvasWidth: 1080,
      canvasHeight: 1920,
      sourceWidth: 1080,
      sourceHeight: 1920,
      visual: stacked[0].visual,
    });
    assert.deepEqual(placement.scissor, {
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    });
  });

  it("puts Layer 1 in the top band and Layer 2 below it", () => {
    const stacked = orderStackedLayers(activeAt(DOGFOOD3_CLIPS));

    assert.deepEqual(
      stacked.map((entry) => entry.clip.laneId),
      ["1", "5"],
    );
    const [top, bottom] = stacked.map((entry, index) =>
      resolveLayerPlacement({
        index,
        count: stacked.length,
        canvasWidth: 1080,
        canvasHeight: 1920,
        sourceWidth: 1080,
        sourceHeight: 1920,
        visual: entry.visual,
      }),
    );
    assert.ok(top.frame.centerY > bottom.frame.centerY);
    assert.equal(top.scissor.y, 960, "Layer 1 fills the top half");
    assert.equal(bottom.scissor.y, 0, "Layer 2 fills the bottom half");
  });
});

describe("resolveVisualState", () => {
  function layout(id: string, trackId: string, position: string) {
    return {
      id,
      trackId,
      effectName: "Layout",
      parameters: [{ key: "Position", value: position }],
      enabled: true,
    };
  }

  it("takes the layout anchor only from the layer's own stack", () => {
    const effects = [
      layout("layout-1", "1", "Top"),
      layout("layout-5", "5", "Bottom"),
      layout("global", GROUP_TRACK_ID, "Center"),
    ];
    assert.equal(resolveVisualState(effects, "1").layoutAnchor, "top");
    assert.equal(resolveVisualState(effects, "5").layoutAnchor, "bottom");
    assert.equal(resolveVisualState(effects, "6").layoutAnchor, "center");
  });

  it("ignores a global Layout", () => {
    const effects = [layout("global", GROUP_TRACK_ID, "Bottom")];
    assert.equal(resolveVisualState(effects, "1").layoutAnchor, "center");
  });
});

describe("fill clips", () => {
  function fill(
    id: string,
    laneId: string,
    frameStart: number,
    frames: number,
  ) {
    const clip: ArrangementClip = {
      id,
      kind: "fill",
      sourceTrackId: "",
      laneId,
      label: "Fill",
      mediaPath: "",
      startQ: frameToQ(frameStart),
      durationSeconds: frames / FPS,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: frames / FPS,
      tint: "#000",
      accent: "#fff",
    };
    return clip;
  }

  const color = {
    id: "color",
    trackId: "6",
    effectName: "Color",
    parameters: [
      { key: "Mode", value: "Solid" },
      { key: "Color", value: "rgba(255,0,0,1)" },
      { key: "Opacity", value: "0.500", numericValue: 0.5 },
    ],
  };

  it("draws a fill with no media, painted by its layer's Color", () => {
    const active = computeActiveClips(
      [...DOGFOOD3_CLIPS, fill("fill-1", "6", 60, 60)],
      new Map(MEDIA.map((item) => [item.id, item])),
      PLAYHEAD_Q,
      BPM,
      LANE_PRIORITY,
      [color],
    );

    assert.deepEqual(
      active.map((entry) => entry.clip.id),
      ["selection-14", "selection-16", "fill-1"],
    );
    const entry = active[2];
    assert.ok(entry.isInBounds);
    assert.equal(entry.sourceKey, "fill:fill-1");
    assert.deepEqual(entry.fill, {
      kind: "solid",
      color: { r: 255, g: 0, b: 0, a: 1 },
      opacity: 0.5,
    });
    assert.equal(active[0].fill, undefined);
  });

  it("is only drawn while the playhead is over it", () => {
    const active = activeAt([fill("fill-1", "6", 0, 30)]);
    assert.deepEqual(active, []);
  });

  it("keeps the Color effect's opacity out of the layer's visual state", () => {
    assert.equal(resolveVisualState([color], "6").opacity, 1);
  });
});
