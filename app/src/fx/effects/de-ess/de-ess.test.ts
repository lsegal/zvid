import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioChain, BLOCK_FRAMES } from "../../../audio-mix/chain.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { processor as gain } from "../gain/processor.ts";
import {
  formatAmountDb,
  formatFrequency,
  formatThresholdDb,
  isListening,
  reductionDb,
} from "./de-ess.ts";
import { processor } from "./processor.ts";

// Offline renders through AudioChain, the host the preview's worklet and
// export share, with short synthetic signals.
const RATE = 48_000;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
const registry = createProcessorRegistry([processor, gain]);

const DEFAULTS = { Frequency: 6000, Threshold: -20, Amount: 6 };

function deEss(
  numbers: Partial<typeof DEFAULTS> = {},
  listen = "Off",
  enabled = true,
): AudioStage {
  return {
    id: "de-ess",
    effectName: "De-ess",
    enabled,
    numbers: { ...DEFAULTS, ...numbers },
    switches: { Listen: listen },
  };
}

function sine(frequency: number, amplitude: number, seconds = 1) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return samples;
}

// An RBJ cookbook biquad, run over `samples` in place.
function biquad(
  samples: Float32Array,
  kind: "bandpass" | "highpass",
  frequency: number,
  q: number,
) {
  const w0 = (2 * Math.PI * frequency) / RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const [b0, b1, b2] =
    kind === "bandpass"
      ? [alpha, 0, -alpha]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
  return samples;
}

function rms(samples: Float32Array, from = 0, to = samples.length) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (to - from));
}

const BURST_FROM = Math.round(0.2 * RATE);
const BURST_TO = Math.round(0.8 * RATE);

// Noise narrowed to the band around 7 kHz, at `level` RMS, sounding from
// 0.2 s to 0.8 s of one second. A fixed LCG, so every run is the same.
function sibilance(level: number) {
  let seed = 12345;
  const samples = new Float32Array(RATE);
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = seed / 2 ** 32 - 0.5;
  }
  biquad(samples, "bandpass", 7000, 4);
  biquad(samples, "bandpass", 7000, 4);
  const scale = level / rms(samples, BURST_FROM, BURST_TO);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = i >= BURST_FROM && i < BURST_TO ? samples[i] * scale : 0;
  }
  return samples;
}

function add(...signals: Float32Array[]) {
  return signals.reduce((sum, signal) =>
    Float32Array.from(sum, (sample, i) => sample + signal[i]),
  );
}

// Renders `input` (one array per channel) through a chain of `stages`,
// applying `changes` at their frames, block by block like the hosts.
function render(
  stages: readonly AudioStage[],
  input: readonly Float32Array[],
  changes: { frame: number; stages: readonly AudioStage[] }[] = [],
) {
  const chain = new AudioChain(registry, RATE, input.length);
  chain.configure({ stages, inputGain: 1, delayFrames: 0 }, TEMPO);
  const frames = input[0].length;
  const output = input.map(() => new Float32Array(frames));
  const pending = [...changes];
  for (let start = 0; start < frames; start += BLOCK_FRAMES) {
    while (pending.length && pending[0].frame <= start) {
      const change = pending.shift();
      if (change) {
        chain.configure(
          { stages: change.stages, inputGain: 1, delayFrames: 0 },
          TEMPO,
        );
      }
    }
    const count = Math.min(BLOCK_FRAMES, frames - start);
    chain.process(
      input.map((channel) => channel.subarray(start, start + count)),
      output.map((channel) => channel.subarray(start, start + count)),
      count,
      start / RATE,
    );
  }
  return output;
}

const renderMono = (
  stages: readonly AudioStage[],
  input: Float32Array,
  changes: { frame: number; stages: readonly AudioStage[] }[] = [],
) => render(stages, [input], changes)[0];

// The amplitude of `frequency` over frames from..to, through a Hann window.
function amplitudeAt(
  samples: Float32Array,
  frequency: number,
  from = 0,
  to = samples.length,
) {
  const count = to - from;
  let re = 0;
  let im = 0;
  let weight = 0;
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / count);
    const phase = (2 * Math.PI * frequency * (from + i)) / RATE;
    re += samples[from + i] * window * Math.cos(phase);
    im += samples[from + i] * window * Math.sin(phase);
    weight += window;
  }
  return (2 * Math.hypot(re, im)) / weight;
}

