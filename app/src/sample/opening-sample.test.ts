import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import {
  clipEffectTrackId,
  sourceClipEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
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
const MUSIC_ID = "zvid-sample:opening-v1:music";

// The handler types in an MP4, such as "vide" or "soun" for its tracks.
function mp4TrackKinds(bytes: Buffer) {
  const kinds = new Set<string>();
  for (
    let at = bytes.indexOf("hdlr");
    at >= 0;
    at = bytes.indexOf("hdlr", at + 4)
  ) {
    kinds.add(bytes.subarray(at + 12, at + 16).toString("latin1"));
  }
  return kinds;
}

function openSample() {
  const payload = buildSampleOpenPayload(OPENING_SAMPLE_MANIFEST, sessionText);
  const media = payload.mediaRefs.map((ref) =>
    buildFallbackMediaItem(ref, PALETTE[0]),
  );
  return { media, project: sessionToProject(payload.session, media) };
}

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

  // Gain, its one audio effect, is only on the music's clip.
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

  it("writes its music as a source track clip with Gain 0 dB", () => {
    assert.equal(session.audioFilename, undefined);
    assert.equal(session.audioGainDefaulted, true);
    const musicPath = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.id === MUSIC_ID,
    )?.path;
    const track = (session.tracks ?? []).find(
      (candidate) => candidate.name === "Music",
    );
    assert.ok(track);
    assert.deepEqual(track.recordings, [{ filename: musicPath }]);
    const spans = (session.clips ?? []).filter(
      (span) => span.trackId === track.id,
    );
    assert.equal(spans.length, 1);
    assert.deepEqual(
      {
        filePath: spans[0].filePath,
        frameStart: spans[0].frameStart,
        frameCount: spans[0].frameCount,
        clipStart: spans[0].clipStart,
      },
      {
        filePath: musicPath,
        frameStart: 0,
        frameCount: 30 * FPS,
        clipStart: 0,
      },
    );
    const gains = (session.effects ?? []).filter(
      (effect) => effect.effectName === "Gain",
    );
    assert.deepEqual(
      gains.map((effect) => ({
        trackId: effect.trackId,
        gain: numberParameter(effect, "Gain"),
        mute: numberParameter(effect, "Mute"),
        enabled: effect.enabled !== false,
      })),
      [
        {
          // It loads as source clip `source-<id>`.
          trackId: sourceClipEffectTrackId(`source-${spans[0].id}`),
          gain: 0,
          mute: 0,
          enabled: true,
        },
      ],
    );
  });

  // The mix plays the source tracks only while no layer clip has sound.
  it("has video-only sources and an audio-only music file", () => {
    for (const asset of OPENING_SAMPLE_MANIFEST.assets) {
      const bytes = readFileSync(
        new URL(`../../public${asset.url}`, import.meta.url),
      );
      const kinds = mp4TrackKinds(bytes);
      const isMusic = asset.id === MUSIC_ID;
      assert.deepEqual(
        { sound: kinds.has("soun"), video: kinds.has("vide") },
        { sound: isMusic, video: !isMusic },
        asset.name,
      );
    }
  });

  it("opens with every clip on its stable media and the music in the mix", () => {
    const { media, project } = openSample();
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
      assert.equal(
        project.effects.some(
          (effect) =>
            effect.trackId === clipEffectTrackId(clip.id) &&
            effect.effectName === "Gain",
        ),
        false,
        clip.id,
      );
    }
    assert.equal("mainAudioId" in project, false);
    const music = project.sourceSpans.filter(
      (span) => span.mediaId === MUSIC_ID,
    );
    assert.equal(music.length, 1);
    assert.equal(music[0].startQ, 0);
    assert.equal(music[0].durationSeconds, 30);
    assert.equal(music[0].trimStartSeconds, 0);
    assert.equal(
      project.sourceTracks.find((track) => track.id === music[0].sourceTrackId)
        ?.name,
      "Music",
    );
    assert.equal(project.bpm, 80);
    assert.equal(project.overlapNote, "");

    // Once its media is read, only the music has sound.
    const mix = resolveAudioClips({
      clips: project.arrangementClips,
      lanes: project.lanes,
      sourceTracks: project.sourceTracks,
      sourceSpans: project.sourceSpans,
      mediaById: new Map(
        media.map((item) => [item.id, { hasAudio: item.id === MUSIC_ID }]),
      ),
      effects: project.effects,
      bpm: project.bpm,
    });
    assert.equal(mix.fromSourceTracks, true);
    assert.deepEqual(
      mix.clips.map((clip) => ({
        mediaId: clip.mediaId,
        startSeconds: clip.startSeconds,
        durationSeconds: clip.durationSeconds,
        sourceOffsetSeconds: clip.sourceOffsetSeconds,
        amplitude: clip.amplitude,
      })),
      [
        {
          mediaId: MUSIC_ID,
          startSeconds: 0,
          durationSeconds: 30,
          sourceOffsetSeconds: 0,
          amplitude: 1,
        },
      ],
    );
  });
});
