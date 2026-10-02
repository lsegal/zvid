import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClipWarp } from "../clip-warp.ts";
import { gainToAmplitude as dbToAmplitude } from "../fx/effects/gain/gain.ts";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import { sourceClipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import {
  audioMixEndSeconds,
  clipMediaTimeAt,
  type DecodedAudio,
  isAudibleMix,
  LIMITER_HEADROOM,
  LIMITER_KNEE,
  limiterCurve,
  renderAudioMix,
  softLimit,
} from "./mix.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import {
  type AudioMix,
  type AudioMixClip,
  resolveAudioClips,
} from "./resolve.ts";

const SAMPLE_RATE = 8000;
const BPM = 120;

// A mono sine of `seconds` at `peak`.
function tone(frequency: number, peak: number, seconds = 3): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] =
      peak * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

// A source of constant `value`, so mapped positions are easy to read.
function ramp(seconds: number): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] = index / SAMPLE_RATE / 100;
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function peak(data: Float32Array, from = 0, to = data.length) {
  let max = 0;
  for (let index = from; index < to; index++) {
    max = Math.max(max, Math.abs(data[index]));
  }
  return max;
}

function rms(data: Float32Array, from = 0, to = data.length) {
  let total = 0;
  for (let index = from; index < to; index++) {
    total += data[index] ** 2;
  }
  return Math.sqrt(total / (to - from));
}

function clip(overrides: Partial<AudioMixClip> = {}): AudioMixClip {
  return {
    id: "clip",
    mediaId: "media",
    startSeconds: 0,
    durationSeconds: 3,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 3,
    effects: [],
    hasGain: true,
    busId: "bus",
    ...overrides,
    amplitude: overrides.amplitude ?? 1,
    // A Gain at its amplitude, as resolving a clip with one gives it.
    stages: overrides.stages ?? [gainStageAt(overrides.amplitude ?? 1)],
  };
}

function mix(clips: AudioMixClip[], masterAmplitude = 1): AudioMix {
  return {
    clips,
    buses: [{ id: "bus", stages: [] }],
    master: [gainStageAt(masterAmplitude)],
    masterAmplitude,
    fromSourceTracks: true,
    bpm: BPM,
    signature: DEFAULT_TIME_SIGNATURE,
  };
}

function render(
  audioMix: AudioMix,
  media: Record<string, DecodedAudio>,
  seconds = 3,
  startSeconds = 0,
  numberOfChannels = 1,
) {
  return renderAudioMix(audioMix, new Map(Object.entries(media)), {
    sampleRate: SAMPLE_RATE,
    numberOfChannels,
    startSeconds,
    length: Math.round(seconds * SAMPLE_RATE),
  });
}

describe("soft limiter", () => {
  it("passes the mix through below the knee", () => {
    for (const sample of [0, 0.25, -0.5, LIMITER_KNEE, -LIMITER_KNEE]) {
      assert.equal(softLimit(sample), sample);
    }
  });

  it("keeps any level within full scale, never falling as it rises", () => {
    let previous = softLimit(LIMITER_KNEE);
    for (const sample of [0.95, 1, 1.5, 2, 4, 8, 100]) {
      const limited = softLimit(sample);
      assert.ok(limited <= 1, `${sample} → ${limited}`);
      assert.ok(limited >= previous);
      assert.equal(softLimit(-sample), -limited);
      previous = limited;
    }
  });

  it("gives the preview's WaveShaper curve the same response", () => {
    const curve = limiterCurve(17);
    // The curve's input is the mix scaled by 1 / LIMITER_HEADROOM.
    for (let index = 0; index < curve.length; index++) {
      const mixLevel =
        ((index / (curve.length - 1)) * 2 - 1) * LIMITER_HEADROOM;
      assert.ok(Math.abs(curve[index] - softLimit(mixLevel)) < 1e-6);
    }
  });
});

describe("clipMediaTimeAt", () => {
  it("maps timeline time through the clip's offset and source window", () => {
    const trimmed = clip({
      startSeconds: 2,
      durationSeconds: 1,
      sourceOffsetSeconds: -1.5,
      sourceWindowStartSeconds: 0.5,
      sourceWindowEndSeconds: 1.5,
    });
    assert.equal(clipMediaTimeAt(trimmed, 1.9, BPM), undefined);
    assert.deepEqual(clipMediaTimeAt(trimmed, 2, BPM), {
      mediaTime: 0.5,
      playbackRate: 1,
    });
    assert.deepEqual(clipMediaTimeAt(trimmed, 2.75, BPM), {
      mediaTime: 1.25,
      playbackRate: 1,
    });
    assert.equal(clipMediaTimeAt(trimmed, 3, BPM), undefined);
  });

  it("follows the clip's warp markers, as its video does", () => {
    // Two beats of content stretched over one second of source: half speed
    // at 120 BPM.
    const warp: ClipWarp = {
      markers: [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 1 },
      ],
      contentStartBeat: 0,
      anchorSeconds: 0,
    };
    const at = clipMediaTimeAt(clip({ warp }), 1, BPM);
    assert.ok(at);
    assert.ok(Math.abs(at.mediaTime - 0.5) < 1e-9);
    assert.ok(Math.abs(at.playbackRate - 0.5) < 1e-9);
  });
});