const db = (ratio: number) => 20 * Math.log10(ratio);

// The level above 3 kHz over the burst, past the detector's attack.
function highLevel(samples: Float32Array) {
  const high = biquad(Float32Array.from(samples), "highpass", 3000, 0.7);
  biquad(high, "highpass", 3000, 0.7);
  return rms(high, BURST_FROM + RATE * 0.02, BURST_TO);
}

// The largest sample-to-sample change over frames from..to.
function maxStep(samples: Float32Array, from = 0, to = samples.length - 1) {
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(samples[i + 1] - samples[i]));
  }
  return max;
}

describe("De-ess helpers", () => {
  it("reduces by the excess over Threshold, at most Amount", () => {
    assert.equal(reductionDb(-30, -20, 6), 0);
    assert.equal(reductionDb(-17, -20, 6), 3);
    assert.equal(reductionDb(-2, -20, 6), 6);
    assert.equal(reductionDb(-2, -20, 0), 0);
  });

  it("reads Listen as On case-insensitively", () => {
    assert.equal(isListening("On"), true);
    assert.equal(isListening(" on "), true);
    assert.equal(isListening("Off"), false);
    assert.equal(isListening(""), false);
  });

  it("formats its readouts", () => {
    assert.equal(formatFrequency(6000), "6.00 kHz");
    assert.equal(formatFrequency(12_000), "12.0 kHz");
    assert.equal(formatThresholdDb(-20), "−20.0 dB");
    assert.equal(formatThresholdDb(0), "0.0 dB");
    assert.equal(formatAmountDb(6), "6.0 dB");
  });
});

describe("De-ess stage reduction", () => {
  const tone = sine(300, 0.3);

  it("turns a 7 kHz burst down by Amount and leaves a 300 Hz tone", () => {
    for (const [settings, amount] of [
      [{}, 6],
      [{ Threshold: -60, Amount: 24 }, 24],
      [{ Threshold: -40, Amount: 12 }, 12],
    ] as const) {
      const burst = sibilance(0.2);
      const input = add(tone, burst);
      const output = renderMono([deEss(settings)], input);
      const reduced = db(highLevel(output) / highLevel(input));
      // The crossover's low band still carries a trace of 7 kHz, which
      // the reduction leaves, so the deepest cut falls a little short.
      assert.ok(
        reduced <= -0.9 * amount && reduced >= -amount - 0.5,
        `Amount ${amount}: ${reduced} dB`,
      );
      const toneChange = db(
        amplitudeAt(output, 300, BURST_FROM, BURST_TO) /
          amplitudeAt(input, 300, BURST_FROM, BURST_TO),
      );
      assert.ok(Math.abs(toneChange) <= 0.3, `tone moved ${toneChange} dB`);
    }
  });

  it("reduces less than Amount when the burst is just over Threshold", () => {
    const input = add(tone, sibilance(0.2));
    const output = renderMono([deEss({ Threshold: -12, Amount: 24 })], input);
    const reduced = db(highLevel(output) / highLevel(input));
    assert.ok(reduced < -1 && reduced > -12, `${reduced} dB`);
  });

  it("passes the input bit-identically below Threshold", () => {
    const input = add(tone, sibilance(0.01));
    assert.deepEqual(renderMono([deEss({ Amount: 24 })], input), input);
  });

  it("lets go of the high band once the burst ends", () => {
    const input = add(tone, sibilance(0.2));
    const output = renderMono([deEss({ Amount: 24 })], input);
    // 150 ms after the burst, the 50 ms release has let go.
    const after = BURST_TO + RATE * 0.15;
    assert.deepEqual(output.subarray(after), input.subarray(after));
  });

  it("gives every channel the same reduction, so the stereo image holds", () => {
    const left = add(tone, sibilance(0.2));
    const right = Float32Array.from(left, (sample) => sample * 0.25);
    const [outLeft, outRight] = render([deEss({ Amount: 24 })], [left, right]);
    for (let i = 0; i < outLeft.length; i++) {
      assert.ok(Math.abs(outRight[i] - outLeft[i] * 0.25) < 1e-6);
    }
  });
});

