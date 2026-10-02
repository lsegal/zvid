import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { FX_EFFECT_DEFINITIONS } from "../fx-registry.ts";
import { buildFallbackMediaItem } from "../media.ts";
import { collectSessionMediaPaths, type LvpSession } from "../session.ts";
import { OPENING_SAMPLE_MANIFEST } from "./opening-manifest.generated.ts";
import { buildSampleOpenPayload } from "./sample-loader.ts";

const sessionText = readFileSync(
  new URL("./zvid-opening.lvp", import.meta.url),
  "utf8",
);
const session = JSON.parse(sessionText) as LvpSession;
const FPS = 30;

function effectsOn(trackId: string) {
  return (session.effects ?? []).filter((effect) => effect.trackId === trackId);
}

function stringParameter(
  effect: { parameters?: Record<string, { stringValue?: string }> },
  key: string,
) {
  return effect.parameters?.[key]?.stringValue;
}

function numberParameter(
  effect: { parameters?: Record<string, { floatValue?: number }> },
  key: string,
) {
  return effect.parameters?.[key]?.floatValue;
}

// The layer clips covering `seconds`.
function clipsAt<Clip extends { frameStart: number; frameEnd: number }>(
  clips: Clip[] | undefined,
  seconds: number,
) {
  const frame = seconds * FPS;
  return (clips ?? []).filter(
    (clip) => clip.frameStart <= frame && frame < clip.frameEnd,
  );
}

