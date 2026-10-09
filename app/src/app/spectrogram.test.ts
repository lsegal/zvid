import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dbToIntensity,
  formatFrequency,
  frequencyToPosition,
  mergeChannelsDb,
  positionToFrequency,
  SPECTROGRAM_MAX_DB,
  SPECTROGRAM_MAX_HZ,
  SPECTROGRAM_MIN_DB,
  SPECTROGRAM_MIN_HZ,
  SpectrogramClock,
  spectrogramColors,
  spectrumColumn,
} from "./spectrogram.ts";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 4096;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

// A spectrum that's silent but for one loud bin nearest `hz`.
function toneSpectrum(hz: number, db = -30) {
  const bins = new Float32Array(FFT_SIZE / 2).fill(-Infinity);
  bins[Math.round(hz / BIN_HZ)] = db;
  return bins;
}

// The row a tone lights, top first.
function litRow(column: Float32Array) {
  return column.findIndex((value) => value > 0);
}

describe("frequencyToPosition", () => {
  it("maps the range onto 0 to 1 on a log scale", () => {
    assert.equal(frequencyToPosition(SPECTROGRAM_MIN_HZ), 0);
    assert.equal(frequencyToPosition(SPECTROGRAM_MAX_HZ), 1);
    assert.equal(frequencyToPosition(5), 0);
    assert.equal(frequencyToPosition(0), 0);
    assert.equal(frequencyToPosition(40_000), 1);
    // Each decade takes the same height.
    const decade = frequencyToPosition(200) - frequencyToPosition(20);
    assert.ok(
      Math.abs(frequencyToPosition(2000) - frequencyToPosition(200) - decade) <
        1e-9,
    );
  });

  it("is the inverse of positionToFrequency", () => {
    for (const hz of [20, 100, 440, 1000, 8000, 20_000]) {
      assert.ok(Math.abs(positionToFrequency(frequencyToPosition(hz)) - hz) < 1e-6);
    }
  });
});

describe("formatFrequency", () => {
  it("writes kilohertz with a k", () => {
    assert.equal(formatFrequency(100), "100");
    assert.equal(formatFrequency(1000), "1k");
    assert.equal(formatFrequency(10_000), "10k");
  });
});

describe("dbToIntensity", () => {
  it("clamps to the scale and treats silence as 0", () => {
    assert.equal(dbToIntensity(-Infinity), 0);
    assert.equal(dbToIntensity(Number.NaN), 0);
    assert.equal(dbToIntensity(SPECTROGRAM_MIN_DB), 0);
    assert.equal(dbToIntensity(SPECTROGRAM_MAX_DB), 1);
    assert.equal(dbToIntensity(0), 1);
    assert.equal(
      dbToIntensity((SPECTROGRAM_MIN_DB + SPECTROGRAM_MAX_DB) / 2),
      0.5,
    );
  });
});

describe("mergeChannelsDb", () => {
  it("power-averages the channels", () => {
    const out = mergeChannelsDb([-20, -40, -Infinity], [-20, -Infinity, -Infinity], new Float32Array(3));
    assert.ok(Math.abs(out[0] - -20) < 1e-4);
    // Half the power is 3.01 dB down.
    assert.ok(Math.abs(out[1] - (-40 - 10 * Math.log10(2))) < 1e-4);
    assert.equal(out[2], -Infinity);
  });
});

describe("spectrumColumn", () => {
  it("draws a tone higher up the higher it is", () => {
    const rows = 120;
    const rowOf = (hz: number) =>
      litRow(spectrumColumn(toneSpectrum(hz), BIN_HZ, new Float32Array(rows)));
    const low = rowOf(100);
    const mid = rowOf(1000);
    const high = rowOf(10_000);
    assert.ok(low > mid && mid > high, `${low} ${mid} ${high}`);
    // Each row sits where the log scale puts the tone.
    assert.ok(Math.abs(high - (1 - frequencyToPosition(10_000)) * rows) <= 2);
    assert.ok(Math.abs(mid - (1 - frequencyToPosition(1000)) * rows) <= 2);
  });

  it("shows the tone's level and leaves silence empty", () => {
    const column = spectrumColumn(
      toneSpectrum(1000, -60),
      BIN_HZ,
      new Float32Array(120),
    );
    const lit = column.filter((value) => value > 0);
    assert.ok(lit.length > 0);
    assert.ok(Math.abs(Math.max(...lit) - dbToIntensity(-60)) < 1e-6);
    assert.equal(
      spectrumColumn(
        new Float32Array(FFT_SIZE / 2).fill(-Infinity),
        BIN_HZ,
        new Float32Array(120),
      ).every((value) => value === 0),
      true,
    );
  });

  it("interpolates rows narrower than a bin", () => {
    // Low down, a tall picture has many rows per bin: every one gets a value.
    const bins = new Float32Array(FFT_SIZE / 2).fill(-50);
    const column = spectrumColumn(bins, BIN_HZ, new Float32Array(1000));
    assert.ok(column.every((value) => Math.abs(value - dbToIntensity(-50)) < 1e-6));
  });
});

describe("spectrogramColors", () => {
  it("runs from the background to the hottest color, opaque", () => {
    const colors = spectrogramColors(256);
    assert.equal(colors.length, 256 * 4);
    assert.deepEqual([...colors.subarray(0, 4)], [27, 29, 42, 255]);
    assert.deepEqual([...colors.subarray(255 * 4)], [255, 244, 216, 255]);
    for (let index = 0; index < 256; index++) {
      assert.equal(colors[index * 4 + 3], 255);
    }
  });
});

describe("SpectrogramClock", () => {
  it("scrolls at the same speed whatever the frame rate", () => {
    const clock = new SpectrogramClock();
    assert.equal(clock.advance(0, 40), 0);
    let total = 0;
    // 1 second at 144 fps.
    for (let frame = 1; frame <= 144; frame++) {
      total += clock.advance((frame * 1000) / 144, 40);
    }
    assert.ok(Math.abs(total - 40) <= 1, String(total));
  });

  it("starts afresh after a restart", () => {
    const clock = new SpectrogramClock();
    clock.advance(0, 40);
    clock.restart();
    assert.equal(clock.advance(10_000, 40), 0);
    assert.equal(clock.advance(10_100, 40), 4);
  });
});