describe("De-ess stage Listen", () => {
  it("outputs only the detection band", () => {
    const input = add(sine(300, 0.3), sine(6000, 0.1));
    const output = renderMono([deEss({}, "On")], input);
    const from = RATE / 2;
    const band = db(
      amplitudeAt(output, 6000, from) / amplitudeAt(input, 6000, from),
    );
    assert.ok(Math.abs(band) < 0.1, `6 kHz moved ${band} dB`);
    const low = db(
      amplitudeAt(output, 300, from) / amplitudeAt(input, 300, from),
    );
    assert.ok(low < -24, `300 Hz moved ${low} dB`);
  });

  it("follows Frequency", () => {
    const input = sine(3000, 0.1);
    const from = RATE / 2;
    const at3k = renderMono([deEss({ Frequency: 3000 }, "On")], input);
    const at12k = renderMono([deEss({ Frequency: 12_000 }, "On")], input);
    assert.ok(
      amplitudeAt(at3k, 3000, from) > 4 * amplitudeAt(at12k, 3000, from),
    );
  });
});

describe("De-ess stage bypass", () => {
  const input = add(sine(300, 0.3), sibilance(0.2));

  it("passes audio bit-identically when bypassed", () => {
    assert.deepEqual(
      renderMono([deEss({ Threshold: -60, Amount: 24 }, "On", false)], input),
      input,
    );
  });

  it("passes audio bit-identically once removed", () => {
    const at = BLOCK_FRAMES * 100;
    const output = renderMono([deEss({ Threshold: -60, Amount: 24 })], input, [
      { frame: at, stages: [] },
    ]);
    assert.deepEqual(output.subarray(at), input.subarray(at));
  });

  it("keeps its place in the chain, before a later Gain", () => {
    const half = {
      id: "gain",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: {},
    };
    const alone = renderMono([deEss({ Amount: 24 })], input);
    const both = renderMono([deEss({ Amount: 24 }), half], input);
    assert.ok(Math.abs(db(rms(both) / rms(alone)) + 6) < 0.05);
  });
});

describe("De-ess stage parameter changes", () => {
  const at = BLOCK_FRAMES * 100;
  // A steady 3 kHz tone well over Threshold: an instant change in its
  // reduction would jump further than the tone moves between frames.
  const input = sine(3000, 0.5, 0.6);

  // A jump from `from` to `to` moves the output by no more per frame than
  // the steady output at either setting does, as a ramp should.
  function assertSmooth(from: AudioStage, to: AudioStage) {
    const output = renderMono([from], input, [{ frame: at, stages: [to] }]);
    const bound =
      Math.max(
        maxStep(renderMono([from], input), RATE / 4),
        maxStep(renderMono([to], input), RATE / 4),
      ) * 1.05;
    const step = maxStep(output, at - 64, at + RATE * 0.1);
    assert.ok(step <= bound, `${step} > ${bound}`);
  }

  it("ramps Amount", () => {
    assertSmooth(
      deEss({ Frequency: 3000, Threshold: -60, Amount: 0 }),
      deEss({ Frequency: 3000, Threshold: -60, Amount: 24 }),
    );
  });

  it("ramps Threshold", () => {
    assertSmooth(
      deEss({ Frequency: 3000, Threshold: 0, Amount: 24 }),
      deEss({ Frequency: 3000, Threshold: -60, Amount: 24 }),
    );
  });

  it("ramps Frequency", () => {
    assertSmooth(
      deEss({ Frequency: 12_000, Threshold: -60, Amount: 24 }),
      deEss({ Frequency: 2000, Threshold: -60, Amount: 24 }),
    );
  });

  it("crossfades a Listen change", () => {
    assertSmooth(
      deEss({ Frequency: 3000, Threshold: -60, Amount: 24 }),
      deEss({ Frequency: 3000, Threshold: -60, Amount: 24 }, "On"),
    );
  });

  it("settles on the new setting", () => {
    const output = renderMono([deEss({ Threshold: -60, Amount: 0 })], input, [
      { frame: at, stages: [deEss({ Threshold: -60, Amount: 24 })] },
    ]);
    const settled = renderMono([deEss({ Threshold: -60, Amount: 24 })], input);
    const from = at + RATE * 0.1;
    assert.ok(
      Math.abs(db(rms(output, from) / rms(settled, from))) < 0.01,
    );
  });
});
