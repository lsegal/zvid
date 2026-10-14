import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { FIRST_PAD_NOTE } from "../fx/effects/drum-rack/banks.ts";
import { sourceClipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import { isAudioEffectName } from "../fx-registry.ts";
import { buildFallbackMediaItem } from "../media.ts";
import { collectSessionMediaPaths, type ProjectSession } from "../session.ts";
import { MIDI_SAMPLE_MANIFEST } from "./midi-manifest.generated.ts";
import { buildSampleOpenPayload } from "./sample-loader.ts";
import { SAMPLE_CHOICES, SAMPLE_MANIFESTS } from "./samples.ts";

// The MIDI sample (#1415): 12 bars of electro in D major whose every sound
// is generated, over two Forest Morning Lotties.

const sessionText = readFileSync(
  new URL("./zvid-midi.project.json", import.meta.url),
  "utf8",
);
const session = JSON.parse(sessionText) as ProjectSession;
const FPS = 24;
const BPM = 120;
const QUARTER_FRAMES = (FPS * 60) / BPM;
const FOREST = "zvid-sample://midi-v1/forest-morning.lottie";
// D, E, F#, G, A, B and C#.
const D_MAJOR = new Set([2, 4, 6, 7, 9, 11, 1]);

function openSample() {
  const payload = buildSampleOpenPayload(MIDI_SAMPLE_MANIFEST, sessionText);
  const media = payload.mediaRefs.map((ref) =>
    buildFallbackMediaItem(ref, PALETTE[0]),
  );
  return { media, project: sessionToProject(payload.session, media) };
}

const midiClips = () =>
  (session.clips ?? []).filter((clip) => Array.isArray(clip.notes));

function stackOf(clipId: string) {
  return (session.effects ?? []).filter(
    (effect) => effect.trackId === sourceClipEffectTrackId(`source-${clipId}`),
  );
}

const forestClips = (layerId: string) =>
  (session.selections ?? [])
    .filter((selection) => selection.mainTrackId === layerId)
    .sort((left, right) => left.frameStart - right.frameStart);

function numberParameter(
  effect: { parameters?: Record<string, { floatValue?: number }> },
  key: string,
) {
  return effect.parameters?.[key]?.floatValue;
}

describe("MIDI sample", () => {
  it("is listed under File → Open → Samples after Default", () => {
    assert.deepEqual(
      SAMPLE_CHOICES.map((choice) => choice.label),
      ["Default", "MIDI"],
    );
    assert.ok(SAMPLE_MANIFESTS.includes(MIDI_SAMPLE_MANIFEST));
  });

  it("runs 12 bars of 4/4 at 120 BPM", () => {
    const { project } = openSample();
    assert.equal(project.bpm, BPM);
    assert.equal(session.timeline?.fps, FPS);
    assert.equal(session.timeline?.projectDuration, 12 * 4 * QUARTER_FRAMES);
    for (const clip of session.clips ?? []) {
      assert.ok(
        clip.frameStart + clip.frameCount <= 48 * QUARTER_FRAMES,
        clip.id,
      );
    }
  });

  it("plays no recorded audio: its media is only Lotties and the logo", () => {
    for (const asset of MIDI_SAMPLE_MANIFEST.assets) {
      assert.match(asset.name, /\.(lottie|svg)$/, asset.name);
    }
    const assetPaths = MIDI_SAMPLE_MANIFEST.assets.map((asset) => asset.path);
    for (const path of collectSessionMediaPaths(session)) {
      assert.ok(assetPaths.includes(path), path);
    }
    for (const clip of midiClips()) {
      assert.equal(clip.filePath, "", clip.id);
    }
  });

  it("mixes only MIDI clips, through a Synth, a Granular and a Drum Rack", () => {
    const { media, project } = openSample();
    const mix = resolveAudioClips({
      clips: project.arrangementClips,
      lanes: project.lanes,
      sourceTracks: project.sourceTracks,
      sourceSpans: project.sourceSpans,
      mediaById: new Map(media.map((item) => [item.id, { hasAudio: false }])),
      effects: project.effects,
      bpm: project.bpm,
    });
    assert.equal(mix.clips.length, midiClips().length);
    const kinds = new Set<string>();
    for (const clip of mix.clips) {
      assert.ok(clip.synth, `${clip.id} is not a MIDI clip`);
      assert.equal(clip.hasGain, true, clip.id);
      kinds.add(clip.synth.instrument.kind);
    }
    assert.deepEqual([...kinds].sort(), ["drums", "granular", "synth"]);
  });

  it("stacks audio effects after each instrument", () => {
    const instruments = ["Synth", "Granular", "Drum Rack"];
    for (const clip of midiClips()) {
      const names = stackOf(clip.id).map((effect) => effect.effectName);
      const instrument = names.findIndex((name) => instruments.includes(name));
      assert.ok(instrument >= 0, `${clip.id} has no instrument`);
      const after = names
        .slice(instrument + 1)
        .filter((name) => isAudioEffectName(name) && name !== "Gain");
      assert.ok(after.length >= 2, `${clip.id}: ${names.join(", ")}`);
    }
  });

  it("keeps every pitched note in D major and every drum on a pad", () => {
    for (const clip of midiClips()) {
      const drums = stackOf(clip.id).some(
        (effect) => effect.effectName === "Drum Rack",
      );
      for (const note of clip.notes ?? []) {
        if (drums) {
          assert.ok(
            note.pitch >= FIRST_PAD_NOTE && note.pitch < FIRST_PAD_NOTE + 16,
            `${clip.id} ${note.pitch}`,
          );
        } else {
          assert.ok(D_MAJOR.has(note.pitch % 12), `${clip.id} ${note.pitch}`);
        }
      }
    }
    // The lead resolves home on D.
    const lead = midiClips().find((clip) => clip.id === "lead");
    assert.equal((lead?.notes?.at(-1)?.pitch ?? 0) % 12, 2);
  });

  it("plays Forest Morning, and its echo half a beat behind, below it", () => {
    const layerIds = (session.mainTracks ?? []).map((layer) => layer.id);
    assert.ok(layerIds.indexOf("forest") < layerIds.indexOf("forest-echo"));

    const [main] = forestClips("forest");
    assert.equal(main.frameStart, 0);
    assert.equal(main.frameEnd, 48 * QUARTER_FRAMES);
    const halfBeat = QUARTER_FRAMES / 2;
    const echoes = forestClips("forest-echo");
    assert.equal(echoes.length, 6);
    for (const [phrase, echo] of echoes.entries()) {
      const phraseStart = phrase * 8 * QUARTER_FRAMES;
      // In half a beat after each two-bar phrase starts, gone when it ends.
      assert.equal(echo.frameStart, phraseStart + halfBeat);
      assert.equal(echo.frameEnd, phraseStart + 8 * QUARTER_FRAMES);
      // Showing what Forest Morning showed half a beat before.
      assert.equal(echo.sourceOffsetSeconds, -halfBeat / FPS);
      const span = (session.clips ?? []).find(
        (clip) => clip.id === echo.sourceClipId,
      );
      assert.equal(span?.filePath, FOREST);
    }

    const mainPlace = (session.effects ?? []).find(
      (effect) => effect.trackId === `clip:selection-${main.id}`,
    );
    const echoMove = (session.effects ?? []).find(
      (effect) => effect.trackId === `clip:selection-${echoes[0].id}`,
    );
    assert.equal(mainPlace?.effectName, "Transform");
    assert.equal(echoMove?.effectName, "Move");
    const mainY = numberParameter(mainPlace ?? {}, "PositionY") ?? 0;
    const startY = numberParameter(echoMove ?? {}, "StartPositionY") ?? 0;
    const endY = numberParameter(echoMove ?? {}, "EndPositionY") ?? 0;
    // It rises in from lower down and settles below Forest Morning.
    assert.ok(startY > endY && endY > mainY, `${startY} ${endY} ${mainY}`);
  });

  it("credits every asset with its license in CREDITS.md", () => {
    const credits = readFileSync(
      new URL(
        `../../public${MIDI_SAMPLE_MANIFEST.creditsUrl}`,
        import.meta.url,
      ),
      "utf8",
    );
    for (const asset of MIDI_SAMPLE_MANIFEST.assets) {
      assert.ok(credits.includes(asset.name), asset.name);
    }
    assert.match(credits, /Lottie Simple License/);
  });
});