describe("renderAudioMix", () => {
  it("sums overlapping clips at their amplitudes", () => {
    const [output] = render(
      mix([
        clip({ id: "a", mediaId: "a", amplitude: 0.5 }),
        clip({ id: "b", mediaId: "b", amplitude: 0.25 }),
      ]),
      { a: tone(220, 0.8), b: tone(220, 0.8) },
    );
    // In phase: 0.8 × (0.5 + 0.25).
    assert.ok(Math.abs(peak(output) - 0.6) < 1e-3);
  });

  it("mixes two −6 dB tones on source clips to their summed level, and a clip without Gain drops out", () => {
    const media = new Map([
      ["low", { hasAudio: true }],
      ["high", { hasAudio: true }],
    ]);
    const spans = [
      {
        id: "low",
        sourceTrackId: "track-1",
        mediaId: "low",
        startQ: 0,
        durationSeconds: 3,
        trimStartSeconds: 0,
      },
      {
        id: "high",
        sourceTrackId: "track-2",
        mediaId: "high",
        startQ: 0,
        durationSeconds: 3,
        trimStartSeconds: 0,
      },
    ];
    const gainAt = (spanId: string) => ({
      id: `gain-${spanId}`,
      trackId: sourceClipEffectTrackId(spanId),
      effectName: "Gain",
      parameters: [{ key: "Gain", value: "-6", numericValue: -6 }],
    });
    const resolve = (effects: ReturnType<typeof gainAt>[]) =>
      resolveAudioClips({
        clips: [],
        lanes: [],
        sourceTracks: [{ id: "track-1" }, { id: "track-2" }],
        sourceSpans: spans,
        mediaById: media,
        effects,
        bpm: BPM,
      });
    const decoded = { low: tone(220, 0.5), high: tone(330, 0.5) };
    const single = 0.5 * dbToAmplitude(-6);
    // Each sine's RMS is peak / √2; uncorrelated sines add in power.
    const expectedRms = Math.sqrt(2 * (single / Math.SQRT2) ** 2);

    const [both] = render(resolve([gainAt("low"), gainAt("high")]), decoded);
    assert.ok(Math.abs(rms(both) - expectedRms) < 2e-3, `${rms(both)}`);
    assert.ok(peak(both) > single * 1.5);

    const [one] = render(resolve([gainAt("low")]), decoded);
    assert.ok(Math.abs(rms(one) - single / Math.SQRT2) < 2e-3);
    assert.ok(Math.abs(peak(one) - single) < 1e-3);
  });

  it("plays each clip only over its own span, from its source window", () => {
    const [output] = render(
      mix([
        clip({
          startSeconds: 1,
          durationSeconds: 1,
          sourceOffsetSeconds: 1,
          sourceWindowStartSeconds: 2,
          sourceWindowEndSeconds: 3,
        }),
      ]),
      { media: ramp(4) },
    );
    assert.equal(peak(output, 0, SAMPLE_RATE - 1), 0);
    assert.equal(peak(output, 2 * SAMPLE_RATE + 1), 0);
    // At 1.5 s on the timeline the source is at 2.5 s.
    assert.ok(Math.abs(output[1.5 * SAMPLE_RATE] - 0.025) < 1e-6);
  });

  it("starts at the render's start time, as an export range does", () => {
    const [output] = render(mix([clip()]), { media: ramp(4) }, 1, 1.5);
    assert.ok(Math.abs(output[0] - 0.015) < 1e-6);
  });

  it("applies the master gain, then limits the mix to full scale", () => {
    const loud = mix(
      [
        clip({ id: "a", amplitude: dbToAmplitude(10) }),
        clip({ id: "b", amplitude: dbToAmplitude(10) }),
      ],
      dbToAmplitude(10),
    );
    const [output] = render(loud, { media: tone(220, 1) });
    assert.ok(peak(output) <= 1);
    assert.ok(peak(output) > LIMITER_KNEE);

    const [halved] = render(mix([clip()], 0.5), { media: tone(220, 0.8) });
    assert.ok(Math.abs(peak(halved) - 0.4) < 1e-3);
  });

  it("is silent for clips at zero amplitude or with missing media", () => {
    const [output] = render(
      mix([clip({ amplitude: 0 }), clip({ id: "gone", mediaId: "gone" })]),
      { media: tone(220, 1) },
    );
    assert.equal(peak(output), 0);
  });

  it("spreads mono media to every output channel", () => {
    const [left, right] = render(
      mix([clip()]),
      { media: tone(220, 0.5) },
      1,
      0,
      2,
    );
    assert.deepEqual(left, right);
    assert.ok(peak(left) > 0.49);
  });

  it("varispeeds warped clips with their source mapping", () => {
    const warp: ClipWarp = {
      markers: [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 1 },
      ],
      contentStartBeat: 0,
      anchorSeconds: 0,
    };
    const [output] = render(mix([clip({ warp })]), { media: ramp(4) }, 2);
    // Half speed: 1 s on the timeline plays 0.5 s of source.
    assert.ok(Math.abs(output[SAMPLE_RATE] - 0.005) < 1e-5);
  });
});

describe("mix helpers", () => {
  it("knows whether anything in a mix can sound", () => {
    assert.equal(isAudibleMix(mix([clip({ amplitude: 0 })])), false);
    assert.equal(isAudibleMix(mix([clip()], 0)), false);
    assert.equal(isAudibleMix(mix([clip()])), true);
  });

  it("ends with its last clip", () => {
    assert.equal(
      audioMixEndSeconds(
        mix([clip(), clip({ startSeconds: 2, durationSeconds: 4 })]),
      ),
      6,
    );
  });
});
