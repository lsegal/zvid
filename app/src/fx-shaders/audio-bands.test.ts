import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meterFftSize } from "./audio-bands.ts";

describe("meterFftSize", () => {
  it("holds about 80 ms of samples, the smallest power of two that does", () => {
    assert.equal(meterFftSize(44_100), 4096);
    assert.equal(meterFftSize(48_000), 4096);
    assert.equal(meterFftSize(96_000), 8192);
  });

  it("stays within the sizes an analyser accepts", () => {
    assert.equal(meterFftSize(100), 32);
    assert.equal(meterFftSize(768_000), 32768);
  });
});
