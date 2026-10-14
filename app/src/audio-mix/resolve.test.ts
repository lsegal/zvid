import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gainToAmplitude as dbToAmplitude } from "../fx/effects/gain/gain.ts";
import { GRANULAR_EFFECT_NAME } from "../fx/effects/granular/granular.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_SYNTH_PARAMS,
  type SynthParams,
} from "../midi-clip.ts";
import { createArpeggiatorEffect, createSynthEffect } from "../midi-effects.ts";
import { type Arpeggiator, DEFAULT_ARPEGGIATOR } from "../note-generators.ts";
import { sourceRenderClipId } from "../render-clips.ts";
import { type AudioMixInputs, resolveAudioClips } from "./resolve.ts";
import { SYNTH_VOICE_LEVEL, synthVoices } from "./synth.ts";

// At 120 BPM one quarter is half a second.
const BPM = 120;

const MEDIA = new Map([
  ["tone", { hasAudio: true }],
  ["silent-video", { hasAudio: false }],
]);

let nextEffectId = 0;
function gain(
  trackId: string,
  db = 0,
  options: { mute?: boolean; enabled?: boolean } = {},
) {
  nextEffectId += 1;
  return {
    id: `gain-${nextEffectId}`,
    trackId,
    effectName: "Gain",
    ...(options.enabled === false ? { enabled: false } : {}),
    parameters: [
      { key: "Gain", value: String(db), numericValue: db },
      {
        key: "Mute",
        value: options.mute ? "1" : "0",
        numericValue: options.mute ? 1 : 0,
      },
    ],
  };
}

function layerClip(
  id: string,
  laneId: string,
  mediaId: string | undefined,
  startQ = 0,
  kind?: "fill" | "text" | "fx",
) {
  return {
    id,
    sourceSpanId: `layer-span-${id}`,
    sourceTrackId: `layer-track-${id}`,
    laneId,
    mediaPath: `${mediaId}.wav`,
    mediaId,
    startQ,
    durationSeconds: 2,
    trimStartSeconds: 1,
    sourceOffsetSeconds: 1 - startQ / 2,
    sourceWindowStartSeconds: 1,
    sourceWindowEndSeconds: 3,
    ...(kind ? { kind } : {}),
  };
}

// The source clip a media layer clip shows: on a source track of its own,
// exactly under it, so the clip plays all of it.
function layerSpan(clip: AudioMixInputs["clips"][number]) {
  return clip.kind || !clip.mediaId
    ? []
    : [
        {
          id: clip.sourceSpanId,
          sourceTrackId: clip.sourceTrackId,
          mediaPath: clip.mediaPath,
          mediaId: clip.mediaId,
          startQ: clip.startQ,
          durationSeconds: clip.durationSeconds,
          trimStartSeconds: clip.trimStartSeconds,
        },
      ];
}

function span(id: string, sourceTrackId: string, mediaId: string, startQ = 0) {
  return {
    id,
    sourceTrackId,
    mediaId,
    startQ,
    durationSeconds: 3,
    trimStartSeconds: 0.5,
  };
}

// The session with `overrides`, and a source clip under each media layer
// clip.
function inputs(overrides: Partial<AudioMixInputs> = {}): AudioMixInputs {
  const base: AudioMixInputs = {
    clips: [],
    lanes: [{ id: "lane-1" }, { id: "lane-2" }],
    sourceTracks: [{ id: "track-1" }, { id: "track-2" }],
    sourceSpans: [
      span("a", "track-1", "tone"),
      span("b", "track-2", "tone", 4),
    ],
    mediaById: MEDIA,
    effects: [],
    bpm: BPM,
    ...overrides,
  };
  return {
    ...base,
    sourceSpans: [...base.sourceSpans, ...base.clips.flatMap(layerSpan)],
  };
}

