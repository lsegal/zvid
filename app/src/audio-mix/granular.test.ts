import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGranularEffect } from "../fx/effects/granular/granular.ts";
import { DEFAULT_GRANULAR_PARAMS, type MidiNote } from "../midi-clip.ts";
import {
  GRANULAR_VOICE_LEVEL,
  granularGrains,
  granularSource,
  mixGrains,
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
    const peak = source.reduce((loudest, s) => Math.max(loudest, Math.abs(s)), 0);
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
    const window = (step: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * step) / 9);
    const out = mixGrains([grain], 10, 10, source);
    const reads = [2, 3, 4, 3, 2, 1, 0, 1, 2, 3];
    for (const [step, read] of reads.entries()) {
      assert.ok(Math.abs(out[step] - read * window(step)) < 1e-6);
    }
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
