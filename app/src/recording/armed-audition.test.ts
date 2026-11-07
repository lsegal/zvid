import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { GAIN_EFFECT_NAME } from "../fx/effects/gain/gain.ts";
import { GRANULAR_EFFECT_NAME } from "../fx/effects/granular/granular.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import { DEFAULT_SYNTH_PARAMS } from "../midi-clip.ts";
import { createSynthEffect } from "../midi-effects.ts";
import {
  type ArmedAuditionSession,
  auditionStackOf,
  combineVoices,
  keyTrackIds,
  trackInstruments,
} from "./armed-audition.ts";

const synth = (trackId: string, cutoff: number) =>
  createSynthEffect(sourceTrackEffectTrackId(trackId), {
    ...DEFAULT_SYNTH_PARAMS,
    cutoff,
  });
const span = (
  id: string,
  sourceTrackId: string,
  startQ: number,
  notes = true,
) => ({
  id,
  sourceTrackId,
  startQ,
  ...(notes ? { notes: [] } : {}),
});

function sessionOf(
  sourceTracks: { id: string; fxEnabled?: boolean }[],
  sourceSpans: ReturnType<typeof span>[],
  effects: ArmedAuditionSession["effects"],
) {
  return {
    clips: [],
    lanes: [],
    mediaItems: [],
    sourceTracks,
    sourceSpans,
    effects,
  } as unknown as ArmedAuditionSession;
}

function cutoffs(
  armed: string[],
  session: ArmedAuditionSession,
  exceptSpanId?: string,
) {
  return trackInstruments(new Set(armed), session, exceptSpanId).map(
    (instrument) =>
      instrument.kind === "synth" ? instrument.params.cutoff : instrument.kind,
  );
}

describe("keyTrackIds", () => {
  it("is the armed tracks, leaving the selected track out", () => {
    assert.deepEqual([...keyTrackIds(new Set(["a"]), "b")], ["a"]);
  });

  it("falls back to the selected track with none armed", () => {
    assert.deepEqual([...keyTrackIds(new Set(), "b")], ["b"]);
    assert.deepEqual([...keyTrackIds(new Set(), undefined)], []);
  });
});

describe("trackInstruments", () => {
  it("gives every armed track's instrument, and only theirs", () => {
    const session = sessionOf(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [span("m1", "a", 0), span("m2", "b", 0), span("m3", "c", 0)],
      [synth("a", 100), synth("b", 200), synth("c", 300)],
    );
    assert.deepEqual(cutoffs(["a", "c"], session), [100, 300]);
    assert.deepEqual(cutoffs([], session), []);
  });

  it("resolves other kinds of instrument too", () => {
    const session = sessionOf(
      [{ id: "a" }],
      [span("m", "a", 0)],
      [createEffect(sourceTrackEffectTrackId("a"), GRANULAR_EFFECT_NAME)],
    );
    assert.deepEqual(cutoffs(["a"], session), ["granular"]);
  });

  it("plays a track's instrument with no clips at all", () => {
    assert.deepEqual(
      cutoffs(["a"], sessionOf([{ id: "a" }], [], [synth("a", 100)])),
      [100],
    );
  });

  it("leaves out a track with no instrument", () => {
    const session = sessionOf(
      [{ id: "empty" }, { id: "plain" }],
      [span("m", "plain", 0)],
      [],
    );
    assert.deepEqual(cutoffs(["empty", "plain"], session), []);
  });

  it("leaves out a track with its FX switched off", () => {
    const session = sessionOf(
      [{ id: "a", fxEnabled: false }],
      [span("m", "a", 0)],
      [synth("a", 100)],
    );
    assert.deepEqual(cutoffs(["a"], session), []);
  });

  it("takes the track's instrument, not a clip's (#1626)", () => {
    const clipSynth = createSynthEffect(sourceClipEffectTrackId("m"), {
      ...DEFAULT_SYNTH_PARAMS,
      cutoff: 800,
    });
    assert.deepEqual(
      cutoffs(
        ["a"],
        sessionOf([{ id: "a" }], [span("m", "a", 0)], [clipSynth]),
      ),
      [],
    );
    assert.deepEqual(
      cutoffs(
        ["a"],
        sessionOf(
          [{ id: "a" }],
          [span("m", "a", 0)],
          [clipSynth, synth("a", 100)],
        ),
      ),
      [100],
    );
  });

  it("leaves out the track owning the excepted clip", () => {
    const session = sessionOf(
      [{ id: "a" }, { id: "b" }],
      [span("m1", "a", 0), span("m2", "b", 0)],
      [synth("a", 100), synth("b", 200)],
    );
    assert.deepEqual(cutoffs(["a", "b"], session, "m1"), [200]);
  });
});

