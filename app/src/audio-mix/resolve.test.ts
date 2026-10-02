import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gainToAmplitude as dbToAmplitude } from "../fx/effects/gain/gain.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { sourceRenderClipId } from "../render-clips.ts";
import { type AudioMixInputs, resolveAudioClips } from "./resolve.ts";

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
    laneId,
    mediaId,
    startQ,
    durationSeconds: 2,
    sourceOffsetSeconds: 1 - startQ / 2,
    sourceWindowStartSeconds: 1,
    sourceWindowEndSeconds: 3,
    ...(kind ? { kind } : {}),
  };
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

function inputs(overrides: Partial<AudioMixInputs> = {}): AudioMixInputs {
  return {
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
});
