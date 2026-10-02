import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EQ_RANGES,
  EqProcessor,
  type EqSettings,
  eqResponseDb,
  formatEqGain,
  formatFrequency,
  readEqSettings,
} from "./eq.ts";

const RATE = 48_000;

const FLAT: EqSettings = {
  lowFreq: 100,
  lowGain: 0,
  midFreq: 1000,
  midGain: 0,
  midQ: 1,
  highFreq: 8000,
  highGain: 0,
};

function sine(frequency: number, seconds = 1, amplitude = 0.5) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return samples;
}

function noise(seconds = 0.5) {
  // A fixed LCG, so the signal is the same every run.
  let seed = 12345;
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = seed / 2 ** 31 - 1;
  }
  return samples;
}

function impulse(length = 4096) {
  const samples = new Float32Array(length);
  samples[0] = 1;
  return samples;
}

function render(settings: EqSettings, input: Float32Array) {
  const output = input.slice();
  new EqProcessor(settings, RATE).process([output]);
  return output;
}

// RMS level in dB over the second half, past the filters' settling.
function levelDb(samples: Float32Array) {
  let sum = 0;
  const from = Math.floor(samples.length / 2);
  for (let i = from; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return 10 * Math.log10(sum / (samples.length - from));
}

function gainDb(settings: EqSettings, frequency: number) {
  const input = sine(frequency);
  return levelDb(render(settings, input)) - levelDb(input);
}

function maxDifference(a: Float32Array, b: Float32Array) {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("EQ at 0 dB", () => {
  it("passes sine, noise and an impulse through unchanged", () => {
    for (const input of [sine(440), noise(), impulse()]) {
      assert.ok(maxDifference(render(FLAT, input), input) <= 1e-6);
    }
  });

  it("is flat at every band's corner, whatever the frequencies and Q", () => {
    const settings = { ...FLAT, lowFreq: 500, midFreq: 300, midQ: 8 };
    for (const frequency of [20, 300, 500, 8000, 20_000]) {
      near(eqResponseDb(settings, frequency, RATE), 0, 1e-9);
    }
  });
});

describe("EQ low shelf", () => {
  const boosted = { ...FLAT, lowGain: 12 };

  it("raises a 50 Hz sine by about 12 dB", () => {
    near(gainDb(boosted, 50), 12, 1);
  });

  it("leaves 5 kHz within 0.5 dB", () => {
    near(gainDb(boosted, 5000), 0, 0.5);
  });

  it("is half the gain at its corner", () => {
    near(eqResponseDb(boosted, 100, RATE), 6, 0.1);
  });
});

describe("EQ high shelf", () => {
  const boosted = { ...FLAT, highGain: 12 };

  it("raises a sine well above its corner by about 12 dB", () => {
    near(gainDb(boosted, 18_000), 12, 1);
  });

  it("leaves 100 Hz within 0.5 dB", () => {
    near(gainDb(boosted, 100), 0, 0.5);
  });

  it("cuts symmetrically", () => {
    near(gainDb({ ...FLAT, highGain: -12 }, 18_000), -12, 1);
  });
});

describe("EQ mid peak", () => {
  const boosted = { ...FLAT, midGain: 6 };

  it("boosts at its center frequency by its gain", () => {
    near(gainDb(boosted, 1000), 6, 0.1);
  });

  it("is within 0.5 dB at a tenth and ten times the center with Q 1", () => {
    near(gainDb(boosted, 100), 0, 0.5);
    near(gainDb(boosted, 10_000), 0, 0.5);
  });

  it("narrows as Q rises", () => {
    const narrow = { ...boosted, midQ: 8 };
    assert.ok(
      eqResponseDb(narrow, 1500, RATE) < eqResponseDb(boosted, 1500, RATE),
    );
  });
});

describe("EQ processing", () => {
  it("matches its analytic response", () => {
    const settings = { ...FLAT, lowGain: -9, midGain: 4, highGain: 7 };
    for (const frequency of [60, 1000, 12_000]) {
      near(
        gainDb(settings, frequency),
        eqResponseDb(settings, frequency, RATE),
        0.2,
      );
    }
  });

  it("filters every channel the same and keeps their state apart", () => {
    const settings = { ...FLAT, midGain: 9 };
    const left = noise();
    const right = sine(300, 0.5);
    const processor = new EqProcessor(settings, RATE);
    const channels = [left.slice(), right.slice()];
    processor.process(channels);
    assert.deepEqual(channels[0], render(settings, left));
    assert.deepEqual(channels[1], render(settings, right));
  });

  it("gives the same output whatever the block size", () => {
    const settings = { ...FLAT, lowGain: 10, midGain: -6 };
    const input = noise(0.2);
    const whole = render(settings, input);
    const processor = new EqProcessor(settings, RATE);
    const blocks = input.slice();
    for (let start = 0; start < blocks.length; start += 128) {
      processor.process([blocks.subarray(start, start + 128)]);
    }
    assert.deepEqual(blocks, whole);
  });

  it("smooths a parameter jump instead of stepping", () => {
    const input = sine(80, 1);
    const processor = new EqProcessor(FLAT, RATE);
    const output = input.slice();
    const half = RATE / 2;
    processor.process([output.subarray(0, half)]);
    processor.setTarget({ ...FLAT, lowGain: 15 });
    processor.process([output.subarray(half)]);
    // A full-scale 80 Hz sine changes by at most 2πf/rate per sample; the
    // smoothed boost may add a little to that, but never the jump of an
    // instant +15 dB step.
    const sineSlope = (2 * Math.PI * 80 * 0.5) / RATE;
    let maxStep = 0;
    for (let i = half - 64; i < half + 4 * RATE * 0.02; i += 1) {
      maxStep = Math.max(maxStep, Math.abs(output[i + 1] - output[i]));
    }
    assert.ok(maxStep < sineSlope * 10 ** (15 / 20) * 1.5, `${maxStep}`);
    // ...and it does reach the target.
    const target = eqResponseDb({ ...FLAT, lowGain: 15 }, 80, RATE);
    near(levelDb(output.subarray(half)), levelDb(input) + target, 0.2);
  });
});

describe("readEqSettings", () => {
  it("defaults missing values", () => {
    assert.deepEqual(readEqSettings([]), FLAT);
  });

  it("clamps to the parameter ranges", () => {
    const settings = readEqSettings([
      { key: "Low Gain", value: "40" },
      { key: "High Freq", value: "50", numericValue: 50 },
      { key: "Mid Q", value: "nope" },
    ]);
    assert.equal(settings.lowGain, EQ_RANGES["Low Gain"].max);
    assert.equal(settings.highFreq, EQ_RANGES["High Freq"].min);
    assert.equal(settings.midQ, 1);
  });
});

describe("EQ readouts", () => {
  it("formats frequencies", () => {
    assert.equal(formatFrequency(100), "100 Hz");
    assert.equal(formatFrequency(1500), "1.50 kHz");
    assert.equal(formatFrequency(12_000), "12.0 kHz");
  });

  it("formats gains", () => {
    assert.equal(formatEqGain(0), "0.0 dB");
    assert.equal(formatEqGain(3.46), "+3.5 dB");
    assert.equal(formatEqGain(-12), "−12.0 dB");
  });
});
