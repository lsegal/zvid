// The shader modules reference WebGL and Web Audio types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analogGlitchPass } from "./analog-glitch.ts";
import { OfflineAudioBands } from "./audio-bands.ts";
import { pixelatePass } from "./pixelate.ts";
import {
  type ChainEffect,
  isChainEffectName,
  resolveEffectChain,
} from "./registry.ts";
import type {
  EffectContext,
  EffectParameter,
  EffectPass,
  EffectUniformLocations,
} from "./types.ts";
import { readEffectNumber } from "./types.ts";
import { zoomAndPanPass } from "./zoom-and-pan.ts";

const SAMPLE_RATE = 48000;

const CONTEXT: EffectContext = {
  time: 2.5,
  clipProgress: 0.25,
  resolution: [1080, 1920],
  audioLow: 0.4,
  audioHigh: 0.6,
};

function params(values: Record<string, number>): EffectParameter[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: String(value),
    numericValue: value,
  }));
}

// Runs a pass's setUniforms against a stand-in context and returns the values
// it sent, keyed by uniform name.
function uniformValues(
  pass: EffectPass,
  parameters: EffectParameter[],
  ctx = CONTEXT,
) {
  const values: Record<string, number[]> = {};
  const locations: EffectUniformLocations = {};
  for (const name of pass.uniforms) {
    locations[name] = { name } as unknown as WebGLUniformLocation;
  }
  const record =
    () =>
    (location: WebGLUniformLocation | null, ...args: number[]) => {
      values[(location as unknown as { name: string }).name] = args;
    };
  const gl = {
    uniform1f: record(),
    uniform2f: record(),
    uniform3f: record(),
  } as unknown as WebGLRenderingContext;
  pass.setUniforms(gl, locations, parameters, ctx);
  return values;
}

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
        effect("6", "EdgeTrailPulse"),
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
    assert.equal(isChainEffectName("Zoom And Pan"), true);
    assert.equal(isChainEffectName("Pixelate"), true);
    assert.equal(isChainEffectName("AnalogGlitch"), true);
    assert.equal(isChainEffectName("Layout"), false);
    assert.equal(isChainEffectName("EdgeTrailPulse"), false);
  });
});

describe("effect passes", () => {
  it("sets every uniform each pass declares", () => {
    for (const pass of [pixelatePass, analogGlitchPass, zoomAndPanPass]) {
      assert.deepEqual(
        Object.keys(uniformValues(pass, [])).sort(),
        [...pass.uniforms].sort(),
        pass.effectName,
      );
    }
  });

  it("feeds Pixelate its amount, intensities, surface size and audio", () => {
    const values = uniformValues(
      pixelatePass,
      params({ _NumPixels: 0.83, _LowIntensity: 1, _HighIntensity: 1.5 }),
    );

    assert.deepEqual(values.uRes, [1080, 1920]);
    assert.ok(Math.abs(values.uNum[0] - 0.83) < 1e-9);
    assert.deepEqual(values.uLow, [1]);
    assert.deepEqual(values.uHigh, [1]);
    assert.deepEqual(values.uAudioLow, [0.4]);
    assert.deepEqual(values.uAudioHigh, [0.6]);
  });

  it("seeds Analog Glitch from the playhead time only", () => {
    const parameters = params({ _LowMod: 0.2, _HighMod: 0.2 });
    const first = uniformValues(analogGlitchPass, parameters);
    const again = uniformValues(analogGlitchPass, parameters);

    assert.deepEqual(first, again);
    assert.deepEqual(first.uTime, [2.5]);
    assert.doesNotMatch(analogGlitchPass.fragmentSource, /random/i);
  });

  it("clamps Zoom & Pan framings and the clip progress to 0..1", () => {
    const values = uniformValues(
      zoomAndPanPass,
      params({
        _Start_Zoom: 0,
        _Start_X: 0.25,
        _Start_Y: 0.25,
        _End_Zoom: 1.4,
        _End_X: -0.5,
        _End_Y: 0.75,
      }),
      { ...CONTEXT, clipProgress: 1.2 },
    );

    assert.deepEqual(values.uStart, [0, 0.25, 0.25]);
    assert.deepEqual(values.uEnd, [1, 0, 0.75]);
    assert.deepEqual(values.uProgress, [1]);
  });

  it("centers a Zoom & Pan framing with missing parameters", () => {
    const values = uniformValues(zoomAndPanPass, []);
    assert.deepEqual(values.uStart, [0, 0.5, 0.5]);
    assert.deepEqual(values.uEnd, [0, 0.5, 0.5]);
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
