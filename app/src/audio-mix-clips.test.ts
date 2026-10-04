import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AudioMixInputs, resolveAudioClips } from "./audio-mix/resolve.ts";
import { getAudioMixContributions } from "./audio-mix-clips.ts";
import { mixPeakLevel, mixWaveformPeaks } from "./audio-mix-peaks.ts";
import { gainToAmplitude } from "./fx/effects/gain/gain.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import type { WaveformPeaks } from "./waveform-peaks.ts";

// The Audio row's waveform for the resolved mix of some edits: each change
// that affects the audio must change what it draws.

const BPS = 10;
// At 120 BPM one quarter is half a second.
const BPM = 120;

// 10 seconds of media, loud (±0.8) only over its first second.
const TONE: WaveformPeaks = {
  bucketsPerSecond: BPS,
  durationSeconds: 10,
  min: new Float32Array(100).fill(-0.8, 0, BPS),
  max: new Float32Array(100).fill(0.8, 0, BPS),
};

function gain(trackId: string, db = 0, enabled = true) {
  return {
    id: `gain-${trackId}`,
    trackId,
    effectName: "Gain",
    ...(enabled ? {} : { enabled: false }),
    parameters: [{ key: "Gain", value: String(db), numericValue: db }],
  };
}

function inputs(overrides: Partial<AudioMixInputs> = {}): AudioMixInputs {
  return {
    clips: [],
    lanes: [],
    sourceTracks: [{ id: "track" }],
    sourceSpans: [
      {
        id: "span",
        sourceTrackId: "track",
        mediaId: "tone",
        startQ: 0,
        durationSeconds: 4,
        trimStartSeconds: 0,
      },
    ],
    mediaById: new Map([["tone", { hasAudio: true, durationSeconds: 10 }]]),
    effects: [gain(sourceClipEffectTrackId("span"))],
    bpm: BPM,
    ...overrides,
  };
}

function drawn(mixInputs: AudioMixInputs) {
  const clips = getAudioMixContributions(resolveAudioClips(mixInputs)).map(
    (contribution) => ({ ...contribution, peaks: TONE }),
  );
  return mixWaveformPeaks(clips, BPS);
}

// The song seconds the drawn waveform is loud over.
function loudSeconds(peaks: WaveformPeaks | null) {
  assert.ok(peaks);
  const loud = [...peaks.max.keys()].filter((bucket) => peaks.max[bucket] > 0);
  return loud.length
    ? [loud[0] / BPS, (loud[loud.length - 1] + 1) / BPS]
    : null;
}

function approx(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `expected ${expected}, got ${actual}`,
  );
}

function withSpan(
  change: Partial<AudioMixInputs["sourceSpans"][number]>,
): Partial<AudioMixInputs> {
  return { sourceSpans: [{ ...inputs().sourceSpans[0], ...change }] };
}

describe("the Audio row's waveform", () => {
  it("draws the clip at its Gain", () => {
    const peaks = drawn(inputs());
    assert.deepEqual(loudSeconds(peaks), [0, 1]);
    assert.ok(peaks);
    approx(mixPeakLevel(peaks), 0.8);
  });

  it("follows a Gain change, the Global Gain included", () => {
    const quieter = drawn(
      inputs({ effects: [gain(sourceClipEffectTrackId("span"), -6)] }),
    );
    assert.ok(quieter);
    approx(mixPeakLevel(quieter), 0.8 * gainToAmplitude(-6, false));

    const master = drawn(
      inputs({
        effects: [
          gain(sourceClipEffectTrackId("span")),
          gain(GLOBAL_EFFECT_TRACK_ID, -6),
        ],
      }),
    );
    assert.ok(master);
    approx(mixPeakLevel(master), 0.8 * gainToAmplitude(-6, false));
  });

  it("follows a clip moved along the timeline", () => {
    assert.deepEqual(loudSeconds(drawn(inputs(withSpan({ startQ: 4 })))), [
      2, 3,
    ]);
  });

  it("follows a clip trimmed at its start", () => {
    assert.deepEqual(
      loudSeconds(drawn(inputs(withSpan({ trimStartSeconds: 0.5 })))),
      [0, 0.5],
    );
  });

  it("follows a tempo change", () => {
    assert.deepEqual(
      loudSeconds(drawn(inputs({ ...withSpan({ startQ: 4 }), bpm: 60 }))),
      [4, 5],
    );
  });

  it("flattens when the Gain is bypassed or its track's FX are off", () => {
    const bypassed = drawn(
      inputs({ effects: [gain(sourceClipEffectTrackId("span"), 0, false)] }),
    );
    assert.equal(loudSeconds(bypassed), null);

    const trackOff = drawn(
      inputs({ sourceTracks: [{ id: "track", fxEnabled: false }] }),
    );
    assert.equal(loudSeconds(trackOff), null);
  });

  it("drops a clip whose media has no audio", () => {
    assert.equal(
      drawn(inputs({ mediaById: new Map([["tone", { hasAudio: false }]]) })),
      null,
    );
  });
});
