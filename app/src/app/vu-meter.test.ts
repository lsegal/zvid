import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amplitudeToDb,
  dbToPosition,
  EMPTY_PEAK_HOLD,
  formatMeterDb,
  holdPeak,
  METER_PEAK_HOLD_MS,
  type MeterAnalyser,
  type MeterBlock,
  MeterTapReader,
  RmsWindow,
  releaseLevel,
  StereoMeter,
  samplePeak,
} from "./vu-meter.ts";

const SAMPLE_RATE = 48_000;

const tone = (amplitude: number, length = 64) =>
  Float32Array.from({ length }, (_, index) =>
    index % 2 ? -amplitude : amplitude,
  );
const silence = new Float32Array(64);
const block = (left: ArrayLike<number>, right: ArrayLike<number>) =>
  ({ sampleRate: SAMPLE_RATE, channels: [left, right] }) satisfies MeterBlock;

const fromDb = (db: number) => 10 ** (db / 20);
const sine = (db: number, hz = 1000) => (frame: number) =>
  fromDb(db) * Math.sin((2 * Math.PI * hz * frame) / SAMPLE_RATE);
const square = (db: number, hz = 1000) => (frame: number) =>
  Math.floor((2 * hz * frame) / SAMPLE_RATE) % 2 ? -fromDb(db) : fromDb(db);

// An analyser on a running audio clock that renders 128-frame quanta, as
// Web Audio does, holding the latest fftSize samples of `signal`.
class FakeAnalyser implements MeterAnalyser {
  readonly fftSize = 4096;
  readonly context = { currentTime: 0, sampleRate: SAMPLE_RATE };
  private readonly signal: (frame: number) => number;

  constructor(signal: (frame: number) => number) {
    this.signal = signal;
  }

  advanceTo(ms: number) {
    const frame = Math.floor((ms * SAMPLE_RATE) / 1000 / 128) * 128;
    this.context.currentTime = frame / SAMPLE_RATE;
  }

  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>) {
    const end = Math.round(this.context.currentTime * SAMPLE_RATE);
    for (let index = 0; index < array.length; index++) {
      const frame = end - array.length + index;
      array[index] = frame < 0 ? 0 : this.signal(frame);
    }
  }
}

