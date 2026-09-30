// The shader modules reference WebGL and Web Audio types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analogGlitchPass } from "./analog-glitch.ts";
import {
  type AudioBands,
  AudioBandTracker,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./audio-bands.ts";
import { colorizePass } from "./colorize.ts";
import { negativeSplitPass } from "./negative-split.ts";
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
  impulseLow: 0.7,
  impulseHigh: 0.9,
  bottomUp: false,
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

// A decaying broadband click every half second, silent in between.
function clickTrack(seconds: number) {
  const samples = new Float32Array(seconds * SAMPLE_RATE);
  let seed = 7;
  for (let index = 0; index < samples.length; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const sinceClick = (index / SAMPLE_RATE) % 0.5;
    samples[index] =
      sinceClick < 0.03
        ? 0.8 * (seed / 1073741824 - 1) * Math.exp(-sinceClick / 0.005)
        : 0;
  }
  return samples;
}

// A steady bass and treble chord with no transients.
function toneTrack(seconds: number) {
  const samples = new Float32Array(seconds * SAMPLE_RATE);
  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    samples[index] =
      0.4 * Math.sin(2 * Math.PI * 60 * time) +
      0.2 * Math.sin(2 * Math.PI * 4000 * time);
  }
  return samples;
}

// Reads a signal's bands at `fps` from `from` up to `to` seconds.
function readBands(
  samples: Float32Array,
  fps: number,
  from: number,
  to: number,
) {
  const bands = new OfflineAudioBands(samples, SAMPLE_RATE);
  const frames: Array<{ time: number } & AudioBands> = [];
  for (let frame = Math.ceil(from * fps); frame <= to * fps; frame++) {
    frames.push({ time: frame / fps, ...bands.at(frame / fps) });
  }
  return frames;
}

// Frames where an impulse jumped up, i.e. detected hits.
function hitTimes(
  frames: Array<{ time: number } & AudioBands>,
  band: "impulseLow" | "impulseHigh",
) {
  return frames
    .filter(
      (frame, index) => index > 0 && frame[band] > frames[index - 1][band],
    )
    .map((frame) => frame.time);
}

