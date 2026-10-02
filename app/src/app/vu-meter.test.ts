import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amplitudeToDb,
  dbToPosition,
  EMPTY_PEAK_HOLD,
  formatMeterDb,
  holdPeak,
  METER_PEAK_HOLD_MS,
  measureSamples,
  RmsWindow,
  releaseLevel,
  StereoMeter,
} from "./vu-meter.ts";

const tone = (amplitude: number, length = 64) =>
  Float32Array.from({ length }, (_, index) =>
    index % 2 ? -amplitude : amplitude,
  );
const silence = new Float32Array(64);

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
  it("shows one decimal with a typographic minus", () => {
    assert.equal(formatMeterDb(-14.24), "−14.2");
    assert.equal(formatMeterDb(0), "0.0");
    assert.equal(formatMeterDb(1.25), "1.3");
  });

  it("shows silence as minus infinity", () => {
    assert.equal(formatMeterDb(-Infinity), "−∞");
    assert.equal(formatMeterDb(Number.NaN), "−∞");
  });
});

describe("measureSamples", () => {
  it("finds the peak and mean square", () => {
    assert.deepEqual(measureSamples([0.5, -1, 0, 0.5]), {
      peak: 1,
      meanSquare: 1.5 / 4,
    });
    assert.deepEqual(measureSamples([]), { peak: 0, meanSquare: 0 });
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
  it("averages the mean squares of the last 300 ms", () => {
    const window = new RmsWindow();
    assert.equal(window.db(0), -Infinity);
    window.push(0, 1);
    window.push(100, 0.25);
    assert.ok(Math.abs(window.db(100) - amplitudeToDb(Math.sqrt(0.625))) < 1e-9);
    // The first frame leaves the window.
    assert.ok(Math.abs(window.db(300) - amplitudeToDb(0.5)) < 1e-9);
    assert.equal(window.db(400), -Infinity);
  });
});

describe("StereoMeter", () => {
  it("meters each channel and averages both in the readout", () => {
    const meter = new StereoMeter();
    const reading = meter.update(0, [tone(0.5), tone(0.25)]);
    assert.ok(Math.abs(reading.left.levelDb - amplitudeToDb(0.5)) < 1e-6);
    assert.ok(Math.abs(reading.right.levelDb - amplitudeToDb(0.25)) < 1e-6);
    assert.equal(reading.left.peakDb, reading.left.levelDb);
    const meanSquare = (0.25 + 0.0625) / 2;
    assert.ok(
      Math.abs(reading.averageDb - amplitudeToDb(Math.sqrt(meanSquare))) <
        1e-6,
    );
    assert.equal(reading.left.clipped, false);
  });

  it("latches a clip above 0 dB until cleared", () => {
    const meter = new StereoMeter();
    meter.update(0, [tone(1.2), tone(0.5)]);
    const after = meter.update(16, [silence, silence]);
    assert.equal(after.left.clipped, true);
    assert.equal(after.right.clipped, false);
    // Exactly full scale isn't above 0 dB.
    meter.update(32, [tone(1), tone(1)]);
    assert.equal(meter.reading(32).right.clipped, false);

    meter.clearClips();
    assert.equal(meter.reading(32).left.clipped, false);
    meter.update(48, [tone(1.5), silence]);
    meter.restart();
    assert.equal(meter.reading(48).left.clipped, false);
  });

  it("decays to idle once the signal stops", () => {
    const meter = new StereoMeter();
    meter.update(0, [tone(0.5), tone(0.5)]);
    assert.equal(meter.isIdle(0), false);
    let now = 0;
    while (now < 10_000 && !meter.isIdle(now)) {
      now += 16;
      meter.update(now, [silence, silence]);
    }
    assert.ok(meter.isIdle(now));
    // The peak line held for 1.5 s before falling.
    assert.ok(now > METER_PEAK_HOLD_MS);
    const reading = meter.reading(now);
    assert.equal(reading.left.levelDb, -Infinity);
    assert.equal(reading.right.peakDb, -Infinity);
    assert.equal(reading.averageDb, -Infinity);
  });

  it("reads nothing without samples", () => {
    const meter = new StereoMeter();
    const reading = meter.update(0, null);
    assert.equal(reading.left.levelDb, -Infinity);
    assert.equal(reading.averageDb, -Infinity);
    assert.ok(meter.isIdle(0));
  });
});
