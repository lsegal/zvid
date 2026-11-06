import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGranularEffect } from "../fx/effects/granular/granular.ts";
import { DEFAULT_GRANULAR_PARAMS, type MidiNote } from "../midi-clip.ts";
import {
  GRANULAR_VOICE_LEVEL,
  granularGrains,
  granularLoop,
  granularSource,
  mixGrains,
  mixGrainsOffThread,
  seededRandom,
} from "./granular.ts";

const SAMPLE_RATE = 48_000;
// At 60 bpm a quarter note lasts a second.
const BPM = 60;
const NOTE: MidiNote = { pitch: 60, start: 1, length: 2, velocity: 127 };

describe("granularGrains", () => {
  const params = { ...DEFAULT_GRANULAR_PARAMS, attack: 0.001, spray: 0 };

  it("spreads a note's grains over it at the density", () => {
    const grains = granularGrains([NOTE], params, BPM);
    const held = grains.filter((grain) => grain.startSeconds < 3);
    // 30 grains a second over the note's 2 seconds.
    assert.equal(held.length, 60);
    assert.equal(held[0].startSeconds, 1);
    assert.ok(Math.abs(held[1].startSeconds - (1 + 1 / 30)) < 1e-9);
    // Without spray they all read from the Position, at the note's pitch.
    for (const grain of held) {
      assert.equal(grain.offset, params.position);
      assert.equal(grain.rate, 1);
      assert.equal(grain.durationSeconds, params.grainSize);
    }
  });

  it("plays the note's pitch, velocity and length", () => {
    const [up] = granularGrains([{ ...NOTE, pitch: 72 }], params, BPM);
    assert.equal(up.rate, 2);
    const [transposed] = granularGrains(
      [NOTE],
      { ...params, transpose: -12 },
      BPM,
    );
    assert.equal(transposed.rate, 0.5);
    const [loud] = granularGrains([NOTE], params, BPM);
    const [quiet] = granularGrains([{ ...NOTE, velocity: 32 }], params, BPM);
    assert.ok(Math.abs(quiet.level - (loud.level * 32) / 127) < 1e-9);
    assert.ok(loud.level <= GRANULAR_VOICE_LEVEL);
    // A note twice as long plays a cloud about twice as long.
    const short = granularGrains([{ ...NOTE, length: 1 }], params, BPM);
    const long = granularGrains([NOTE], params, BPM);
    assert.ok(Math.abs(long.length - short.length - 30) <= 1);
  });

  it("fades the cloud in over the attack and out over the release", () => {
    const grains = granularGrains(
      [NOTE],
      { ...params, attack: 0.5, release: 0.5 },
      BPM,
    );
    const levels = grains.map((grain) => grain.level);
    const peak = Math.max(...levels);
    assert.ok(levels[0] < peak / 4);
    // The release's grains get quieter until the cloud ends.
    const released = grains.filter((grain) => grain.startSeconds >= 3);
    assert.ok(released.length > 10);
    for (let index = 1; index < released.length; index++) {
      assert.ok(released[index].level < released[index - 1].level);
    }
    assert.ok(grains[grains.length - 1].startSeconds < 3.5);
  });

  it("strays from the Position and the beat with spray, the same way every time", () => {
    const sprayed = { ...params, spray: 1 };
    const grains = granularGrains([NOTE], sprayed, BPM);
    assert.deepEqual(granularGrains([NOTE], sprayed, BPM), grains);
    const offsets = new Set(grains.map((grain) => grain.offset));
    assert.ok(offsets.size > grains.length / 2);
    for (const grain of grains) {
      assert.ok(grain.offset >= 0 && grain.offset < 1);
      assert.ok(grain.startSeconds >= NOTE.start);
    }
  });

  it("leaves out grains starting after the clip's audio ends", () => {
    const grains = granularGrains([NOTE], params, BPM, 2);
    assert.ok(grains.length > 0);
    assert.ok(grains.every((grain) => grain.startSeconds < 2));
    assert.deepEqual(granularGrains([NOTE], params, BPM, 1), []);
  });
});

describe("granularSource", () => {
  it("is the same every time, a peak-normalized tone", () => {
    const source = granularSource(SAMPLE_RATE);
    assert.equal(granularSource(SAMPLE_RATE), source);
    const peak = source.reduce(
      (loudest, s) => Math.max(loudest, Math.abs(s)),
      0,
    );
    assert.ok(Math.abs(peak - 1) < 1e-6);
    assert.equal(source.length, 2 * SAMPLE_RATE);
  });
});