function maxImpulse(frames: AudioBands[]) {
  return Math.max(
    ...frames.map((frame) => Math.max(frame.impulseLow, frame.impulseHigh)),
  );
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
    for (const pass of [
      colorizePass,
      negativeSplitPass,
      pixelatePass,
      analogGlitchPass,
      zoomAndPanPass,
    ]) {
      assert.deepEqual(
        Object.keys(uniformValues(pass, [])).sort(),
        [...pass.uniforms].sort(),
        pass.effectName,
      );
    }
  });

  it("feeds Pixelate its amount, intensities, surface size and impulses", () => {
    const values = uniformValues(
      pixelatePass,
      params({ _NumPixels: 0.83, _LowIntensity: 1, _HighIntensity: 1.5 }),
    );

    assert.deepEqual(values.uRes, [1080, 1920]);
    assert.ok(Math.abs(values.uNum[0] - 0.83) < 1e-9);
    assert.deepEqual(values.uLow, [1]);
    assert.deepEqual(values.uHigh, [1]);
    assert.deepEqual(values.uImpulseLow, [0.7]);
    assert.deepEqual(values.uImpulseHigh, [0.9]);
  });

  it("drives every audio-reactive pass from impulses, not band levels", () => {
    for (const pass of [
      colorizePass,
      negativeSplitPass,
      pixelatePass,
      analogGlitchPass,
    ]) {
      const values = uniformValues(pass, []);
      assert.deepEqual(values.uImpulseLow, [0.7], pass.effectName);
      assert.deepEqual(values.uImpulseHigh, [0.9], pass.effectName);
      assert.doesNotMatch(pass.fragmentSource, /uAudio/, pass.effectName);
    }
  });

  it("scales the Colorize hue swing by impulse times reactivity", () => {
    assert.match(
      colorizePass.fragmentSource,
      /uReactivity \* \(uImpulseLow \* 0\.5 \+ uImpulseHigh \* 0\.5\)/,
    );
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

  it("flips Zoom & Pan Y on a bottom-up texture", () => {
    const parameters = params({ _Start_Y: 0, _End_Y: 0.25 });
    const topDown = uniformValues(zoomAndPanPass, parameters);
    const bottomUp = uniformValues(zoomAndPanPass, parameters, {
      ...CONTEXT,
      bottomUp: true,
    });

    assert.deepEqual(topDown.uStart, [0, 0.5, 0]);
    assert.deepEqual(topDown.uEnd, [0, 0.5, 0.25]);
    assert.deepEqual(bottomUp.uStart, [0, 0.5, 1]);
    assert.deepEqual(bottomUp.uEnd, [0, 0.5, 0.75]);
  });

  it("reverses the Analog Glitch roll on a bottom-up texture", () => {
    const parameters = params({ _LowMod: 0.2 });
    assert.deepEqual(uniformValues(analogGlitchPass, parameters).uDown, [1]);
    assert.deepEqual(
      uniformValues(analogGlitchPass, parameters, {
        ...CONTEXT,
        bottomUp: true,
      }).uDown,
      [-1],
    );
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
    assert.deepEqual(bands.at(0.5), SILENT_AUDIO_BANDS);
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

describe("audio onsets", () => {
  it("remembers each click for a second, at its time and strength", () => {
    const bands = new OfflineAudioBands(clickTrack(3), SAMPLE_RATE);
    const onsets = bands.at(2.2).onsets ?? [];

    assert.equal(onsets.length, 2, JSON.stringify(onsets));
    [0.7, 0.2].forEach((secondsAgo, index) => {
      assert.ok(Math.abs(onsets[index].secondsAgo - secondsAgo) < 0.03);
      assert.ok(onsets[index].strength > 0.8);
    });
  });

  it("remembers nothing in silence", () => {
    const bands = new OfflineAudioBands(
      new Float32Array(2 * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    assert.deepEqual(bands.at(1.5).onsets, []);
  });

  it("remembers the same hits after a seek as when rendered in sequence", () => {
    const samples = clickTrack(4);
    const sequential = new OfflineAudioBands(samples, SAMPLE_RATE);
    for (let time = 0; time <= 2.6; time += 1 / 30) {
      sequential.at(time);
    }
    const seeked = new OfflineAudioBands(samples, SAMPLE_RATE);

    assert.deepEqual(seeked.at(2.6).onsets, sequential.at(2.6).onsets);
  });
});

describe("audio impulses", () => {
  it("fires once per click, peaks and decays to 10% within 150 ms", () => {
    const frames = readBands(clickTrack(3), 60, 0.9, 2.99);

    for (const band of ["impulseLow", "impulseHigh"] as const) {
      const hits = hitTimes(frames, band);
      assert.equal(hits.length, 4, `${band} hits at ${hits}`);
      hits.forEach((time, index) => {
        assert.ok(Math.abs(time - (1 + index * 0.5)) < 0.03, `${band} ${time}`);
        const at = frames.findIndex((frame) => frame.time === time);
        const peak = frames[at][band];
        assert.ok(peak > 0.8, `${band} peak was ${peak}`);
        assert.ok(frames[at + 9][band] <= peak * 0.1 + 1e-9);
        assert.ok(frames[at + 24][band] < 0.01);
      });
    }
  });

  it("stays near 0 on steady noise and a sustained tone", () => {
    assert.ok(maxImpulse(readBands(hissTrack(3), 60, 1, 3)) < 0.05);
    assert.ok(maxImpulse(readBands(toneTrack(3), 60, 1, 3)) < 0.05);
  });

  it("stays at 0 in silence", () => {
    const frames = readBands(new Float32Array(2 * SAMPLE_RATE), 60, 0, 2);
    assert.equal(maxImpulse(frames), 0);
  });

  it("gives the same export impulses at 30, 60 and 120 fps", () => {
    const samples = clickTrack(3);
    const reference = readBands(samples, 30, 0.9, 2.9);
    for (const fps of [60, 120]) {
      const frames = readBands(samples, fps, 0.9, 2.9);
      for (const expected of reference) {
        const actual = frames.find(
          (frame) => Math.abs(frame.time - expected.time) < 1e-9,
        );
        assert.ok(actual, `${fps} fps has no frame at ${expected.time}`);
        assert.ok(Math.abs(actual.impulseLow - expected.impulseLow) < 1e-9);
        assert.ok(Math.abs(actual.impulseHigh - expected.impulseHigh) < 1e-9);
      }
    }
  });

  it("gives the same live impulses at 30, 60 and 120 fps", () => {
    // Analyser bins: both bands jump for 40 ms every half second.
    const binsAt = (time: number) => {
      const bins = new Uint8Array(512);
      if (time % 0.5 < 0.04) {
        bins.fill(200, 1, 6);
        bins.fill(200, 43, 214);
      }
      return bins;
    };
    const playLive = (fps: number) => {
      const tracker = new AudioBandTracker();
      const frames = new Map<number, AudioBands>();
      for (let frame = 0; frame <= 3 * fps; frame++) {
        tracker.advance(binsAt(frame / fps), SAMPLE_RATE, frame ? 1 / fps : 0);
        frames.set(Math.round((frame / fps) * 120), tracker.bands());
      }
      return frames;
    };

    const reference = playLive(30);
    const hits = [...reference.values()].filter(
      (bands) => bands.impulseLow > 0.9,
    );
    assert.equal(hits.length, 6);
    for (const fps of [60, 120]) {
      const frames = playLive(fps);
      for (const [key, expected] of reference) {
        if (key < 120) {
          continue;
        }
        const actual = frames.get(key) as AudioBands;
        assert.ok(Math.abs(actual.impulseLow - expected.impulseLow) < 1e-6);
        assert.ok(Math.abs(actual.impulseHigh - expected.impulseHigh) < 1e-6);
      }
    }
  });

  it("detects the same hits after a seek as when rendered in sequence", () => {
    const samples = clickTrack(4);
    const sequential = new OfflineAudioBands(samples, SAMPLE_RATE);
    for (let frame = 0; frame <= 60; frame++) {
      sequential.at(frame / 30);
    }
    const seeked = new OfflineAudioBands(samples, SAMPLE_RATE);
    const time = 2 + 1 / 60;
    const expected = sequential.at(time);
    const actual = seeked.at(time);

    assert.ok(expected.impulseLow > 0.8);
    assert.ok(Math.abs(actual.impulseLow - expected.impulseLow) < 1e-6);
    assert.ok(Math.abs(actual.impulseHigh - expected.impulseHigh) < 1e-6);
  });
});
