import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DRUM_BANKS } from "../src/fx/effects/drum-rack/banks.ts";
import {
  CREDITS_PATH,
  PEAK,
  renderAll,
  SAMPLE_RATE,
  VOICES,
} from "./gen-drum-banks.mjs";

// A 16-bit mono `.wav` file's samples, after checking its header.
function readWav(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  assert.equal(buffer.readUInt16LE(20), 1);
  assert.equal(buffer.readUInt16LE(22), 1);
  assert.equal(buffer.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(buffer.readUInt16LE(34), 16);
  const length = buffer.readUInt32LE(40) / 2;
  assert.equal(buffer.length, 44 + length * 2);
  return Array.from(
    { length },
    (_, index) => buffer.readInt16LE(44 + index * 2) / 32767,
  );
}

describe("bundled drum banks", () => {
  const files = renderAll();

  it("give every pad of every bank a voice", () => {
    for (const bank of DRUM_BANKS) {
      assert.deepEqual(
        Object.keys(VOICES[bank.id]).sort(),
        bank.pads.map((pad) => pad.name).sort(),
      );
    }
    assert.equal(files.length, DRUM_BANKS.length * 16 + 1);
  });

  it("render each sound as a short, normalized one-shot", () => {
    for (const [file, contents] of files) {
      if (file === CREDITS_PATH) continue;
      const samples = readWav(contents);
      const seconds = samples.length / SAMPLE_RATE;
      assert.ok(seconds > 0.02 && seconds <= 3, `${file}: ${seconds} s`);
      const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
      assert.ok(Math.abs(peak - PEAK) < 0.001, `${file}: peak ${peak}`);
      // It fades out to silence rather than stopping short.
      assert.ok(Math.abs(samples.at(-1)) < 0.01, `${file} ends abruptly`);
    }
  });

  it("credit every bank as generated, under zvid's own license", () => {
    const credits = files.find(([file]) => file === CREDITS_PATH)[1].toString();
    for (const bank of DRUM_BANKS) {
      assert.match(
        credits,
        new RegExp(`\`${bank.id}\` \\| Synthesized by zvid`),
      );
    }
  });

  it("match the committed files", () => {
    for (const [file, contents] of files) {
      assert.ok(
        readFileSync(file).equals(contents),
        `${file} is stale; run node app/scripts/gen-drum-banks.mjs`,
      );
    }
  });
});