// Plays `signal` on both channels for `durationMs`, metering it at `fps`.
function meterSignal(
  signal: (frame: number) => number,
  { fps = 60, durationMs = 1000 } = {},
) {
  const tap = { left: new FakeAnalyser(signal), right: new FakeAnalyser(signal) };
  const reader = new MeterTapReader();
  const meter = new StereoMeter();
  let reading = meter.reading();
  const frames = Math.round((durationMs * fps) / 1000);
  for (let index = 0; index <= frames; index++) {
    const nowMs = (index * durationMs) / frames;
    tap.left.advanceTo(nowMs);
    tap.right.advanceTo(nowMs);
    reading = meter.update(nowMs, reader.read(tap));
  }
  return reading;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("amplitudeToDb", () => {
  it("reads silence as -Infinity and full scale as 0 dB", () => {
    assert.equal(amplitudeToDb(0), -Infinity);
    assert.equal(amplitudeToDb(1), 0);
    assert.ok(Math.abs(amplitudeToDb(0.5) - -6.0206) < 1e-3);
    assert.ok(Math.abs(amplitudeToDb(2) - 6.0206) < 1e-3);
  });
});

describe("dbToPosition", () => {
  it("maps -60 dB to the left edge and +6 dB to the right edge", () => {
    assert.equal(dbToPosition(-Infinity), 0);
    assert.equal(dbToPosition(-80), 0);
    assert.equal(dbToPosition(-60), 0);
    assert.equal(dbToPosition(6), 1);
    assert.equal(dbToPosition(20), 1);
  });

  it("is linear in dB, with 0 dB where the above-0 zone starts", () => {
    assert.equal(dbToPosition(0), 60 / 66);
    assert.equal(dbToPosition(-30), 30 / 66);
    assert.equal(dbToPosition(3), 63 / 66);
  });
});

describe("formatMeterDb", () => {
  it("shows one decimal in dB with a typographic minus", () => {
    assert.equal(formatMeterDb(-14.23), "−14.2 dB");
    assert.equal(formatMeterDb(-14.24), "−14.2 dB");
    assert.equal(formatMeterDb(-60), "-inf dB");
    assert.equal(formatMeterDb(-59.96), "−60.0 dB");
    assert.equal(formatMeterDb(0), "0.0 dB");
    assert.equal(formatMeterDb(-0.04), "0.0 dB");
  });

  it("signs levels above 0 dB", () => {
    assert.equal(formatMeterDb(1.25), "+1.3 dB");
    assert.equal(formatMeterDb(0.04), "0.0 dB");
    assert.equal(formatMeterDb(6), "+6.0 dB");
  });

  it("shows silence, and anything below the scale, as -inf dB", () => {
    assert.equal(formatMeterDb(-Infinity), "-inf dB");
    assert.equal(formatMeterDb(Number.NaN), "-inf dB");
    assert.equal(formatMeterDb(-72.4), "-inf dB");
  });
});

describe("samplePeak", () => {
  it("finds the largest absolute sample", () => {
    assert.equal(samplePeak([0.5, -1, 0, 0.5]), 1);
    assert.equal(samplePeak([]), 0);
  });
});

describe("releaseLevel", () => {
  it("jumps straight up to a louder peak", () => {
    assert.equal(releaseLevel(-40, -6, 16), -6);
    assert.equal(releaseLevel(-Infinity, -6, 0), -6);
  });

  it("falls back about 8.7 dB per 300 ms", () => {
    const level = releaseLevel(-6, -Infinity, 300);
    assert.ok(Math.abs(level - (-6 - 20 / Math.LN10)) < 1e-9);
    assert.equal(releaseLevel(-6, -10, 300), -10);
  });

  it("empties once it falls below the scale", () => {
    assert.equal(releaseLevel(-59, -Infinity, 300), -Infinity);
    assert.equal(releaseLevel(-Infinity, -70, 16), -Infinity);
  });

  it("follows the peak without ballistics under reduced motion", () => {
    assert.equal(releaseLevel(-6, -30, 16, true), -30);
  });
});

describe("holdPeak", () => {
  it("moves up to a higher level at once", () => {
    assert.deepEqual(holdPeak(EMPTY_PEAK_HOLD, -12, 100, 16), {
      db: -12,
      heldAtMs: 100,
    });
    assert.deepEqual(holdPeak({ db: -12, heldAtMs: 100 }, -3, 200, 16), {
      db: -3,
      heldAtMs: 200,
    });
  });

  it("holds for 1.5 s, then falls smoothly but not below the bar", () => {
    const hold = { db: -6, heldAtMs: 0 };
    assert.equal(holdPeak(hold, -40, METER_PEAK_HOLD_MS - 1, 16), hold);
    const falling = holdPeak(hold, -40, METER_PEAK_HOLD_MS, 100);
    assert.equal(falling.db, -9);
    assert.equal(falling.heldAtMs, 0);
    assert.equal(holdPeak(hold, -7, METER_PEAK_HOLD_MS, 100).db, -7);
  });

  it("empties once it falls below the scale", () => {
    const hold = { db: -59, heldAtMs: 0 };
    assert.equal(holdPeak(hold, -Infinity, 2000, 100).db, -Infinity);
  });

  it("drops straight to the bar after the hold under reduced motion", () => {
    const hold = { db: -6, heldAtMs: 0 };
    assert.equal(holdPeak(hold, -30, 2000, 16, true).db, -30);
  });
});

describe("RmsWindow", () => {
  it("averages the power of both channels over the last 300 ms of audio", () => {
    const window = new RmsWindow();
    assert.equal(window.db(), -Infinity);
    // 100 ms of full scale on the left and silence on the right.
    window.push(SAMPLE_RATE, [new Float32Array(4800).fill(1), new Float32Array(4800)]);
    near(window.db(), amplitudeToDb(Math.sqrt(0.5)), 1e-9);
    // Then 200 ms of a quieter level on both.
    window.push(SAMPLE_RATE, [new Float32Array(9600).fill(0.5), new Float32Array(9600).fill(0.5)]);
    near(window.db(), amplitudeToDb(Math.sqrt((0.5 + 2 * 0.25) / 3)), 1e-9);
    // 100 ms more pushes the first 100 ms out of the window.
    window.push(SAMPLE_RATE, [new Float32Array(4800).fill(0.5), new Float32Array(4800).fill(0.5)]);
    near(window.db(), amplitudeToDb(0.5), 1e-9);
    // 300 ms of silence empties it exactly.
    window.push(SAMPLE_RATE, [new Float32Array(14400), new Float32Array(14400)]);
    assert.equal(window.db(), -Infinity);
  });

  it("counts samples, not pushes", () => {
    const once = new RmsWindow();
    const split = new RmsWindow();
    const samples = Float32Array.from({ length: 2000 }, (_, index) => index / 2000);
    once.push(SAMPLE_RATE, [samples, samples]);
    split.push(SAMPLE_RATE, [samples.subarray(0, 500), samples.subarray(0, 500)]);
    split.push(SAMPLE_RATE, [samples.subarray(500), samples.subarray(500)]);
    near(split.db(), once.db(), 1e-9);
  });
});

describe("MeterTapReader", () => {
  it("returns only the samples that arrived since the last read", () => {
    const analyser = new FakeAnalyser((frame) => frame);
    const tap = { left: analyser, right: analyser };
    const reader = new MeterTapReader();
    analyser.context.currentTime = 1000 / SAMPLE_RATE;
    // The first read starts the count.
    assert.equal(reader.read(tap)?.channels[0].length, 0);
    analyser.context.currentTime = 1300 / SAMPLE_RATE;
    const next = reader.read(tap);
    assert.equal(next?.sampleRate, SAMPLE_RATE);
    assert.deepEqual(
      Array.from(next?.channels[0] ?? []),
      Array.from({ length: 300 }, (_, index) => 1000 + index),
    );
    // Nothing new arrived.
    assert.equal(reader.read(tap)?.channels[1].length, 0);
  });

  it("keeps at most the analyser's samples after a long gap", () => {
    const analyser = new FakeAnalyser(() => 0.5);
    const tap = { left: analyser, right: analyser };
    const reader = new MeterTapReader();
    reader.read(tap);
    analyser.context.currentTime = 10;
    assert.equal(reader.read(tap)?.channels[0].length, analyser.fftSize);
  });

  it("reads nothing without a tap, and starts afresh on a new one", () => {
    const reader = new MeterTapReader();
    assert.equal(reader.read(null), null);
    const analyser = new FakeAnalyser(() => 0.5);
    analyser.context.currentTime = 1;
    const tap = { left: analyser, right: analyser };
    assert.equal(reader.read(tap)?.channels[0].length, 0);
  });
});

describe("StereoMeter", () => {
  it("meters each channel and averages both in the readout", () => {
    const meter = new StereoMeter();
    const reading = meter.update(0, block(tone(0.5), tone(0.25)));
    assert.ok(Math.abs(reading.left.levelDb - amplitudeToDb(0.5)) < 1e-6);
    assert.ok(Math.abs(reading.right.levelDb - amplitudeToDb(0.25)) < 1e-6);
    assert.equal(reading.left.peakDb, reading.left.levelDb);
    const meanSquare = (0.25 + 0.0625) / 2;
    assert.ok(
      Math.abs(reading.averageDb - amplitudeToDb(Math.sqrt(meanSquare))) < 1e-6,
    );
    assert.equal(reading.left.clipped, false);
  });

  it("latches a clip above 0 dB until cleared", () => {
    const meter = new StereoMeter();
    meter.update(0, block(tone(1.2), tone(0.5)));
    const after = meter.update(16, block(silence, silence));
    assert.equal(after.left.clipped, true);
    assert.equal(after.right.clipped, false);
    // Exactly full scale isn't above 0 dB.
    meter.update(32, block(tone(1), tone(1)));
    assert.equal(meter.reading().right.clipped, false);

    meter.clearClips();
    assert.equal(meter.reading().left.clipped, false);
    meter.update(48, block(tone(1.5), silence));
    meter.restart();
    assert.equal(meter.reading().left.clipped, false);
  });

  it("decays to idle once the signal stops", () => {
    const meter = new StereoMeter();
    meter.update(0, block(tone(0.5), tone(0.5)));
    assert.equal(meter.isIdle(), false);
    let now = 0;
    while (now < 10_000 && !meter.isIdle()) {
      now += 16;
      meter.update(now, block(silence, silence));
    }
    assert.ok(meter.isIdle());
    // The peak line held for 1.5 s before falling.
    assert.ok(now > METER_PEAK_HOLD_MS);
    const reading = meter.reading();
    assert.equal(reading.left.levelDb, -Infinity);
    assert.equal(reading.right.peakDb, -Infinity);
    assert.equal(reading.averageDb, -Infinity);
  });

  it("reads nothing without samples", () => {
    const meter = new StereoMeter();
    const reading = meter.update(0, null);
    assert.equal(reading.left.levelDb, -Infinity);
    assert.equal(reading.averageDb, -Infinity);
    assert.ok(meter.isIdle());
  });
});

// Reference tones through the reader and meter, as the transport bar reads
// them each animation frame.
describe("meter calibration", () => {
  it("reads a -6 dBFS sine as -6.0 dB on the bars and -9.0 dB RMS", () => {
    const reading = meterSignal(sine(-6));
    near(reading.left.levelDb, -6, 0.2);
    near(reading.right.levelDb, -6, 0.2);
    near(reading.averageDb, -9.01, 0.2);
    assert.equal(formatMeterDb(reading.averageDb), "−9.0 dB");
  });

  it("reads a full-scale sine as 0 dB without clipping, and latches above it", () => {
    const full = meterSignal(sine(0));
    near(full.left.levelDb, 0, 0.2);
    near(full.averageDb, -3.01, 0.2);
    assert.equal(full.left.clipped, false);
    assert.equal(full.right.clipped, false);

    const over = meterSignal(sine(1));
    near(over.left.levelDb, 1, 0.2);
    assert.equal(over.left.clipped, true);
    assert.equal(over.right.clipped, true);
  });

  it("reads a -12 dBFS square wave as -12.0 dB peak and RMS", () => {
    const reading = meterSignal(square(-12));
    near(reading.left.levelDb, -12, 0.2);
    near(reading.averageDb, -12, 0.2);
  });

  it("reads silence as empty bars and -inf dB", () => {
    const reading = meterSignal(() => 0);
    assert.equal(reading.left.levelDb, -Infinity);
    assert.equal(reading.right.peakDb, -Infinity);
    assert.equal(formatMeterDb(reading.averageDb), "-inf dB");
  });

  it("reads the same at any frame rate", () => {
    // A level that changes within the window (three 100 ms pulses), so
    // counting a sample twice would weight it differently at different
    // frame rates.
    const pulsing = (frame: number) =>
      sine(frame % 4800 < 1200 ? -3 : -24)(frame);
    const readings = [30, 60, 120, 144].map((fps) =>
      meterSignal(pulsing, { fps, durationMs: 1000 }),
    );
    const expected = meterSignal(pulsing, { fps: 240, durationMs: 1000 });
    for (const reading of readings) {
      near(reading.averageDb, expected.averageDb, 0.1);
    }
  });
});