describe("mixGrains", () => {
  it("mixes Hann-windowed grains read from the source", () => {
    const source = new Float32Array(100).fill(1);
    const grain = {
      startSeconds: 0.01,
      durationSeconds: 0.01,
      offset: 0,
      rate: 1,
      level: 0.5,
    };
    const out = mixGrains([grain, grain], 1000, 40, source);
    assert.equal(out[9], 0);
    // Silent at each end of its window, full in the middle.
    assert.equal(out[10], 0);
    assert.ok(Math.abs(out[14] + out[15] - 2) < 0.1);
    assert.ok(out[19] < 1e-6);
    assert.equal(out[20], 0);
  });

  it("reads back the other way past the source's end", () => {
    const source = Float32Array.from([0, 1, 2, 3, 4]);
    const grain = {
      startSeconds: 0,
      durationSeconds: 1,
      offset: 0.5,
      rate: 1,
      level: 1,
    };
    const window = (step: number) =>
      0.5 - 0.5 * Math.cos((2 * Math.PI * step) / 9);
    const out = mixGrains([grain], 10, 10, source);
    const reads = [2, 3, 4, 3, 2, 1, 0, 1, 2, 3];
    for (const [step, read] of reads.entries()) {
      assert.ok(Math.abs(out[step] - read * window(step)) < 1e-6);
    }
  });

  it("reads to and fro between the source's ends at any rate", () => {
    const source = Float32Array.from({ length: 7 }, (_, at) => at * at);
    const grain = {
      startSeconds: 0.002,
      durationSeconds: 0.05,
      offset: 0.7,
      rate: 2.3,
      level: 0.8,
    };
    const out = mixGrains([grain], 1000, 60, source);
    const last = source.length - 1;
    const count = 50;
    for (let index = 0; index < out.length; index++) {
      const step = index - 2;
      let expected = 0;
      if (step >= 0 && step < count) {
        const folded = (grain.offset * last + step * grain.rate) % (2 * last);
        const read = folded > last ? 2 * last - folded : folded;
        const whole = Math.min(last - 1, Math.floor(read));
        const sample =
          source[whole] + (source[whole + 1] - source[whole]) * (read - whole);
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * step) / (count - 1));
        expected = grain.level * window * sample;
      }
      assert.ok(Math.abs(out[index] - expected) < 1e-5, `sample ${index}`);
    }
  });
});

describe("mixGrainsOffThread", () => {
  it("mixes as mixGrains does where no worker can start", async () => {
    const grains = granularGrains(
      [NOTE],
      { ...DEFAULT_GRANULAR_PARAMS, grainSize: 0.5, density: 100 },
      BPM,
      1,
    );
    assert.deepEqual(
      await mixGrainsOffThread(grains, 8000, 8000),
      mixGrains(grains, 8000, 8000),
    );
  });
});

describe("readGranularEffect", () => {
  it("reads missing or invalid settings as their defaults and holds the rest to their ranges", () => {
    assert.deepEqual(readGranularEffect([]), DEFAULT_GRANULAR_PARAMS);
    assert.deepEqual(
      readGranularEffect([
        { key: "Density", value: "", numericValue: 1000 },
        { key: "Transpose", value: "7.4" },
        { key: "Position", value: "nope" },
      ]),
      { ...DEFAULT_GRANULAR_PARAMS, density: 100, transpose: 7 },
    );
  });
});

describe("seededRandom", () => {
  it("repeats for a seed", () => {
    const first = seededRandom(7);
    const again = seededRandom(7);
    for (let index = 0; index < 10; index++) {
      const value = first();
      assert.equal(again(), value);
      assert.ok(value >= 0 && value < 1);
    }
  });
});

describe("granularGrains, with expression", () => {
  const plain: MidiNote = { pitch: 60, start: 0, length: 1, velocity: 127 };
  const params = { ...DEFAULT_GRANULAR_PARAMS, spray: 0, release: 0.01 };
  const grains = (note: MidiNote) => granularGrains([note], params, 60);

  it("bends each grain's rate at its moment", () => {
    const bent = grains({
      ...plain,
      expression: {
        bend: [
          { at: 0, value: 0 },
          { at: 1, value: 12 },
        ],
      },
    });
    assert.ok(bent[0].rate < 1.1);
    assert.ok((bent.at(-1)?.rate ?? 0) > 1.8);
  });

  it("scales each grain's level by pressure", () => {
    const pressed = grains({
      ...plain,
      expression: { pressure: [{ at: 0, value: 0 }] },
    });
    const full = grains(plain);
    assert.ok(pressed[5].level < full[5].level);
    assert.equal(
      grains({ ...plain, expression: { pressure: [{ at: 0, value: 1 }] } })[5]
        .level,
      full[5].level,
    );
  });

  it("reads further along the source for more timbre", () => {
    const bright = grains({
      ...plain,
      expression: { timbre: [{ at: 0, value: 1 }] },
    });
    assert.ok(bright[0].offset > grains(plain)[0].offset);
  });

  it("leaves a note without expression exactly as it was", () => {
    assert.deepEqual(grains({ ...plain, expression: {} }), grains(plain));
  });
});

describe("granularLoop", () => {
  const SAMPLE_RATE = 8000;
  const params = { ...DEFAULT_GRANULAR_PARAMS, grainSize: 0.2, density: 15 };

  it("lasts a whole number of grain starts", () => {
    const seconds = (density: number) =>
      granularLoop(NOTE, { ...params, density }, SAMPLE_RATE).length /
      SAMPLE_RATE;
    assert.equal(seconds(30), 1);
    assert.ok(Math.abs(seconds(1.5) - 4 / 3) < 0.001);
  });

  it("carries the grains still sounding at its end around to its start", () => {
    const loop = granularLoop(NOTE, params, SAMPLE_RATE);
    const steps = Array.from(loop, (sample, index) =>
      Math.abs(sample - loop[index === 0 ? loop.length - 1 : index - 1]),
    );
    const [seam, ...rest] = steps;
    assert.ok(seam <= Math.max(...rest));
    // Grains overlap from its first sample, as they do everywhere else.
    assert.ok(Math.abs(loop[1]) > 0 && steps[1] > 0);
  });

  it("holds its level from start to end, the same every time", () => {
    const loop = granularLoop(NOTE, params, SAMPLE_RATE);
    const peak = (from: number, to: number) =>
      loop.subarray(from, to).reduce((p, v) => Math.max(p, Math.abs(v)), 0);
    const half = loop.length >> 1;
    const ratio = peak(0, half) / peak(half, loop.length);
    assert.ok(ratio > 0.5 && ratio < 2, `${ratio}`);
    assert.deepEqual(granularLoop(NOTE, params, SAMPLE_RATE), loop);
  });
});