describe("combineVoices", () => {
  it("drops missing voices and passes a lone voice through", () => {
    const voice = { update() {}, hold() {}, release() {} };
    assert.equal(combineVoices([undefined, undefined]), undefined);
    assert.equal(combineVoices([undefined, voice]), voice);
  });

  it("fans out to every voice", () => {
    const calls: string[] = [];
    const voice = (name: string) => ({
      update: () => calls.push(`${name} update`),
      hold: () => calls.push(`${name} hold`),
      release: () => calls.push(`${name} release`),
    });
    const both = combineVoices([voice("a"), voice("b")]);
    both?.hold();
    both?.update({ bend: 0 });
    both?.release();
    assert.deepEqual(calls, [
      "a hold",
      "b hold",
      "a update",
      "b update",
      "a release",
      "b release",
    ]);
  });
});

describe("auditionStackOf", () => {
  const notes = [{ pitch: 60, start: 0, length: 1, velocity: 100 }];
  const midiSpan = (id: string, trackId: string, startQ: number) => ({
    id,
    sourceTrackId: trackId,
    mediaPath: "",
    startQ,
    durationSeconds: 2,
    trimStartSeconds: 0,
    notes,
  });
  // A layer clip showing all of `spanId`, 4 quarters (2 s) after it.
  const layerClip = (
    id: string,
    laneId: string,
    spanId: string,
    trackId: string,
    spanStartQ: number,
    startQ = spanStartQ + 4,
  ) => ({
    id,
    laneId,
    sourceSpanId: spanId,
    sourceTrackId: trackId,
    mediaPath: "",
    startQ,
    durationSeconds: 2,
    trimStartSeconds: 0,
    sourceOffsetSeconds: (spanStartQ - startQ) / 2,
    sourceSpanOffsetSeconds: -spanStartQ / 2,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
  });
  const effects = [
    createEffect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
    createEffect("lane", "Delay"),
    createEffect("other-lane", "Chorus"),
    createEffect(clipEffectTrackId("layer"), "Reverb"),
    createEffect(clipEffectTrackId("later"), "Phaser"),
    synth("track", 100),
    createEffect(sourceClipEffectTrackId("span"), GAIN_EFFECT_NAME),
    createEffect(sourceTrackEffectTrackId("track"), "Compressor"),
  ];
  const session = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      clips: [layerClip("layer", "lane", "span", "track", 0)],
      lanes: [{ id: "lane" }, { id: "other-lane" }],
      mediaItems: [],
      sourceTracks: [{ id: "track" }, { id: "elsewhere" }],
      sourceSpans: [midiSpan("span", "track", 0)],
      effects,
      bpm: 120,
      signatureId: "4/4",
      ...overrides,
    }) as unknown as ArmedAuditionSession;
  const stageNames = (
    from: ArmedAuditionSession,
    playheadQ = 0,
    spanId: string | undefined = "span",
  ) =>
    auditionStackOf("track", spanId, from, playheadQ)?.settings.stages.map(
      (stage) => stage.effectName,
    );

  it("runs what the mix runs on a clip it plays through a layer, in its order", () => {
    const played = session();
    const mix = resolveAudioClips({
      ...played,
      mediaById: new Map(),
    });
    assert.equal(mix.fromSourceTracks, false);
    const [clip] = mix.clips;
    const expected = [
      ...clip.stages,
      ...(mix.buses.find((bus) => bus.id === clip.busId)?.stages ?? []),
      ...mix.master,
    ];
    assert.deepEqual(
      stageNames(played),
      expected.map((stage) => stage.effectName),
    );
    assert.deepEqual(
      auditionStackOf("track", "span", played, 0)?.settings.stages,
      expected,
    );
    assert.deepEqual(stageNames(played), [
      "Compressor",
      GAIN_EFFECT_NAME,
      "Reverb",
      "Delay",
      "Limiter",
    ]);
  });

  it("runs the layer's stacks for a key on the track, with no clip's", () => {
    assert.deepEqual(
      auditionStackOf("track", undefined, session(), 0)?.settings.stages.map(
        (stage) => stage.effectName,
      ),
      ["Compressor", "Reverb", "Delay", "Limiter"],
    );
  });

  it("keeps a session playing its source tracks on the source clip's path", () => {
    assert.deepEqual(stageNames(session({ clips: [] })), [
      GAIN_EFFECT_NAME,
      "Compressor",
      "Limiter",
    ]);
  });

  it("ignores a layer clip the mix doesn't play, such as a text clip", () => {
    const text = {
      ...layerClip("layer", "lane", "span", "track", 0),
      kind: "text",
    };
    assert.deepEqual(stageNames(session({ clips: [text] })), [
      GAIN_EFFECT_NAME,
      "Compressor",
      "Limiter",
    ]);
  });

  it("keeps the source path for a clip no layer clip plays while others sound", () => {
    const other = midiSpan("elsewhere-span", "elsewhere", 0);
    const stack = session({
      sourceSpans: [midiSpan("span", "track", 0), other],
      clips: [layerClip("layer", "lane", other.id, other.sourceTrackId, 0)],
      effects: [...effects, synth(other.sourceTrackId, 200)],
    });
    assert.deepEqual(stageNames(stack), [
      GAIN_EFFECT_NAME,
      "Compressor",
      "Limiter",
    ]);
  });

  it("follows the layer clip at or last before the playhead, or else the first", () => {
    const played = session({
      clips: [
        layerClip("later", "other-lane", "span", "track", 0, 16),
        layerClip("layer", "lane", "span", "track", 0, 4),
      ],
    });
    const through = (playheadQ: number) => stageNames(played, playheadQ);
    const viaLayer = [
      "Compressor",
      GAIN_EFFECT_NAME,
      "Reverb",
      "Delay",
      "Limiter",
    ];
    const viaLater = [
      "Compressor",
      GAIN_EFFECT_NAME,
      "Phaser",
      "Chorus",
      "Limiter",
    ];
    assert.deepEqual(through(0), viaLayer);
    assert.deepEqual(through(10), viaLayer);
    assert.deepEqual(through(16), viaLater);
    assert.deepEqual(through(40), viaLater);
  });

  describe("with several layer clips overlapping at the playhead", () => {
    const overlapping = session({
      clips: [
        layerClip("layer", "lane", "span", "track", 0, 4),
        layerClip("later", "other-lane", "span", "track", 0, 6),
      ],
    });

    it("runs what the mix runs on each of them, and sums them", () => {
      const mix = resolveAudioClips({ ...overlapping, mediaById: new Map() });
      const stack = auditionStackOf("track", "span", overlapping, 7);
      assert.deepEqual(stack?.settings.stages, mix.master);
      assert.deepEqual(
        stack?.inputs?.map(({ id, settings }) => [id, settings.stages]),
        mix.buses.map((bus) => [bus.id, bus.stages]),
      );
      assert.deepEqual(
        stack?.inputs?.flatMap(({ inputs = [] }) =>
          inputs.map(({ id, settings }) => [
            id,
            settings.stages,
            settings.inputGain,
          ]),
        ),
        mix.clips.map((clip) => [clip.id, clip.stages, clip.hasGain ? 1 : 0]),
      );
    });

    it("runs them for a key on the track too, with no clip's stack", () => {
      const clips = auditionStackOf(
        "track",
        undefined,
        overlapping,
        7,
      )?.inputs?.flatMap(({ inputs = [] }) => inputs);
      assert.deepEqual(
        clips?.map(({ id, settings }) => [
          id,
          settings.stages.map((stage) => stage.effectName),
        ]),
        [
          ["layer", ["Compressor", "Reverb"]],
          ["later", ["Compressor", "Phaser"]],
        ],
      );
    });

    it("sums only those at the playhead, ending where each clip ends", () => {
      const clipIds = (playheadQ: number) => {
        const stack = auditionStackOf("track", "span", overlapping, playheadQ);
        return stack?.inputs?.flatMap(({ inputs = [] }) =>
          inputs.map(({ id }) => id),
        );
      };
      assert.equal(clipIds(5), undefined);
      assert.deepEqual(clipIds(6), ["layer", "later"]);
      assert.equal(clipIds(8), undefined);
      assert.deepEqual(stageNames(overlapping, 8), [
        "Compressor",
        GAIN_EFFECT_NAME,
        "Phaser",
        "Chorus",
        "Limiter",
      ]);
    });

    it("prefers a layer clip at the playhead to a later one that has ended", () => {
      const long = {
        ...layerClip("layer", "lane", "span", "track", 0, 0),
        durationSeconds: 50,
        sourceWindowEndSeconds: 50,
      };
      const played = session({
        clips: [long, layerClip("later", "other-lane", "span", "track", 0, 4)],
        sourceSpans: [{ ...midiSpan("span", "track", 0), durationSeconds: 50 }],
      });
      assert.deepEqual(stageNames(played, 40), [
        "Compressor",
        GAIN_EFFECT_NAME,
        "Reverb",
        "Delay",
        "Limiter",
      ]);
    });
  });

  it("silences a key through a layer with its FX off, as the mix silences its clip", () => {
    const off = session({
      lanes: [{ id: "lane", fxEnabled: false }, { id: "other-lane" }],
    });
    assert.equal(
      auditionStackOf("track", "span", off, 0)?.settings.inputGain,
      0,
    );
  });

  it("stays on the source path on a track with its FX off, which the mix doesn't play", () => {
    const off = session({
      sourceTracks: [{ id: "track", fxEnabled: false }, { id: "elsewhere" }],
    });
    const stages =
      auditionStackOf("track", "span", off, 0)?.settings.stages ?? [];
    assert.deepEqual(
      stages.map((stage) => stage.effectName),
      [GAIN_EFFECT_NAME, "Compressor", "Limiter"],
    );
    assert.equal(
      auditionStackOf("track", "span", off, 0)?.settings.inputGain,
      1,
    );
  });

  it("re-reads the mix for a session it has not seen", () => {
    const playing = session();
    assert.equal(stageNames(playing)?.includes("Delay"), true);
    assert.equal(stageNames(session({ clips: [] }))?.includes("Delay"), false);
    assert.equal(stageNames(playing)?.includes("Delay"), true);
  });
});
