// The shader modules reference WebGL and Web Audio types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OfflineAudioBands } from "./audio-bands.ts";
import {
  type ChainEffect,
  isChainEffectName,
  resolveEffectChain,
} from "./registry.ts";
import { readEffectNumber } from "./types.ts";

const SAMPLE_RATE = 48000;

function effect(
  trackId: string,
  effectName: string,
  enabled?: boolean,
): ChainEffect {
  return { trackId, effectName, enabled, parameters: [] };
}

// A 60 Hz kick burst every half second, silent in between.
function kickTrack(seconds: number) {
  const samples = new Float32Array(seconds * SAMPLE_RATE);
  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    const sinceKick = time % 0.5;
    samples[index] =
      sinceKick < 0.12
        ? 0.9 * Math.sin(2 * Math.PI * 60 * time) * Math.exp(-20 * sinceKick)
        : 0;
  }
  return samples;
}

// Deterministic white noise, first-differenced to tilt its energy toward
// the treble like a hi-hat.
function hissTrack(seconds: number) {
  const samples = new Float32Array(seconds * SAMPLE_RATE);
  let seed = 1;
  let previous = 0;
  for (let index = 0; index < samples.length; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = seed / 1073741824 - 1;
    samples[index] = 0.5 * (noise - previous);
    previous = noise;
  }
  return samples;
}

describe("resolveEffectChain", () => {
  it("keeps one track's shader effects in stack order", () => {
    const chain = resolveEffectChain(
      [
        effect("6", "NegativeSplit"),
        effect("1", "Colorize"),
        effect("6", "Colorize"),
      ],
      "6",
    );

    assert.deepEqual(
      chain.map((step) => step.pass.effectName),
      ["NegativeSplit", "Colorize"],
    );
  });

  it("drops bypassed and unknown effects but treats a missing flag as enabled", () => {
    const chain = resolveEffectChain(
      [
        effect("6", "Colorize", false),
        effect("6", "AnalogGlitch"),
        effect("6", "Negative Split"),
      ],
      "6",
    );

    assert.deepEqual(
      chain.map((step) => step.pass.effectName),
      ["NegativeSplit"],
    );
  });

  it("recognizes only effects that have a shader", () => {
    assert.equal(isChainEffectName("colorize"), true);
    assert.equal(isChainEffectName("Layout"), false);
    assert.equal(isChainEffectName("ZoomAndPan"), false);
  });
});

describe("readEffectNumber", () => {
  it("reads numeric values by raw .lvp key", () => {
    const params = [
      { key: "_HueOffset", value: "0.250", numericValue: 0.25 },
      { key: "_Reactivity", value: "0.5" },
    ];

    assert.equal(readEffectNumber(params, "_HueOffset", 0), 0.25);
    assert.equal(readEffectNumber(params, "_Reactivity", 0), 0.5);
    assert.equal(readEffectNumber(params, "_Missing", 0.7), 0.7);
  });
});

describe("OfflineAudioBands", () => {
  it("stays silent without audio", () => {
    const bands = new OfflineAudioBands(
      new Float32Array(SAMPLE_RATE),
      SAMPLE_RATE,
    );
    assert.deepEqual(bands.at(0.5), { low: 0, high: 0 });
  });

  it("pulses the low band on each kick and releases between them", () => {
    const bands = new OfflineAudioBands(kickTrack(3), SAMPLE_RATE);
    const onKick = bands.at(1.08);
    const beforeNextKick = bands.at(1.45);

    assert.ok(onKick.low > 0.5, `low band on kick was ${onKick.low}`);
    assert.ok(onKick.high < 0.1, `high band on kick was ${onKick.high}`);
    assert.ok(beforeNextKick.low < onKick.low / 2);
    assert.ok(beforeNextKick.low > 0, "release should be gradual");
  });

  it("puts treble energy in the high band", () => {
    const bands = new OfflineAudioBands(hissTrack(1), SAMPLE_RATE);
    const level = bands.at(0.5);

    assert.ok(level.high > 0.5, `high band was ${level.high}`);
    assert.ok(
      level.low < level.high - 0.2,
      `low band ${level.low} should trail high band ${level.high}`,
    );
  });

  it("gives the same envelope after a seek as when rendered in sequence", () => {
    const samples = kickTrack(4);
    const sequential = new OfflineAudioBands(samples, SAMPLE_RATE);
    for (let time = 0; time <= 2.1; time += 1 / 30) {
      sequential.at(time);
    }
    const seeked = new OfflineAudioBands(samples, SAMPLE_RATE);
    seeked.at(2.1);

    assert.ok(Math.abs(sequential.at(2.1).low - seeked.at(2.1).low) < 0.01);
  });
});
