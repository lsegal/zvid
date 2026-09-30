import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeClipMediaState,
  isPlaceholderClip,
  usesMediaFile,
} from "./clip-media-state.ts";
import {
  addFillClip,
  FILL_CLIP_KIND,
  getDefaultFillColor,
  isFillClip,
} from "./fill-clip.ts";
import { resolveFillPaint } from "./fill-paint.ts";
import {
  mapSessionEffectsToDevices,
  type SessionEffect,
  setEffectParameter,
} from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";
import { listOfflineMedia } from "./relink.ts";

const BPM = 120;

type MediaClip = { id: string; laneId: string; mediaId?: string };

function layout(trackId: string): SessionEffect {
  return {
    id: `layout-${trackId}`,
    trackId,
    effectName: "Layout",
    parameters: [{ key: "Position", value: "Center" }],
    enabled: true,
  };
}

function insert(
  project: { clips: MediaClip[]; effects: SessionEffect[] },
  laneId = "1",
) {
  return addFillClip(project, {
    id: "fill-a",
    laneId,
    startQ: 4,
    durationQ: 8,
    bpm: BPM,
    tint: "#2a2d38",
    accent: "#7ca1ff",
    color: getDefaultFillColor("#7ca1ff"),
    effectId: "color-a",
  });
}

describe("addFillClip", () => {
  it("adds a media-less fill clip over the range with its own Color effect", () => {
    const existing: MediaClip = { id: "clip-1", laneId: "1", mediaId: "m" };
    const result = insert({ clips: [existing], effects: [layout("1")] });

    assert.equal(result.clips.length, 2);
    assert.equal(result.clips[0], existing);
    assert.equal(result.clip.kind, FILL_CLIP_KIND);
    assert.ok(isFillClip(result.clip));
    assert.equal(result.clip.laneId, "1");
    assert.equal(result.clip.startQ, 4);
    // 8 quarters at 120 BPM.
    assert.equal(result.clip.durationSeconds, 4);
    assert.equal(result.clip.mediaId, undefined);
    assert.equal(result.clip.label, "Fill");

    const color = result.effects.find((effect) => effect.id === "color-a");
    assert.equal(color?.trackId, "clip:fill-a");
    assert.equal(color?.effectName, "Color");
    assert.deepEqual(
      color?.parameters.map((parameter) => [parameter.key, parameter.value]),
      [
        ["Mode", "Solid"],
        ["Color", "rgba(124,161,255,1)"],
        [
          "Gradient",
          "linear-gradient(90deg, rgba(124,161,255,1) 0%, rgba(255,111,157,1) 100%)",
        ],
        ["Opacity", "1.000"],
      ],
    );
    assert.deepEqual(resolveFillPaint(result.effects, "1", "clip:fill-a"), {
      kind: "solid",
      color: { r: 124, g: 161, b: 255, a: 1 },
      opacity: 1,
    });
  });

  it("gives each fill clip on a layer its own Color effect", () => {
    const first = insert({ clips: [], effects: [layout("1")] });
    const second = addFillClip(first, {
      ...first.clip,
      id: "fill-b",
      durationQ: 4,
      bpm: BPM,
      color: "rgba(0,0,0,1)",
      effectId: "color-b",
    });
    assert.equal(second.clips.length, 2);
    assert.equal(
      second.effects.find((effect) => effect.id === "color-b")?.trackId,
      "clip:fill-b",
    );
    assert.deepEqual(resolveFillPaint(second.effects, "1", "clip:fill-b"), {
      kind: "solid",
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
    });
    assert.deepEqual(
      resolveFillPaint(second.effects, "1", "clip:fill-a"),
      resolveFillPaint(first.effects, "1", "clip:fill-a"),
    );
  });

  it("falls back to its layer's Color when it has none of its own", () => {
    const layerColor: SessionEffect = {
      id: "color-layer",
      trackId: "1",
      effectName: "Color",
      parameters: [
        { key: "Mode", value: "Solid" },
        { key: "Color", value: "rgba(255,0,0,1)" },
      ],
      enabled: true,
    };
    assert.deepEqual(resolveFillPaint([layerColor], "1", "clip:fill-a"), {
      kind: "solid",
      color: { r: 255, g: 0, b: 0, a: 1 },
      opacity: 1,
    });
  });

  it("defaults to neutral gray on a layer without an accent", () => {
    assert.equal(getDefaultFillColor(undefined), "rgba(128,128,128,1)");
    assert.equal(getDefaultFillColor("#ff6f9d"), "rgba(255,111,157,1)");
  });

  it("round-trips the clip and its paint through saved project state", () => {
    const inserted = insert({ clips: [], effects: [layout("1")] });
    const effects = setEffectParameter(
      setEffectParameter(inserted.effects, "color-a", "Mode", "Gradient"),
      "color-a",
      "Gradient",
      "radial-gradient(circle, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%)",
    );
    const saved = JSON.stringify({ clips: inserted.clips, effects });
    const loaded = JSON.parse(saved) as typeof inserted;

    assert.deepEqual(loaded.clips, inserted.clips);
    assert.ok(isFillClip(loaded.clips[0]));
    assert.deepEqual(
      resolveFillPaint(loaded.effects, "1", "clip:fill-a"),
      resolveFillPaint(effects, "1", "clip:fill-a"),
    );
    assert.equal(
      resolveFillPaint(loaded.effects, "1", "clip:fill-a").kind,
      "radial",
    );
  });
});

