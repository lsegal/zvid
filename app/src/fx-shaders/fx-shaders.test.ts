// The shader modules reference WebGL and Web Audio types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFECT_PASSES } from "../fx/effects/index.generated.ts";
import { CONTEXT, params, uniformValues } from "../fx/pass-test-utils.ts";
import { applyClipAnimationWeight } from "../fx-animation-clip.ts";
import {
  getAnimationNeutralValues,
  supportsAnimation,
} from "../fx-animation-defaults.ts";
import { getEffectDefinition } from "../fx-registry.ts";
import {
  type AudioBands,
  AudioBandTracker,
  LiveAudioBands,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./audio-bands.ts";
import {
  type ChainEffect,
  isChainEffectName,
  resolveEffectChain,
} from "./registry.ts";
import { type EffectContext, readEffectNumber } from "./types.ts";

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
    for (const pass of EFFECT_PASSES) {
      assert.deepEqual(
        Object.keys(uniformValues(pass, [])).sort(),
        [...pass.uniforms].sort(),
        pass.effectName,
      );
    }
  });

  // The music moves an effect only through its Animation modifier's Reactive
  // mode, which changes the parameters a pass is given, never the pass itself.
  it("reads no main-audio uniforms", () => {
    for (const pass of EFFECT_PASSES) {
      assert.doesNotMatch(pass.fragmentSource, /impulse|audio/i);
      for (const uniform of pass.uniforms) {
        assert.doesNotMatch(uniform, /impulse|audio/i);
      }
    }
  });

  it("draws the same before and after an audio hit", () => {
    // The main audio at a hit, as the pass contexts used to carry it.
    const hit = {
      ...CONTEXT,
      audioLow: 1,
      audioHigh: 1,
      impulseLow: 1,
      impulseHigh: 1,
    } as EffectContext;
    for (const pass of EFFECT_PASSES) {
      // Every knob at a mid value, so any audio term that scaled one shows.
      const parameters = params(
        Object.fromEntries(
          getEffectDefinition(pass.effectName)
            .parameters.filter((parameter) => parameter.kind === "number")
            .map((parameter) => [parameter.key, 0.5]),
        ),
      );
      assert.deepEqual(
        uniformValues(pass, parameters, hit),
        uniformValues(pass, parameters),
        pass.effectName,
      );
    }
  });

  // Clip mode at weight 0 runs every knob back to its neutral value, which
  // must cost no pass.
  it("changes nothing at Clip animation weight 0, and something at 0.5", () => {
    for (const pass of EFFECT_PASSES) {
      const parameters = params(
        Object.fromEntries(
          getEffectDefinition(pass.effectName)
            .parameters.filter((parameter) => parameter.kind === "number")
            .map((parameter) => [parameter.key, 0.5]),
        ),
      );
      assert.equal(pass.isIdentity?.(parameters), false, pass.effectName);
      if (!supportsAnimation(pass.effectName)) {
        continue;
      }
      assert.notDeepEqual(
        getAnimationNeutralValues(pass.effectName),
        {},
        pass.effectName,
      );
      const neutral = applyClipAnimationWeight(
        { effectName: pass.effectName, parameters },
        0,
      );
      assert.equal(pass.isIdentity?.(neutral), true, pass.effectName);
    }
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

  it("matches keys case- and punctuation-insensitively, first match first", () => {
    const params = [
      { key: "hue offset", value: "0.1" },
      { key: "_HueOffset", value: "0.2" },
    ];

    assert.equal(readEffectNumber(params, "_HueOffset", 0), 0.1);
    assert.equal(readEffectNumber(params, "HUE-OFFSET", 0), 0.1);
  });

  it("reads an edited parameter list afresh", () => {
    const before = [{ key: "_Amount", value: "0.1" }];
    const after = [{ key: "_Amount", value: "0.9" }];

    assert.equal(readEffectNumber(before, "_Amount", 0), 0.1);
    assert.equal(readEffectNumber(after, "_Amount", 0), 0.9);
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

  it("detects the same hits after many windows as just after a seek", () => {
    const samples = clickTrack(20);
    const sequential = new OfflineAudioBands(samples, SAMPLE_RATE);
    for (let time = 0; time <= 19.6; time += 1 / 30) {
      sequential.at(time);
    }
    const seeked = new OfflineAudioBands(samples, SAMPLE_RATE);
    const expected = (seeked.at(19.6).onsets ?? []).map((onset) => ({
      ...onset,
    }));

    assert.equal(expected.length, 2);
    assert.deepEqual(sequential.at(19.6).onsets, expected);
  });

  it("reuses one onsets array, aging each hit from call to call", () => {
    const tracker = new AudioBandTracker();
    const quiet = new Uint8Array(512);
    const hit = new Uint8Array(512).fill(200, 1, 6);
    tracker.step(quiet, SAMPLE_RATE);
    tracker.step(hit, SAMPLE_RATE);
    const first = tracker.bands(0).onsets;
    assert.equal(first?.length, 1);
    assert.equal(first[0].secondsAgo, 0);

    tracker.step(quiet, SAMPLE_RATE);
    const second = tracker.bands(0.005).onsets;
    assert.equal(second, first);
    assert.ok(
      Math.abs((second?.[0].secondsAgo ?? 0) - (1 / 60 + 0.005)) < 1e-9,
    );
  });
});

describe("LiveAudioBands", () => {
  // Counts the analyser reads LiveAudioBands makes.
  function countingAnalyser() {
    const analyser = {
      reads: 0,
      context: { sampleRate: SAMPLE_RATE },
      getByteFrequencyData(bins: Uint8Array) {
        analyser.reads += 1;
        bins.fill(0);
      },
    };
    return analyser;
  }

  it("reads the analyser on each sample it is given", () => {
    const live = new LiveAudioBands();
    const analyser = countingAnalyser();
    live.sample(analyser as unknown as AnalyserNode, 0);
    live.sample(analyser as unknown as AnalyserNode, 16);
    assert.equal(analyser.reads, 2);
  });

  it("measures nothing without an analyser", () => {
    const live = new LiveAudioBands();
    assert.deepEqual(live.sample(null, 0), SILENT_AUDIO_BANDS);
    assert.deepEqual(live.sample(null, 16), SILENT_AUDIO_BANDS);
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
