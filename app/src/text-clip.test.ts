import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeClipMediaState,
  isGeneratedClip,
  isPlaceholderClip,
  usesMediaFile,
} from "./clip-media-state.ts";
import {
  mapSessionEffectsToDevices,
  type SessionEffect,
  setEffectParameter,
} from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";
import { listOfflineMedia } from "./relink.ts";
import { addTextClip, isTextClip, TEXT_CLIP_KIND } from "./text-clip.ts";
import { resolveTextStyle } from "./text-style.ts";

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
  return addTextClip(project, {
    id: "text-a",
    laneId,
    startQ: 4,
    durationQ: 8,
    bpm: BPM,
    tint: "#2a2d38",
    accent: "#7ca1ff",
    effectId: "text-effect",
  });
}

function textDevice(effects: SessionEffect[], missing?: ReadonlySet<string>) {
  const device = mapSessionEffectsToDevices(
    effects,
    "1",
    "Layer 1",
    0,
    missing,
    "text-a",
  ).find((candidate) => candidate.effectName === "Text");
  assert.ok(device);
  return device;
}

describe("addTextClip", () => {
  it("adds a media-less text clip over the range with its own Text effect", () => {
    const existing: MediaClip = { id: "clip-1", laneId: "1", mediaId: "m" };
    const result = insert({ clips: [existing], effects: [layout("1")] });

    assert.equal(result.clips.length, 2);
    assert.equal(result.clips[0], existing);
    assert.equal(result.clip.kind, TEXT_CLIP_KIND);
    assert.ok(isTextClip(result.clip));
    assert.ok(isGeneratedClip(result.clip));
    assert.equal(result.clip.laneId, "1");
    assert.equal(result.clip.startQ, 4);
    // 8 quarters at 120 BPM.
    assert.equal(result.clip.durationSeconds, 4);
    assert.equal(result.clip.mediaId, undefined);
    assert.equal(result.clip.label, "Text");

    const text = result.effects.find((effect) => effect.id === "text-effect");
    assert.equal(text?.trackId, "clip:text-a");
    assert.equal(text?.effectName, "Text");
    // "Text" in the default font, white and centred.
    const style = resolveTextStyle(result.effects, "1", "clip:text-a");
    assert.equal(style.text, "Text");
    assert.equal(style.font, "Inter");
    assert.equal(style.weight, 400);
    assert.deepEqual(style.paint, {
      kind: "solid",
      color: { r: 255, g: 255, b: 255, a: 1 },
    });
    assert.equal(style.align, "center");
    assert.equal(style.verticalAlign, "middle");
    assert.equal(style.fontSize, 96);
    assert.equal(style.resizeToFit, false);
    assert.equal(style.stroke, undefined);
    assert.equal(style.shadow, undefined);
  });

  it("gives each text clip on a layer its own Text effect", () => {
    const first = insert({ clips: [], effects: [layout("1")] });
    const second = addTextClip(first, {
      ...first.clip,
      id: "text-b",
      durationQ: 4,
      bpm: BPM,
      effectId: "text-effect-b",
    });
    assert.equal(second.clips.length, 2);
    assert.equal(
      second.effects.find((effect) => effect.id === "text-effect-b")?.trackId,
      "clip:text-b",
    );

    const effects = setEffectParameter(
      second.effects,
      "text-effect-b",
      "Text",
      "Second",
    );
    assert.equal(resolveTextStyle(effects, "1", "clip:text-a").text, "Text");
    assert.equal(resolveTextStyle(effects, "1", "clip:text-b").text, "Second");
  });

  it("puts no Text effect on the layer", () => {
    const { effects } = insert({ clips: [], effects: [layout("1")] });
    assert.ok(
      !effects.some(
        (effect) => effect.trackId === "1" && effect.effectName === "Text",
      ),
    );
  });

  it("round-trips the clip and its style through saved project state", () => {
    const inserted = insert({ clips: [], effects: [layout("1")] });
    let effects = inserted.effects;
    for (const [key, value] of [
      ["Text", "Line one\nLine two"],
      ["FontFamily", "google:Roboto"],
      ["FontStyle", "Italic,Underline"],
      ["FillMode", "Gradient"],
      [
        "Gradient",
        "radial-gradient(circle, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%)",
      ],
      ["Stroke", "rgba(0,255,0,1)"],
      ["StrokeWidth", 3],
      ["Shadow", "On"],
      ["ShadowColor", "rgba(0,0,0,0.5)"],
      ["ShadowBlur", 12],
      ["ShadowOffsetX", -6],
      ["ShadowOffsetY", 9],
      ["ResizeToFit", "On"],
    ] as const) {
      effects = setEffectParameter(effects, "text-effect", key, value);
    }
    const saved = JSON.stringify({ clips: inserted.clips, effects });
    const loaded = JSON.parse(saved) as typeof inserted;

    assert.deepEqual(loaded.clips, inserted.clips);
    assert.ok(isTextClip(loaded.clips[0]));
    const style = resolveTextStyle(loaded.effects, "1", "clip:text-a");
    assert.deepEqual(style, resolveTextStyle(effects, "1", "clip:text-a"));
    assert.equal(style.text, "Line one\nLine two");
    assert.equal(style.font, "google:Roboto");
    assert.equal(style.italic, true);
    assert.equal(style.underline, true);
    assert.equal(style.strikethrough, false);
    assert.equal(style.paint.kind, "radial");
    assert.deepEqual(style.stroke, {
      color: { r: 0, g: 255, b: 0, a: 1 },
      width: 3,
    });
    assert.deepEqual(style.shadow, {
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      blur: 12,
      offsetX: -6,
      offsetY: 9,
    });
    assert.equal(style.resizeToFit, true);
  });
});