describe("zvid opening sample", () => {
  it("is exactly 30 seconds at 30 fps and 1920×1080", () => {
    assert.deepEqual(
      {
        fps: session.timeline?.fps,
        width: session.timeline?.canvasWidth,
        height: session.timeline?.canvasHeight,
        duration: session.timeline?.projectDuration,
      },
      { fps: 30, width: 1920, height: 1080, duration: 900 },
    );
    const lastFrame = Math.max(
      ...(session.selections ?? []).map((selection) => selection.frameEnd),
      ...(session.fills ?? []).map((clip) => clip.frameEnd),
      ...(session.texts ?? []).map((clip) => clip.frameEnd),
      ...(session.fxClips ?? []).map((clip) => clip.frameEnd),
    );
    assert.equal(lastFrame, 900);
  });

  // Its clips with sound get their Gain when it opens, so the audio effects
  // aren't written into it.
  it("uses every registered video effect", () => {
    const used = new Set((session.effects ?? []).map((e) => e.effectName));
    const missing = FX_EFFECT_DEFINITIONS.filter(
      (definition) => definition.domain !== "audio",
    )
      .map((definition) => definition.effectName)
      .filter((name) => !used.has(name));
    assert.deepEqual(missing, []);
  });

  it("cuts three separate video layers every 1.5 s through the three-ups", () => {
    const videoLayers = new Set(
      (session.selections ?? []).map((selection) => selection.mainTrackId),
    );
    assert.deepEqual([...videoLayers].sort(), ["corridor", "orbit", "ribbon"]);
    for (const layer of videoLayers) {
      const starts = (session.selections ?? [])
        .filter((selection) => selection.mainTrackId === layer)
        .map((selection) => selection.frameStart / FPS);
      assert.ok(starts.includes(4.5), `${layer} cuts at 4.5 s`);
      assert.ok(starts.includes(16.5), `${layer} cuts at 16.5 s`);
    }
    // The panels' sources change order at the cuts.
    const sourceAt = (layer: string, seconds: number) =>
      (session.selections ?? []).find(
        (selection) =>
          selection.mainTrackId === layer &&
          selection.frameStart === seconds * FPS,
      )?.trackId;
    assert.notEqual(sourceAt("orbit", 3), sourceAt("orbit", 4.5));
  });

  it("alternates Horizontal and Vertical Orders whose ivory spacing and margin animate", () => {
    const arrangements = (session.fxClips ?? [])
      .filter((clip) => clip.mainTrackId === "order")
      .map((clip) => {
        const [order] = effectsOn(`clip:${clip.id}`);
        assert.equal(order.effectName, "Order");
        assert.equal(numberParameter(order, "Spacing"), 108);
        assert.equal(numberParameter(order, "Margin"), 108);
        assert.equal(
          stringParameter(order, "BorderColor"),
          "rgba(243,226,191,1)",
        );
        assert.equal(stringParameter(order, "ExcludedLayers"), "background");
        assert.equal(order.animation?.enabled, true);
        assert.equal(order.animation?.mode, "clip");
        assert.equal(order.animation?.clip.timing, "Full");
        return stringParameter(order, "Arrangement");
      });
    assert.ok(arrangements.filter((a) => a === "Horizontal").length >= 4);
    assert.ok(arrangements.filter((a) => a === "Vertical").length >= 4);
    // No Order over the full-frame shots and the title card.
    for (const seconds of [0.5, 2, 13, 28]) {
      assert.deepEqual(
        clipsAt(session.fxClips, seconds).filter(
          (clip) => clip.mainTrackId === "order",
        ),
        [],
      );
    }
  });

  it("limits Pixelate, Negative Split and Analog Glitch to moving, turning boxes", () => {
    const regions = (session.fxClips ?? []).filter(
      (clip) => clip.mainTrackId === "fx-regions",
    );
    assert.deepEqual(
      regions.map((clip) => [
        clip.frameStart / FPS,
        effectsOn(`clip:${clip.id}`).map((effect) => effect.effectName),
      ]),
      [
        [12, ["Pixelate", "Move", "Transform"]],
        [15, ["NegativeSplit", "Move", "Transform"]],
        [18, ["AnalogGlitch", "Move", "Transform"]],
      ],
    );
    for (const clip of regions) {
      const [, move, transform] = effectsOn(`clip:${clip.id}`);
      assert.equal(numberParameter(transform, "ScaleX"), 0.3);
      assert.equal(numberParameter(transform, "ScaleY"), 0.56);
      assert.equal(numberParameter(move, "StartRotation"), -16);
      assert.equal(numberParameter(move, "EndRotation"), 16);
      assert.ok(
        (numberParameter(move, "StartPositionX") ?? 0) <
          (numberParameter(move, "EndPositionX") ?? 0),
      );
    }
  });

  it("colors the reactive passages with audio-driven Colorize", () => {
    const colorized = (session.effects ?? []).filter(
      (effect) => effect.effectName === "Colorize",
    );
    assert.ok(colorized.length >= 12);
    for (const effect of colorized) {
      assert.equal(effect.animation?.mode, "reactive");
      assert.equal(effect.animation?.enabled, true);
      assert.equal(effect.animation?.reactive?.reactivity, 1);
      assert.deepEqual(effect.animation?.reactive?.parameters, ["_HueOffset"]);
    }
  });

  it("holds the ivory title card for the last three seconds", () => {
    const [card] = clipsAt(session.fills, 28);
    assert.ok(card);
    assert.equal(card.frameEnd - card.frameStart, 90);
    const texts = clipsAt(session.texts, 28).map((clip) =>
      stringParameter(effectsOn(`clip:${clip.id}`)[0], "Text"),
    );
    assert.deepEqual(texts.sort(), ["capture, edit, repeat", "zvid"]);
  });

  it("refers only to manifest assets, whose files match their hashes", () => {
    const paths = collectSessionMediaPaths(session);
    const assetPaths = OPENING_SAMPLE_MANIFEST.assets.map(
      (asset) => asset.path,
    );
    assert.deepEqual([...paths].sort(), [...assetPaths].sort());
    for (const asset of OPENING_SAMPLE_MANIFEST.assets) {
      const bytes = readFileSync(
        new URL(`../../public${asset.url}`, import.meta.url),
      );
      assert.equal(bytes.length, asset.bytes, asset.name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        asset.sha256,
        asset.name,
      );
    }
  });

  it("opens with every clip and the main audio on its stable media", () => {
    const payload = buildSampleOpenPayload(
      OPENING_SAMPLE_MANIFEST,
      sessionText,
    );
    const media = payload.mediaRefs.map((ref) =>
      buildFallbackMediaItem(ref, PALETTE[0]),
    );
    const project = sessionToProject(payload.session, media);
    const ids = new Set(
      OPENING_SAMPLE_MANIFEST.assets.map((asset) => asset.id),
    );
    const videoClips = project.arrangementClips.filter(
      (clip) =>
        clip.kind !== "fx" && clip.kind !== "text" && clip.kind !== "fill",
    );
    assert.equal(videoClips.length, (session.selections ?? []).length);
    for (const clip of videoClips) {
      assert.ok(ids.has(clip.mediaId ?? ""), clip.id);
    }
    // Its old main audio becomes a source track holding the music.
    assert.ok(
      project.sourceSpans.some(
        (span) => span.mediaId === "zvid-sample:opening-v1:music",
      ),
    );
    assert.equal(project.bpm, 80);
    assert.equal(project.overlapNote, "");
  });
});
