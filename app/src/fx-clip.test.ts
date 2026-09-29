import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeClipMediaState,
  isGeneratedClip,
  isPlaceholderClip,
  usesMediaFile,
} from "./clip-media-state.ts";
import { addableEffectsFor } from "./fx-chain.ts";
import {
  addFxClip,
  createFxClip,
  describeFxClip,
  FX_CLIP_KIND,
  isFxClip,
} from "./fx-clip.ts";
import {
  addEffect,
  clipEffectTrackId,
  copyClipEffects,
  mapSessionEffectsToDevices,
  moveEffect,
  ORDER_RUNS_FIRST_NOTE,
  type SessionEffect,
  setEffectParameter,
} from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";
import { copyClip, pasteClipboard, removeRangeFromLane } from "./range-edit.ts";
import { listOfflineMedia } from "./relink.ts";

const BPM = 120;

type MediaClip = { id: string; laneId: string; mediaId?: string };

function insert(project: { clips: MediaClip[] }, laneId = "1") {
  return addFxClip(project, {
    id: "fx-a",
    laneId,
    startQ: 4,
    durationQ: 8,
    bpm: BPM,
    tint: "#2a2d38",
    accent: "#7ca1ff",
  });
}

describe("addFxClip", () => {
  it("adds a media-less FX clip over the range with no effects", () => {
    const existing: MediaClip = { id: "clip-1", laneId: "1", mediaId: "m" };
    const result = insert({ clips: [existing] });

    assert.equal(result.clips.length, 2);
    assert.equal(result.clips[0], existing);
    assert.equal(result.clip.kind, FX_CLIP_KIND);
    assert.ok(isFxClip(result.clip));
    assert.ok(isGeneratedClip(result.clip));
    assert.equal(result.clip.laneId, "1");
    assert.equal(result.clip.startQ, 4);
    // 8 quarters at 120 BPM.
    assert.equal(result.clip.durationSeconds, 4);
    assert.equal(result.clip.mediaId, undefined);
    assert.equal(result.clip.label, "FX");
    assert.equal("effects" in result, false);
  });

  it("round-trips through saved project state", () => {
    const inserted = insert({ clips: [] });
    const effects = addEffect(
      [],
      clipEffectTrackId("fx-a"),
      "Colorize",
      undefined,
      "colorize",
    );
    const saved = JSON.stringify({ clips: inserted.clips, effects });
    const loaded = JSON.parse(saved) as {
      clips: typeof inserted.clips;
      effects: SessionEffect[];
    };

    assert.deepEqual(loaded.clips, inserted.clips);
    assert.ok(isFxClip(loaded.clips[0]));
    assert.equal(describeFxClip(loaded.effects, "fx-a"), "FX · Colorize");
  });
});