describe("text clip media", () => {
  const { clip } = insert({ clips: [], effects: [] });

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

describe("Text effect parameters", () => {
  const { effects } = insert({ clips: [], effects: [layout("1")] });

  it("lists the typography controls, knobs last", () => {
    assert.deepEqual(
      textDevice(effects).parameters.map((parameter) => [
        parameter.key,
        parameter.kind,
      ]),
      [
        ["Text", "text"],
        ["FontFamily", "font"],
        ["FontWeight", "enum"],
        ["FontStyle", "flags"],
        ["Align", "enum"],
        ["VerticalAlign", "enum"],
        ["ResizeToFit", "enum"],
        ["FillMode", "enum"],
        ["Color", "color"],
        ["Stroke", "color"],
        ["Shadow", "enum"],
        ["FontSize", "number"],
        ["LineHeight", "number"],
        ["LetterSpacing", "number"],
        ["StrokeWidth", "number"],
        ["Padding", "number"],
      ],
    );
  });

  it("shows the gradient picker in Gradient mode and shadow controls when on", () => {
    const next = setEffectParameter(
      setEffectParameter(effects, "text-effect", "FillMode", "Gradient"),
      "text-effect",
      "Shadow",
      "On",
    );
    const keys = textDevice(next).parameters.map((parameter) => parameter.key);
    assert.ok(keys.includes("Gradient"));
    assert.ok(!keys.includes("Color"));
    for (const key of [
      "ShadowColor",
      "ShadowBlur",
      "ShadowOffsetX",
      "ShadowOffsetY",
    ]) {
      assert.ok(keys.includes(key), key);
    }
  });

  it("offers only the weights the font has", () => {
    const weight = (stack: SessionEffect[]) =>
      textDevice(stack).parameters.find(
        (parameter) => parameter.key === "FontWeight",
      );
    assert.equal(weight(effects)?.options?.length, 9);

    const spaceGrotesk = setEffectParameter(
      setEffectParameter(effects, "text-effect", "FontFamily", "Space Grotesk"),
      "text-effect",
      "FontWeight",
      "Black",
    );
    assert.deepEqual(weight(spaceGrotesk)?.options, [
      "Regular",
      "Medium",
      "Bold",
    ]);
    // A weight the font lacks shows, and draws, as its nearest one.
    assert.equal(weight(spaceGrotesk)?.stringValue, "Bold");
    assert.equal(
      resolveTextStyle(spaceGrotesk, "1", "clip:text-a").weight,
      700,
    );
  });

  it("keeps empty text and style toggles", () => {
    const next = setEffectParameter(
      setEffectParameter(effects, "text-effect", "Text", ""),
      "text-effect",
      "FontStyle",
      "",
    );
    const device = textDevice(next);
    const value = (key: string) =>
      device.parameters.find((parameter) => parameter.key === key)?.stringValue;
    assert.equal(value("Text"), "");
    assert.equal(value("FontStyle"), "");
    assert.equal(resolveTextStyle(next, "1", "clip:text-a").text, "");
  });

  it("warns on the device when its font is missing", () => {
    const next = setEffectParameter(
      effects,
      "text-effect",
      "FontFamily",
      "google:Not A Font",
    );
    assert.equal(textDevice(next).warning, undefined);
    assert.equal(
      textDevice(next, new Set(["google:Not A Font"])).warning,
      "Font not available: Not A Font",
    );
    const font = textDevice(next).parameters.find(
      (parameter) => parameter.key === "FontFamily",
    );
    assert.equal(font?.display, "Not A Font");
  });
});
