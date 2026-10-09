import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waveformIntensity, waveformPixels } from "./waveform.ts";

describe("waveformPixels", () => {
  it("lights each channel at its level, white where they overlap", () => {
    // One column: half its pixels white, half pure red.
    const pixels = new Uint8Array([255, 255, 255, 255, 255, 0, 0, 255]);
    const image = waveformPixels({ width: 1, height: 2, pixels }, 4);
    const row = (index: number) => [...image.slice(index * 4, index * 4 + 4)];
    const full = Math.round(255 * waveformIntensity(1));
    const half = Math.round(255 * waveformIntensity(0.5));
    // Level 255 is the top row: red from both pixels, green and blue from
    // the white one. Level 0 is the bottom row: green and blue from the red.
    assert.deepEqual(row(0), [full, half, half, 255]);
    assert.deepEqual(row(1), [0, 0, 0, 255]);
    assert.deepEqual(row(2), [0, 0, 0, 255]);
    assert.deepEqual(row(3), [0, half, half, 255]);
  });
});

describe("waveformIntensity", () => {
  it("is full for a whole column at one level and shows sparse levels", () => {
    assert.equal(waveformIntensity(1), 1);
    assert.ok(waveformIntensity(1 / 256) > 0.3);
    assert.equal(waveformIntensity(0), 0);
  });
});