describe("FX clip media", () => {
  const { clip } = insert({ clips: [] });

  it("is always online and never a placeholder", () => {
    assert.equal(isPlaceholderClip(clip), false);
    assert.equal(describeClipMediaState(clip, undefined), "online");
  });

  it("never counts as offline media", () => {
    assert.equal(usesMediaFile(clip), false);
    const offline = {
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

describe("describeFxClip", () => {
  it("names the clip's own effects in stack order", () => {
    const trackId = clipEffectTrackId("fx-a");
    let effects = addEffect([], trackId, "Colorize");
    effects = addEffect(effects, trackId, "Pixelate");
    // Another clip's and the layer's effects are not the FX clip's.
    effects = addEffect(effects, clipEffectTrackId("other"), "AnalogGlitch");
    effects = addEffect(effects, "1", "NegativeSplit");
    assert.equal(describeFxClip(effects, "fx-a"), "FX · Colorize, Pixelate");
  });

  it("reads as empty without effects", () => {
    assert.equal(describeFxClip([], "fx-a"), "FX (empty)");
  });
});

describe("FX clip stacks", () => {
  it("offers only effects that work on a composite", () => {
    const names = addableEffectsFor("fxClip").map(
      (definition) => definition.effectName,
    );
    for (const name of [
      "ZoomAndPan",
      "Colorize",
      "Pixelate",
      "NegativeSplit",
      "AnalogGlitch",
      "Transform",
      "Order",
    ]) {
      assert.ok(names.includes(name), name);
    }
    for (const name of ["Color", "Text", "Layout"]) {
      assert.ok(!names.includes(name), name);
    }
  });

  it("offers Order on an FX clip but not on other clips or layers", () => {
    const names = (scope: "clip" | "layer" | "fxClip") =>
      addableEffectsFor(scope).map((definition) => definition.effectName);
    assert.ok(names("fxClip").includes("Order"));
    assert.ok(!names("clip").includes("Order"));
    assert.ok(!names("layer").includes("Order"));
  });

  it("adds Order only to a stack known to be an FX clip's", () => {
    const trackId = clipEffectTrackId("fx-a");
    assert.deepEqual(addEffect([], trackId, "Order"), []);
    const effects = addEffect([], trackId, "Order", 0, "order", "fxClip");
    assert.deepEqual(
      effects.map((effect) => [effect.id, effect.trackId, effect.effectName]),
      [["order", trackId, "Order"]],
    );
  });

  it("keeps one Order per FX clip: a new one bypasses the last", () => {
    const trackId = clipEffectTrackId("fx-a");
    let effects = addEffect([], trackId, "Order", 0, "first", "fxClip");
    effects = addEffect(effects, trackId, "Colorize", undefined, "colorize");
    effects = addEffect(
      effects,
      trackId,
      "Order",
      undefined,
      "second",
      "fxClip",
    );
    assert.deepEqual(
      effects.map((effect) => [effect.id, effect.enabled]),
      [
        ["first", false],
        ["colorize", true],
        ["second", true],
      ],
    );
    // Another stack's Order is left alone.
    const other = addEffect(
      effects,
      clipEffectTrackId("fx-b"),
      "Order",
      undefined,
      "other",
      "fxClip",
    );
    assert.equal(other.find((effect) => effect.id === "second")?.enabled, true);
  });

  it("notes an Order that isn't first, and warns of layers its grid hides", () => {
    const trackId = clipEffectTrackId("fx-a");
    let effects = addEffect([], trackId, "Colorize", undefined, "colorize");
    effects = addEffect(
      effects,
      trackId,
      "Order",
      undefined,
      "order",
      "fxClip",
    );
    const orderDevice = (layerCount: number) =>
      mapSessionEffectsToDevices(
        effects,
        "1",
        "Layer 1",
        [],
        new Set(),
        "fx-a",
        "fxClip",
        Array.from({ length: layerCount }, (_, index) => `${index + 2}`),
      ).find((device) => device.id === "order");
    assert.equal(orderDevice(4)?.warning, ORDER_RUNS_FIRST_NOTE);
    assert.equal(orderDevice(4)?.unsupported, undefined);

    effects = setEffectParameter(effects, "order", "Arrangement", "Grid");
    assert.equal(orderDevice(4)?.warning, ORDER_RUNS_FIRST_NOTE);
    assert.equal(orderDevice(6)?.warning, "2 layers hidden by grid");

    effects = moveEffect(effects, "order", 0);
    assert.equal(orderDevice(4)?.warning, undefined);
  });

  it("flags content effects on an FX clip's stack as unsupported", () => {
    const effects: SessionEffect[] = [
      {
        id: "text",
        trackId: clipEffectTrackId("fx-a"),
        effectName: "Text",
        parameters: [],
        enabled: true,
      },
      ...addEffect([], clipEffectTrackId("fx-a"), "Colorize", 0, "colorize"),
    ];
    const devices = mapSessionEffectsToDevices(
      effects,
      "1",
      "Layer 1",
      [],
      new Set(),
      "fx-a",
      "fxClip",
    );
    assert.deepEqual(
      devices.map((device) => [device.effectName, device.unsupported]),
      [
        ["Text", true],
        ["Colorize", undefined],
      ],
    );
  });

  it("keeps its kind and stack when split or copied", () => {
    const clip = createFxClip({
      id: "fx-a",
      laneId: "1",
      startQ: 0,
      durationQ: 8,
      bpm: BPM,
      tint: "#2a2d38",
      accent: "#7ca1ff",
    });
    const effects = addEffect(
      [],
      clipEffectTrackId("fx-a"),
      "Colorize",
      undefined,
      "colorize",
    );

    const pieces = removeRangeFromLane([clip], "1", 2, 6, BPM, () => "fx-b");
    assert.deepEqual(
      pieces.map((piece) => [piece.id, piece.kind, piece.startQ]),
      [
        ["fx-a", FX_CLIP_KIND, 0],
        ["fx-b", FX_CLIP_KIND, 6],
      ],
    );
    const pasted = pasteClipboard(
      [clip],
      copyClip(clip, BPM),
      "2",
      16,
      BPM,
      () => "fx-c",
    ).pasted;
    assert.deepEqual(
      pasted.map((piece) => [piece.id, piece.kind, piece.laneId]),
      [["fx-c", FX_CLIP_KIND, "2"]],
    );

    const copied = copyClipEffects(
      effects,
      [["fx-a", "fx-b"]],
      effects,
      () => "colorize-b",
    );
    assert.equal(describeFxClip(copied, "fx-b"), "FX · Colorize");
    assert.equal(describeFxClip(copied, "fx-a"), "FX · Colorize");
  });
});
