import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGainDb,
  gainChainAmplitude,
  gainToAmplitude,
  masterGainAmplitude,
} from "./gain.ts";

function gain(db: number, options: { mute?: boolean; enabled?: boolean } = {}) {
  return {
    effectName: "Gain",
    enabled: options.enabled ?? true,
    parameters: [
      { key: "Gain", value: `${db}`, numericValue: db },
      ...(options.mute ? [{ key: "Mute", value: "1", numericValue: 1 }] : []),
    ],
  };
}

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe("gainToAmplitude", () => {
  it("is exactly silent at the bottom of the range", () => {
    assert.equal(gainToAmplitude(-68), 0);
    assert.equal(gainToAmplitude(-80), 0);
  });

  it("is silent when muted, whatever the level", () => {
    assert.equal(gainToAmplitude(0, true), 0);
    assert.equal(gainToAmplitude(10, true), 0);
  });

  it("is unity at 0 dB", () => {
    assert.equal(gainToAmplitude(0), 1);
  });

  it("follows 10^(dB/20)", () => {
    close(gainToAmplitude(10), 3.1622776601683795);
    close(gainToAmplitude(-6), 0.5011872336272722);
    close(gainToAmplitude(-67.9), 10 ** (-67.9 / 20));
  });
});

describe("gainChainAmplitude", () => {
  it("is silent without a Gain", () => {
    assert.equal(gainChainAmplitude([]), 0);
    assert.equal(
      gainChainAmplitude([
        { effectName: "Pixelate", enabled: true, parameters: [] },
      ]),
      0,
    );
  });

  it("multiplies stacked Gains, so their dB add", () => {
    close(gainChainAmplitude([gain(-6), gain(-6)]), gainToAmplitude(-12));
    close(gainChainAmplitude([gain(10), gain(-10)]), 1);
  });

  it("skips bypassed Gains", () => {
    close(
      gainChainAmplitude([gain(-6), gain(-20, { enabled: false })]),
      0.5011872336272722,
    );
    assert.equal(gainChainAmplitude([gain(0, { enabled: false })]), 0);
  });

  it("is silent when any Gain in the chain mutes", () => {
    assert.equal(gainChainAmplitude([gain(6), gain(0, { mute: true })]), 0);
    assert.equal(gainChainAmplitude([gain(6), gain(-68)]), 0);
  });

  it("reads a Gain without stored values as 0 dB, unmuted", () => {
    assert.equal(
      gainChainAmplitude([{ effectName: "Gain", parameters: [] }]),
      1,
    );
  });
});

describe("masterGainAmplitude", () => {
  it("passes at unity without a Gain", () => {
    assert.equal(masterGainAmplitude([]), 1);
    assert.equal(masterGainAmplitude([gain(-20, { enabled: false })]), 1);
  });

  it("applies the Global Gains", () => {
    close(masterGainAmplitude([gain(-6)]), 0.5011872336272722);
  });
});

describe("formatGainDb", () => {
  it("reads Mute at the bottom of the range", () => {
    assert.equal(formatGainDb(-68), "Mute");
  });

  it("reads the level to a tenth of a dB with its sign", () => {
    assert.equal(formatGainDb(0), "0.0 dB");
    assert.equal(formatGainDb(-6), "−6.0 dB");
    assert.equal(formatGainDb(3.46), "+3.5 dB");
  });
});
