import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { FIRST_PAD_NOTE } from "../fx/effects/drum-rack/banks.ts";
import { formatHueDegrees } from "../fx/params.ts";
import { sourceClipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import { normalizeEffectAnimation } from "../fx-animation-defaults.ts";
import { isAudioEffectName } from "../fx-registry.ts";
import { buildFallbackMediaItem } from "../media.ts";
import { collectSessionMediaPaths, type ProjectSession } from "../session.ts";
import { MIDI_SAMPLE_MANIFEST } from "./midi-manifest.generated.ts";
import { buildSampleOpenPayload } from "./sample-loader.ts";
import { SAMPLE_CHOICES, SAMPLE_MANIFESTS } from "./samples.ts";

// The MIDI sample (#1415): 12 bars of electro in D major whose every sound
// is generated, under LottieFiles animations; #1435 replaced its session.

const sessionText = readFileSync(
  new URL("./zvid-midi.project.json", import.meta.url),
  "utf8",
);
const session = JSON.parse(sessionText) as ProjectSession;
const FPS = 24;
const BPM = 120;
const QUARTER_FRAMES = (FPS * 60) / BPM;
const SKY = "zvid-sample://midi-v1/background-full-screen.lottie";
const TRAIN = "zvid-sample://midi-v1/background-full-screen-train.lottie";
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

describe("MIDI sample", () => {
  it("is listed under File → Open → Samples after Default", () => {
    assert.deepEqual(
      SAMPLE_CHOICES.map((choice) => choice.label),
      ["Default", "MIDI"],
    );
    assert.ok(SAMPLE_MANIFESTS.includes(MIDI_SAMPLE_MANIFEST));
  });

  it("opens at 90% zoom (#1467)", () => {
    assert.equal(openSample().project.zoom, 0.9);
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

  it("pulses the fill clip's hue once per hit and names the swaps layer (#1448, #1463)", () => {
    const colorize = (session.effects ?? []).find(
      (effect) =>
        effect.trackId === "clip:fill-e56679bc-590c-4bad-822d-611dbfaa8366" &&
        effect.effectName === "Colorize",
    );
    assert.ok(colorize);
    assert.equal(
      formatHueDegrees(colorize.parameters?._HueOffset?.floatValue ?? 0),
      "+142°",
    );
    const animation = normalizeEffectAnimation(colorize.animation, "Colorize");
    assert.equal(animation?.mode, "reactive");
    assert.deepEqual(animation?.reactive, {
      motion: "Single",
      timing: "Normal",
      reactivity: 0.7,
      amplitude: 1,
      parameters: ["_HueOffset"],
      version: 2,
    });
    const { project } = openSample();
    assert.equal(
      project.lanes.find((lane) => lane.id === "4")?.name,
      "Order Swaps",
    );
  });

  it("cycles the bars 4-5 titles FX clip's hue once per bar (#1459)", () => {
    const clipId = "fx-aafd6694-d1c4-42e3-8623-2da1b13ea02d";
    const fxClip = (session.fxClips ?? []).find((clip) => clip.id === clipId);
    assert.equal(fxClip?.mainTrackId, "titles");
    assert.equal(fxClip?.frameStart, 12 * QUARTER_FRAMES + 6);
    assert.equal(fxClip?.frameEnd, 16 * QUARTER_FRAMES);
    const stack = (session.effects ?? []).filter(
      (effect) => effect.trackId === `clip:${clipId}`,
    );
    const colorize = stack.at(-1);
    assert.equal(colorize?.effectName, "Colorize");
    assert.equal(
      formatHueDegrees(colorize?.parameters?._HueOffset?.floatValue ?? 0),
      "+153°",
    );
    const animation = normalizeEffectAnimation(colorize?.animation, "Colorize");
    assert.equal(animation?.enabled, true);
    assert.equal(animation?.mode, "lfo");
    assert.deepEqual(animation?.lfo, {
      shape: "Sine",
      sync: true,
      rate: 1,
      syncRate: "1 Bar",
      depth: 0.7,
      phase: 86,
      parameters: ["_HueOffset"],
    });
  });

  it("places the background Lotties from bar 5", () => {
    const layerIds = new Set((session.mainTracks ?? []).map((l) => l.id));
    for (const path of [SKY, TRAIN]) {
      const span = (session.clips ?? []).find((clip) => clip.filePath === path);
      assert.ok(span, path);
      assert.equal(span.frameStart, 16 * QUARTER_FRAMES, path);
      const placed = (session.selections ?? []).filter(
        (selection) => selection.trackId === span.trackId,
      );
      assert.ok(placed.length > 0, `${path} is on no layer`);
      for (const selection of placed) {
        assert.ok(layerIds.has(selection.mainTrackId), path);
        assert.ok(
          (session.effects ?? []).some(
            (effect) =>
              effect.trackId === `clip:selection-${selection.id}` &&
              ["Layout", "Transform"].includes(effect.effectName),
          ),
          `${path} clip ${selection.id} is not placed`,
        );
      }
    }
    // Opening the sample resolves them to its cached media.
    const { project } = openSample();
    for (const path of [SKY, TRAIN]) {
      const asset = MIDI_SAMPLE_MANIFEST.assets.find((a) => a.path === path);
      const span = project.sourceSpans.find((s) => s.mediaPath === path);
      assert.ok(asset && span, path);
      assert.equal(span.mediaId, asset.id, path);
    }
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