describe("resolveAudioClips", () => {
  it("plays the source clips with audio when no layer clip has audio", () => {
    const mix = resolveAudioClips(inputs());
    assert.equal(mix.fromSourceTracks, true);
    assert.deepEqual(
      mix.clips.map((clip) => clip.id),
      [sourceRenderClipId("a"), sourceRenderClipId("b")],
    );
  });

  it("plays only the layer clips with audio when any has audio", () => {
    const mix = resolveAudioClips(
      inputs({
        clips: [
          layerClip("with-audio", "lane-1", "tone"),
          layerClip("no-audio", "lane-2", "silent-video"),
        ],
      }),
    );
    assert.equal(mix.fromSourceTracks, false);
    assert.deepEqual(
      mix.clips.map((clip) => clip.id),
      ["with-audio"],
    );
  });

  it("falls back to the source tracks when layers hold only fill, text or silent clips", () => {
    const mix = resolveAudioClips(
      inputs({
        clips: [
          layerClip("fill", "lane-1", undefined, 0, "fill"),
          layerClip("text", "lane-1", undefined, 0, "text"),
          layerClip("silent", "lane-2", "silent-video"),
        ],
      }),
    );
    assert.equal(mix.fromSourceTracks, true);
    assert.equal(mix.clips.length, 2);
  });

  it("skips source clips whose media has no audio", () => {
    const mix = resolveAudioClips(
      inputs({
        sourceSpans: [
          span("a", "track-1", "tone"),
          span("v", "track-1", "silent-video"),
        ],
      }),
    );
    assert.deepEqual(
      mix.clips.map((clip) => clip.id),
      [sourceRenderClipId("a")],
    );
  });

  it("maps each clip to its media the way its video plays", () => {
    const [source] = resolveAudioClips(
      inputs({ sourceSpans: [span("a", "track-1", "tone", 4)] }),
    ).clips;
    // Starts at 2 s on the timeline and plays the source from 0.5 s.
    assert.equal(source.startSeconds, 2);
    assert.equal(source.durationSeconds, 3);
    assert.equal(source.sourceOffsetSeconds, -1.5);
    assert.equal(source.sourceWindowStartSeconds, 0.5);
    assert.equal(source.sourceWindowEndSeconds, 3.5);

    const [layer] = resolveAudioClips(
      inputs({ clips: [layerClip("c", "lane-1", "tone", 2)] }),
    ).clips;
    assert.equal(layer.startSeconds, 1);
    assert.equal(layer.sourceOffsetSeconds, 0);
    assert.equal(layer.sourceWindowStartSeconds, 1);
    assert.equal(layer.sourceWindowEndSeconds, 3);
  });

  it("carries each clip's media length, which it loops past", () => {
    const media = new Map([
      ["tone", { hasAudio: true, durationSeconds: 2 }],
      ["unknown", { hasAudio: true, durationSeconds: 0 }],
    ]);
    const sources = resolveAudioClips(
      inputs({
        mediaById: media,
        sourceSpans: [
          span("a", "track-1", "tone"),
          span("b", "track-2", "unknown"),
        ],
      }),
    ).clips;
    assert.deepEqual(
      sources.map((clip) => clip.mediaDurationSeconds),
      [2, 0],
    );

    const [layer] = resolveAudioClips(
      inputs({ mediaById: media, clips: [layerClip("c", "lane-1", "tone")] }),
    ).clips;
    assert.equal(layer.mediaDurationSeconds, 2);
  });

  it("is silent without a Gain on the clip's chain", () => {
    const mix = resolveAudioClips(inputs());
    assert.deepEqual(
      mix.clips.map((clip) => clip.amplitude),
      [0, 0],
    );
  });

  it("multiplies the track's and the clip's Gains, and Global is the master", () => {
    const mix = resolveAudioClips(
      inputs({
        effects: [
          gain(sourceTrackEffectTrackId("track-1"), -6),
          gain(sourceClipEffectTrackId("a"), -6),
          gain(sourceClipEffectTrackId("b"), 0),
          gain(GLOBAL_EFFECT_TRACK_ID, -3),
          // Video effects take no part in the audio chain.
          {
            id: "pixelate",
            trackId: sourceClipEffectTrackId("a"),
            effectName: "Pixelate",
            parameters: [],
          },
        ],
      }),
    );
    const [a, b] = mix.clips;
    assert.ok(Math.abs(a.amplitude - dbToAmplitude(-12)) < 1e-9);
    assert.equal(b.amplitude, 1);
    assert.ok(Math.abs(mix.masterAmplitude - dbToAmplitude(-3)) < 1e-9);
    assert.deepEqual(
      a.effects.map((effect) => effect.trackId),
      [
        GLOBAL_EFFECT_TRACK_ID,
        sourceTrackEffectTrackId("track-1"),
        sourceClipEffectTrackId("a"),
      ],
    );
  });

  it("is at unity master gain without a Global Gain", () => {
    assert.equal(resolveAudioClips(inputs()).masterAmplitude, 1);
  });

  it("reads layer clips' Gains from their layer's and their own stacks", () => {
    const mix = resolveAudioClips(
      inputs({
        clips: [layerClip("c", "lane-1", "tone")],
        effects: [gain("lane-1", -6), gain(clipEffectTrackId("c"), 6)],
      }),
    );
    assert.ok(Math.abs(mix.clips[0].amplitude - 1) < 1e-3);
  });

  it("bypasses a layer's Gains, and its clips', when the layer's FX are off", () => {
    const effects = [gain("lane-1", -6), gain(clipEffectTrackId("c"), 0)];
    const clips = [layerClip("c", "lane-1", "tone")];
    const on = resolveAudioClips(inputs({ clips, effects }));
    assert.ok(Math.abs(on.clips[0].amplitude - dbToAmplitude(-6)) < 1e-9);

    const off = resolveAudioClips(
      inputs({
        clips,
        effects,
        lanes: [{ id: "lane-1", fxEnabled: false }],
      }),
    );
    // The clip's own Gain is bypassed too, which silences it.
    assert.equal(off.clips[0].amplitude, 0);
    assert.deepEqual(off.clips[0].effects, []);
  });

  it("bypasses a source track's Gains when its FX are off", () => {
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "track-1", fxEnabled: false }, { id: "track-2" }],
        effects: [
          gain(sourceClipEffectTrackId("a"), 0),
          gain(sourceClipEffectTrackId("b"), 0),
        ],
      }),
    );
    assert.deepEqual(
      mix.clips.map((clip) => clip.amplitude),
      [0, 1],
    );
  });

  it("chains each clip through its own stack, its track's bus and the Global master", () => {
    const pixelate = {
      id: "pixelate",
      trackId: sourceTrackEffectTrackId("track-1"),
      effectName: "Pixelate",
      parameters: [],
    };
    const trackGain = gain(sourceTrackEffectTrackId("track-1"), -6);
    const clipGain = gain(sourceClipEffectTrackId("a"), 3);
    const masterGain = gain(GLOBAL_EFFECT_TRACK_ID, -1);
    const mix = resolveAudioClips(
      inputs({ effects: [pixelate, trackGain, clipGain, masterGain] }),
    );
    const [a, b] = mix.clips;
    assert.equal(a.busId, "track-1");
    assert.equal(b.busId, "track-2");
    assert.deepEqual(
      a.stages.map((stage) => [stage.id, stage.numbers.Gain]),
      [[clipGain.id, 3]],
    );
    assert.equal(a.hasGain, true);
    // Neither clip b's track nor its own stack has a Gain.
    assert.equal(b.hasGain, false);
    assert.deepEqual(
      mix.buses.map((bus) => [bus.id, bus.stages.map((stage) => stage.id)]),
      [
        ["track-1", [trackGain.id]],
        ["track-2", []],
      ],
    );
    assert.deepEqual(
      mix.master.map((stage) => stage.id),
      [masterGain.id],
    );
  });

  it("disables a bypassed track's bus and clip stages, which silences its clips", () => {
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "track-1", fxEnabled: false }, { id: "track-2" }],
        effects: [
          gain(sourceTrackEffectTrackId("track-1"), 0),
          gain(sourceClipEffectTrackId("a"), 0),
        ],
      }),
    );
    const [a] = mix.clips;
    assert.equal(a.hasGain, false);
    assert.deepEqual(
      a.stages.map((stage) => stage.enabled),
      [false],
    );
    assert.deepEqual(
      mix.buses[0].stages.map((stage) => stage.enabled),
      [false],
    );
  });

  it("carries the session's tempo and time signature, 4/4 by default", () => {
    assert.deepEqual(resolveAudioClips(inputs()).signature, {
      numerator: 4,
      denominator: 4,
    });
    const threeFour = { numerator: 3, denominator: 4 };
    const mix = resolveAudioClips(inputs({ signature: threeFour }));
    assert.deepEqual(mix.signature, threeFour);
    assert.equal(mix.bpm, BPM);
  });
});