describe("fill clip media", () => {
  const { clip } = insert({ clips: [], effects: [] });

  it("is always online and never a placeholder", () => {
    assert.equal(isPlaceholderClip(clip), false);
    assert.equal(describeClipMediaState(clip, undefined), "online");
  });

  it("never counts as offline media", () => {
    assert.equal(usesMediaFile(clip), false);
    assert.equal(usesMediaFile({ mediaId: "m", mediaPath: "a.mp4" }), true);
    assert.equal(usesMediaFile({ mediaPath: "" }), false);

    const offline: MediaItem = {
      id: "m",
      name: "a.mp4",
      kind: "video",
      durationSeconds: 1,
      hasAudio: false,
      hasVideo: true,
      previewUrl: "",
      availability: "offline",
    } as MediaItem;
    const entries = listOfflineMedia([offline], [clip, { mediaId: "m" }]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].clipCount, 1);
  });
});

describe("Color effect parameters", () => {
  const { effects } = insert({ clips: [], effects: [layout("1")] });

  function colorParameterKeys(stack: SessionEffect[]) {
    return mapSessionEffectsToDevices(
      stack,
      "1",
      "Layer 1",
      [],
      undefined,
      "fill-a",
    )
      .find((device) => device.effectName === "Color")
      ?.parameters.map((parameter) => [parameter.key, parameter.kind]);
  }

  it("shows the color picker in Solid mode", () => {
    assert.deepEqual(colorParameterKeys(effects), [
      ["Mode", "enum"],
      ["Color", "color"],
      ["Opacity", "number"],
    ]);
  });

  it("shows the gradient picker in Gradient mode", () => {
    assert.deepEqual(
      colorParameterKeys(
        setEffectParameter(effects, "color-a", "Mode", "Gradient"),
      ),
      [
        ["Mode", "enum"],
        ["Gradient", "gradient"],
        ["Opacity", "number"],
      ],
    );
  });

  it("stores picked colors as strings", () => {
    const next = setEffectParameter(
      effects,
      "color-a",
      "Color",
      "rgba(1,2,3,0.5)",
    );
    const device = mapSessionEffectsToDevices(
      next,
      "1",
      undefined,
      [],
      undefined,
      "fill-a",
    ).find((candidate) => candidate.effectName === "Color");
    const color = device?.parameters.find(
      (parameter) => parameter.key === "Color",
    );
    assert.equal(color?.stringValue, "rgba(1,2,3,0.5)");
    assert.equal(
      next
        .find((effect) => effect.id === "color-a")
        ?.parameters.find((parameter) => parameter.key === "Color")
        ?.numericValue,
      undefined,
    );
  });
});
