import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { clipEffectTrackId } from "../fx/stack/clip-stacks.ts";
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
const MUSIC_ID = "zvid-sample:opening-v2:music";
const AUDIO_LAYER = "audio";
const MUSIC_TRACK = "source-music";

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

// The Audio layer's music selections, in time order.
function musicSelections() {
  return (session.selections ?? [])
    .filter((selection) => selection.mainTrackId === AUDIO_LAYER)
    .sort((left, right) => left.frameStart - right.frameStart);
}

function videoSelections() {
  return (session.selections ?? []).filter(
    (selection) => selection.mainTrackId !== AUDIO_LAYER,
  );
}

// The clips on a source track.
function spansOn(trackId: string) {
  return (session.clips ?? []).filter((clip) => clip.trackId === trackId);
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

  it("uses every registered video effect", () => {
    const used = new Set((session.effects ?? []).map((e) => e.effectName));
    const missing = FX_EFFECT_DEFINITIONS.filter(
      (definition) => definition.domain !== "audio",
    )
      .map((definition) => definition.effectName)
      .filter((name) => !used.has(name));
    assert.deepEqual(missing, []);
  });

  // Color paints the fill clips; every other Stylize or Color effect is
  // shown off on a clip of its own.
  it("puts each Stylize and Color effect on a clip of its own", () => {
    const showcased = new Set(
      FX_EFFECT_DEFINITIONS.filter(
        (definition) =>
          definition.domain !== "audio" &&
          (definition.category === "stylize" ||
            definition.category === "color") &&
          definition.effectName !== "Color",
      ).map((definition) => definition.effectName),
    );
    const byClip = new Map<string, string[]>();
    for (const effect of session.effects ?? []) {
      if (
        effect.trackId.startsWith("clip:") &&
        showcased.has(effect.effectName)
      ) {
        byClip.set(effect.trackId, [
          ...(byClip.get(effect.trackId) ?? []),
          effect.effectName,
        ]);
      }
    }
    for (const [clip, names] of byClip) {
      assert.equal(names.length, 1, `${clip}: ${names.join(", ")}`);
    }
    // Distortion and Refraction show off every one of their types.
    const types = (effectName: string) =>
      new Set(
        (session.effects ?? [])
          .filter((effect) => effect.effectName === effectName)
          .map((effect) => stringParameter(effect, "_Type")),
      );
    assert.deepEqual([...types("Distortion")].sort(), [
      "Bulge",
      "Fisheye",
      "Ripple",
      "Turbulence",
      "Twirl",
      "Wave",
    ]);
    assert.deepEqual([...types("Refraction")].sort(), [
      "Frosted Glass",
      "Glass Blocks",
      "Reeded Glass",
      "Water",
    ]);
  });

  it("cuts three separate video layers every 1.5 s through the three-ups", () => {
    const videoLayers = new Set(
      videoSelections().map((selection) => selection.mainTrackId),
    );
    assert.deepEqual([...videoLayers].sort(), ["corridor", "orbit", "ribbon"]);
    for (const layer of videoLayers) {
      const starts = videoSelections()
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
        // The Audio layer's music takes no panel.
        assert.equal(
          stringParameter(order, "ExcludedLayers"),
          "background,audio",
        );
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
    assert.deepEqual(
      effectsOn(`clip:${card.id}`).map((effect) => effect.effectName),
      ["Color", "Caustics"],
    );
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

  it("holds one clip on each source track, which its cuts slip to their in-points", () => {
    const tracks = session.tracks ?? [];
    assert.equal(tracks.length, 4);
    assert.equal((session.clips ?? []).length, tracks.length);
    const { project } = openSample();
    for (const track of tracks.filter((track) => track.id !== MUSIC_TRACK)) {
      const spans = spansOn(track.id);
      assert.equal(spans.length, 1, track.id);
      const [span] = spans;
      assert.equal(span.frameStart, 0, track.id);
      assert.equal(span.clipStart, 0, track.id);
      assert.equal(span.filePath, track.recordings?.[0]?.filename, track.id);

      // Each cut names the clip and plays it from its own in-point.
      const sourceSpan = project.sourceSpans.find(
        (candidate) => candidate.sourceTrackId === track.id,
      );
      for (const selection of videoSelections().filter(
        (candidate) => candidate.trackId === track.id,
      )) {
        assert.equal(selection.sourceClipId, span.id);
        const clip = project.arrangementClips.find(
          (candidate) => candidate.id === `selection-${selection.id}`,
        );
        assert.equal(clip?.sourceSpanId, sourceSpan?.id);
        const inSeconds =
          selection.frameStart / FPS + (selection.sourceOffsetSeconds ?? 0);
        assert.ok(
          Math.abs((clip?.trimStartSeconds ?? -1) - inSeconds) < 1e-9,
          clip?.id,
        );
        assert.ok(inSeconds >= 0, clip?.id);
        assert.ok(
          inSeconds * FPS + selection.frameEnd - selection.frameStart <=
            span.frameCount + 1e-6,
          clip?.id,
        );
      }
    }
  });

  it("plays its music from the Audio layer as two-beat selections", () => {
    assert.equal(session.audioFilename, undefined);
    assert.equal(session.audioGainDefaulted, true);
    assert.equal(session.mainTracks?.at(-1)?.id, AUDIO_LAYER);
    const musicPath = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.id === MUSIC_ID,
    )?.path;
    const track = (session.tracks ?? []).find(
      (candidate) => candidate.id === MUSIC_TRACK,
    );
    assert.equal(track?.name, "Music");
    assert.deepEqual(track?.recordings, [{ filename: musicPath }]);

    // The source track holds the whole music as one clip.
    const spans = spansOn(MUSIC_TRACK);
    assert.equal(spans.length, 1);
    const [span] = spans;
    assert.equal(span.filePath, musicPath);
    assert.equal(span.frameStart, 0);
    assert.equal(span.clipStart, 0);
    assert.equal(span.frameCount, 30 * FPS);

    // Back to back from 0 to 30 s, two beats each, each playing the music
    // where it is in the file.
    const selections = musicSelections();
    assert.equal(selections.length, 20);
    let frame = 0;
    for (const selection of selections) {
      assert.equal(selection.trackId, MUSIC_TRACK);
      assert.equal(selection.frameStart, frame);
      assert.equal(selection.frameEnd - selection.frameStart, 1.5 * FPS);
      assert.equal(selection.sourceClipId, undefined);
      frame = selection.frameEnd;
    }
    assert.equal(frame, 30 * FPS);
  });

  it("gives each music selection a 0 dB Gain and an audio effect of its own", () => {
    const audioEffectNames = new Set(
      FX_EFFECT_DEFINITIONS.filter(
        (definition) => definition.domain === "audio",
      ).map((definition) => definition.effectName),
    );
    const shown: string[] = [];
    for (const selection of musicSelections()) {
      const clip = `selection-${selection.id}`;
      const [gain, ...others] = effectsOn(clipEffectTrackId(clip));
      assert.equal(gain.effectName, "Gain", clip);
      assert.equal(gain.enabled !== false, true, clip);
      assert.equal(numberParameter(gain, "Gain"), 0, clip);
      assert.equal(numberParameter(gain, "Mute"), 0, clip);
      assert.ok(others.length <= 1, clip);
      for (const effect of others) {
        assert.ok(audioEffectNames.has(effect.effectName), effect.effectName);
        shown.push(effect.effectName);
      }
    }
    // The first two beats are clean, and every other audio effect has a
    // selection of its own.
    const [first] = musicSelections();
    assert.equal(
      effectsOn(clipEffectTrackId(`selection-${first.id}`)).length,
      1,
    );
    assert.deepEqual(
      [...shown].sort(),
      [...audioEffectNames].filter((name) => name !== "Gain").sort(),
    );
    // Audio effects are only on the music's selections.
    const musicClips = new Set(
      musicSelections().map((selection) =>
        clipEffectTrackId(`selection-${selection.id}`),
      ),
    );
    for (const effect of session.effects ?? []) {
      if (audioEffectNames.has(effect.effectName)) {
        assert.ok(musicClips.has(effect.trackId), effect.id);
      }
    }
  });

  // The mix plays the layer clips with sound: the Audio layer's music.
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

  it("credits its music in the manifest and CREDITS.md", () => {
    const music = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.id === MUSIC_ID,
    );
    assert.equal(music?.name, "just-nasty-30s.m4a");
    assert.match(
      music?.credit ?? "",
      /^"Just Nasty" by Kevin MacLeod \(incompetech\.com\), licensed under CC BY 4\.0 /,
    );
    const credits = readFileSync(
      new URL(
        `../../public${OPENING_SAMPLE_MANIFEST.creditsUrl}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      credits,
      /^"Just Nasty" by Kevin MacLeod \(incompetech\.com\)$/m,
    );
    assert.match(credits, /^`just-nasty-30s\.m4a` is the excerpt/m);
  });

  it("opens with every clip on its stable media and the Audio layer in the mix", () => {
    const { media, project } = openSample();
    const ids = new Set(
      OPENING_SAMPLE_MANIFEST.assets.map((asset) => asset.id),
    );
    const mediaClips = project.arrangementClips.filter(
      (clip) =>
        clip.kind !== "fx" && clip.kind !== "text" && clip.kind !== "fill",
    );
    assert.equal(mediaClips.length, (session.selections ?? []).length);
    for (const clip of mediaClips) {
      assert.ok(ids.has(clip.mediaId ?? ""), clip.id);
    }
    // The video clips are silent: no Gain.
    for (const clip of mediaClips.filter(
      (candidate) => candidate.laneId !== AUDIO_LAYER,
    )) {
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
    for (const span of music) {
      assert.equal(
        project.sourceTracks.find((track) => track.id === span.sourceTrackId)
          ?.name,
        "Music",
      );
    }
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
    assert.equal(mix.fromSourceTracks, false);
    const mixed = [...mix.clips].sort(
      (left, right) => left.startSeconds - right.startSeconds,
    );
    assert.equal(mixed.length, 20);
    let seconds = 0;
    for (const clip of mixed) {
      assert.equal(clip.mediaId, MUSIC_ID);
      assert.equal(clip.busId, AUDIO_LAYER);
      assert.ok(Math.abs(clip.startSeconds - seconds) < 1e-9, clip.id);
      assert.ok(Math.abs(clip.durationSeconds - 1.5) < 1e-9, clip.id);
      // Each plays the music where it is in the file, so it runs on
      // unbroken.
      assert.ok(Math.abs(clip.sourceOffsetSeconds) < 1e-9, clip.id);
      assert.equal(clip.hasGain, true, clip.id);
      assert.equal(clip.amplitude, 1, clip.id);
      seconds += clip.durationSeconds;
    }
    assert.ok(Math.abs(seconds - 30) < 1e-9);
  });
});