describe("resolveAudioClips with MIDI clips", () => {
  const notes = [{ pitch: 60, start: 0, length: 1, velocity: 100 }];
  // A MIDI clip on its own track, with no media.
  function midiSpan(id: string, sourceTrackId: string, startQ = 0) {
    return {
      id,
      sourceTrackId,
      startQ,
      durationSeconds: 2,
      trimStartSeconds: 0.5,
      notes,
    };
  }
  // A Synth, or an Arpeggiator, on the MIDI clip `spanId`'s own stack.
  const synthOn = (spanId: string, params?: SynthParams) =>
    createSynthEffect(sourceClipEffectTrackId(spanId), params);
  const arpOn = (spanId: string, arp: Arpeggiator) =>
    createArpeggiatorEffect(sourceClipEffectTrackId(spanId), arp);

  it("plays a MIDI clip's notes through the Synth on its own stack", () => {
    const synth = { ...DEFAULT_SYNTH_PARAMS, wave: "sine" as const };
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "track-1" }, { id: "keys" }],
        sourceSpans: [span("a", "track-1", "tone"), midiSpan("m", "keys", 4)],
        effects: [synthOn("m", synth), gain(sourceClipEffectTrackId("m"))],
      }),
    );
    const clip = mix.clips.find((item) => item.id === sourceRenderClipId("m"));
    assert.ok(clip?.synth);
    assert.deepEqual(clip.synth.instrument, { kind: "synth", params: synth });
    assert.equal(clip.synth.notes, notes);
    // It renders from its content start to the end of its window.
    assert.equal(clip.synth.durationSeconds, 2.5);
    assert.equal(clip.mediaDurationSeconds, 2.5);
    assert.equal(clip.startSeconds, 2);
    assert.equal(clip.sourceOffsetSeconds, -1.5);
    assert.equal(clip.sourceWindowStartSeconds, 0.5);
    assert.equal(clip.sourceWindowEndSeconds, 2.5);
    assert.equal(clip.busId, "keys");
    assert.equal(clip.amplitude, 1);
    assert.match(clip.mediaId, /^synth:m:/);
    // The Synth is no audio stage of the clip's chain.
    assert.deepEqual(
      clip.effects.map((effect) => effect.effectName),
      ["Gain"],
    );
  });

  it("plays a MIDI clip's notes through a Granular on its own stack", () => {
    const stack = sourceClipEffectTrackId("m");
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "keys" }],
        sourceSpans: [midiSpan("m", "keys", 4)],
        effects: [createEffect(stack, GRANULAR_EFFECT_NAME), gain(stack)],
      }),
    );
    const clip = mix.clips.find((item) => item.id === sourceRenderClipId("m"));
    assert.deepEqual(clip?.synth?.instrument, {
      kind: "granular",
      params: DEFAULT_GRANULAR_PARAMS,
    });
    assert.match(clip.mediaId, /^synth:m:/);
    // Like the Synth, the Granular is no audio stage of the clip's chain.
    assert.deepEqual(
      clip.effects.map((effect) => effect.effectName),
      ["Gain"],
    );
  });

  it("leaves a MIDI clip without an enabled Synth silent", () => {
    const mixOf = (effects: AudioMixInputs["effects"]) =>
      resolveAudioClips(
        inputs({
          sourceTracks: [{ id: "keys" }],
          sourceSpans: [midiSpan("m", "keys")],
          effects,
        }),
      ).clips;
    assert.equal(mixOf([synthOn("m")]).length, 1);
    assert.deepEqual(mixOf([]), []);
    assert.deepEqual(mixOf([{ ...synthOn("m"), enabled: false }]), []);
    // Another clip's or the track's Synth does not play it.
    assert.deepEqual(mixOf([synthOn("other")]), []);
    assert.deepEqual(
      mixOf([{ ...synthOn("m"), trackId: sourceTrackEffectTrackId("keys") }]),
      [],
    );
  });

  it("bypasses a MIDI clip's Synth with its track's FX switch", () => {
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "keys", fxEnabled: false }],
        sourceSpans: [midiSpan("m", "keys")],
        effects: [synthOn("m")],
      }),
    );
    assert.deepEqual(mix.clips, []);
  });

  it("plays a looped clip's Start pass, then its loop, to the clip's end", () => {
    // At 120 BPM: content runs 0.5 s trimmed + 2 s, so 5 quarters.
    const mix = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "keys" }],
        sourceSpans: [
          {
            ...midiSpan("m", "keys"),
            notes: [
              { pitch: 60, start: 0, length: 1, velocity: 100 },
              { pitch: 62, start: 1, length: 1, velocity: 100 },
            ],
            midiTimeline: {
              length: 2,
              start: 1,
              loopStart: 0,
              loopEnd: 2,
              loop: true,
            },
          },
        ],
        effects: [synthOn("m")],
      }),
    );
    const synth = mix.clips[0].synth;
    assert.deepEqual(
      synth?.notes.map((played) => [played.start, played.pitch]),
      [
        [0, 62],
        [1, 60],
        [2, 62],
        [3, 60],
        [4, 62],
      ],
    );
    assert.equal(synth?.durationSeconds, 2.5);
  });

  it("renders again when its notes or its Synth change", () => {
    const mixOf = (spanNotes: typeof notes, synth?: SynthParams) =>
      resolveAudioClips(
        inputs({
          sourceTracks: [{ id: "keys" }],
          sourceSpans: [{ ...midiSpan("m", "keys"), notes: spanNotes }],
          effects: [synthOn("m", synth)],
        }),
      ).clips[0].mediaId;
    const id = mixOf(notes);
    assert.notEqual(mixOf([{ ...notes[0], velocity: 30 }]), id);
    assert.notEqual(mixOf(notes, { ...DEFAULT_SYNTH_PARAMS, release: 1 }), id);
    assert.equal(mixOf(notes, DEFAULT_SYNTH_PARAMS), id);
  });

  it("voices each note at the velocity the piano roll set (#1403)", () => {
    const edited = [
      { pitch: 60, start: 0, length: 1, velocity: 20 },
      { pitch: 62, start: 1, length: 1, velocity: 127 },
    ];
    const synth = resolveAudioClips(
      inputs({
        sourceTracks: [{ id: "keys" }],
        sourceSpans: [{ ...midiSpan("m", "keys"), notes: edited }],
        effects: [synthOn("m")],
      }),
    ).clips[0].synth;
    assert.ok(synth?.instrument.kind === "synth");
    const peaks = synthVoices(synth.notes, synth.instrument.params, BPM).map(
      (voice) => voice.envelope[1].level,
    );
    assert.deepEqual(peaks, [
      (SYNTH_VOICE_LEVEL * 20) / 127,
      SYNTH_VOICE_LEVEL,
    ]);
  });

  it("plays a clip's notes through its Arpeggiators, on the beat grid", () => {
    const chord = [
      { pitch: 60, start: 0, length: 4, velocity: 100 },
      { pitch: 64, start: 0, length: 4, velocity: 100 },
    ];
    const mixOf = (arps: Arpeggiator[], startQ = 3) =>
      resolveAudioClips(
        inputs({
          sourceTracks: [{ id: "keys" }],
          // At startQ 3 its quarter 0 falls at track quarter 3 - 1 = 2, on
          // the grid.
          sourceSpans: [
            {
              ...midiSpan("m", "keys", startQ),
              notes: chord,
              durationSeconds: 1.5,
            },
          ],
          effects: [...arps.map((arp) => arpOn("m", arp)), synthOn("m")],
        }),
      ).clips[0];
    const arp = { ...DEFAULT_ARPEGGIATOR, rate: 1 as const };
    const arpeggiated = mixOf([arp]);
    assert.deepEqual(
      arpeggiated.synth?.notes.map((note) => [note.pitch, note.start]),
      [
        [60, 0],
        [64, 1],
        [60, 2],
        [64, 3],
      ],
    );
    // Bypassing or removing it plays the clip's own notes again.
    const plain = mixOf([]);
    assert.equal(plain.synth?.notes, chord);
    assert.equal(mixOf([{ ...arp, enabled: false }]).mediaId, plain.mediaId);
    assert.notEqual(arpeggiated.mediaId, plain.mediaId);

    // A clip whose quarter 0 is off the grid steps on the grid lines.
    assert.deepEqual(
      mixOf([arp], 3.5).synth?.notes.map((note) => note.start),
      [0.5, 1.5, 2.5, 3.5],
    );
  });

  it("leaves MIDI clips without notes silent, as imported ones are", () => {
    const mix = resolveAudioClips(
      inputs({
        sourceSpans: [
          { ...midiSpan("empty", "track-1"), notes: [] },
          { ...midiSpan("placeholder", "track-2"), notes: undefined },
        ],
        effects: [synthOn("empty"), synthOn("placeholder")],
      }),
    );
    assert.deepEqual(mix.clips, []);
  });

  it("plays a layer clip's window over a MIDI clip through its Synth", () => {
    const clip = { ...layerClip("video", "lane-1", undefined), mediaPath: "" };
    const mix = resolveAudioClips(
      inputs({
        clips: [clip],
        sourceTracks: [{ id: clip.sourceTrackId }],
        sourceSpans: [
          {
            ...midiSpan(clip.sourceSpanId, clip.sourceTrackId),
            durationSeconds: 3,
            trimStartSeconds: 1,
          },
        ],
        effects: [synthOn(clip.sourceSpanId)],
      }),
    );
    assert.equal(mix.fromSourceTracks, false);
    assert.deepEqual(
      mix.clips.map((item) => [item.id, item.synth?.durationSeconds]),
      [["video", 4]],
    );
  });
});
