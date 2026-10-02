import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeAudioMix,
  type MixPeaksClip,
  mixPeakLevel,
  mixWaveformPeaks,
} from "./audio-mix-peaks.ts";
import type { WaveformPeaks } from "./waveform-peaks.ts";

const BPS = 10;

// A constant waveform swinging ±`level` for `seconds`.
function flatPeaks(level: number, seconds: number): WaveformPeaks {
  const count = seconds * BPS;
  return {
    bucketsPerSecond: BPS,
    durationSeconds: seconds,
    min: new Float32Array(count).fill(-level),
    max: new Float32Array(count).fill(level),
  };
}

function clip(
  peaks: WaveformPeaks,
  startSeconds: number,
  endSeconds: number,
  amplitude: number,
): MixPeaksClip {
  return {
    peaks,
    startSeconds,
    endSeconds,
    amplitude,
    sourceSecondsAt: (songSeconds) => songSeconds - startSeconds,
  };
}

function approx(actual: number | undefined, expected: number) {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-6,
    `expected ${expected}, got ${actual}`,
  );
}

describe("describeAudioMix", () => {
  it("names where the mix comes from and how many clips it has", () => {
    assert.equal(
      describeAudioMix("source-tracks", 3),
      "From source tracks · 3 clips",
    );
    assert.equal(describeAudioMix("layers", 1), "From layers · 1 clip");
    assert.equal(describeAudioMix("layers", 0), "No audio");
  });
});

describe("mixWaveformPeaks", () => {
  it("returns null without clips that render audio", () => {
    assert.equal(mixWaveformPeaks([], BPS), null);
  });

  it("sums overlapping clips, each scaled by its gain", () => {
    const mix = mixWaveformPeaks(
      [clip(flatPeaks(0.5, 2), 0, 2, 1), clip(flatPeaks(0.4, 2), 1, 3, 0.5)],
      BPS,
    );
    assert.ok(mix);
    assert.equal(mix.durationSeconds, 3);
    assert.equal(mix.max.length, 30);
    // Only the first clip plays before 1 s.
    approx(mix.max[5], 0.5);
    approx(mix.min[5], -0.5);
    // Both overlap between 1 s and 2 s.
    approx(mix.max[15], 0.7);
    approx(mix.min[15], -0.7);
    // Only the second one plays after 2 s, at half gain.
    approx(mix.max[25], 0.2);
  });

  it("draws a clip without gain flat, but keeps the mix's length", () => {
    const mix = mixWaveformPeaks([clip(flatPeaks(0.8, 2), 0, 2, 0)], BPS);
    assert.ok(mix);
    assert.equal(mix.durationSeconds, 2);
    assert.ok(mix.max.every((value) => value === 0));
    assert.ok(mix.min.every((value) => value === 0));
  });

  it("follows the clip's mapping into its source", () => {
    const peaks = flatPeaks(0, 4);
    peaks.max[25] = 1;
    // Song 0.5 s plays source 2.5 s.
    const mix = mixWaveformPeaks(
      [
        {
          ...clip(peaks, 0, 1, 1),
          sourceSecondsAt: (songSeconds) => songSeconds + 2,
        },
      ],
      BPS,
    );
    assert.ok(mix);
    approx(mix.max[5], 1);
    approx(mix.max[4], 0);
  });

  it("keeps peaks a faster clip skips between buckets", () => {
    const peaks = flatPeaks(0, 4);
    peaks.max[3] = 1;
    // At 4×, song bucket 0 covers source buckets 0–3.
    const mix = mixWaveformPeaks(
      [
        {
          ...clip(peaks, 0, 1, 1),
          sourceSecondsAt: (songSeconds) => songSeconds * 4,
        },
      ],
      BPS,
    );
    assert.ok(mix);
    approx(mix.max[0], 1);
  });

  it("leaves silent where the clip plays nothing", () => {
    const mix = mixWaveformPeaks(
      [
        {
          ...clip(flatPeaks(1, 2), 0, 2, 1),
          sourceSecondsAt: (songSeconds) => (songSeconds < 1 ? null : 1),
        },
      ],
      BPS,
    );
    assert.ok(mix);
    approx(mix.max[5], 0);
    approx(mix.max[15], 1);
  });
});

describe("mixPeakLevel", () => {
  it("is the loudest swing either way, and 0 for a flat mix", () => {
    const peaks = flatPeaks(0, 1);
    assert.equal(mixPeakLevel(peaks), 0);
    peaks.min[3] = -0.75;
    peaks.max[4] = 0.5;
    assert.equal(mixPeakLevel(peaks), 0.75);
  });
});
