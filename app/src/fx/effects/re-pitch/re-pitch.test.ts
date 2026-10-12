import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderClipSpan } from "../../../audio-mix/clip-span.ts";
import type { DecodedAudio } from "../../../audio-mix/mix.ts";
import { renderAudioMix } from "../../../audio-mix/mix.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { AUDIO_PROCESSORS } from "../../../audio-mix/processors.ts";
import type { AudioMix, AudioMixClip } from "../../../audio-mix/resolve.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import { processor as gainProcessor, gainStageAt } from "../gain/processor.ts";
import { processor as reverseProcessor } from "../reverse/processor.ts";
import { REVERSE_EFFECT_NAME } from "../reverse/reverse.ts";
import { processor } from "./processor.ts";
import {
  ALGORITHM_DEFAULT,
  ALGORITHM_FORMANTS,
  ALGORITHM_KEY,
  ALGORITHM_OPTIONS,
  ALGORITHM_TAPE,
  ALGORITHM_TRANSIENTS,
  CENTS_KEY,
  FORMANTS_DEFAULT,
  FORMANTS_KEY,
  formatCents,
  formatSemitones,
  RE_PITCH_EFFECT_NAME,
  rePitchFrameSize,
  rePitchRate,
  SEMITONES_KEY,
  TRANSIENTS_DEFAULT,
  TRANSIENTS_KEY,
} from "./re-pitch.ts";

const SAMPLE_RATE = 8000;
const BPM = 120;
const registry = createProcessorRegistry([
  gainProcessor,
  reverseProcessor,
  processor,
]);

function rePitch(
  semitones: number,
  cents = 0,
  enabled = true,
  algorithm?: string,
  amounts: Record<string, number> = {},
): AudioStage {
  return {
    id: "re-pitch",
    effectName: RE_PITCH_EFFECT_NAME,
    enabled,
    // Every knob, as a session's stage has them.
    numbers: {
      [SEMITONES_KEY]: semitones,
      [CENTS_KEY]: cents,
      [TRANSIENTS_KEY]: TRANSIENTS_DEFAULT,
      [FORMANTS_KEY]: FORMANTS_DEFAULT,
      ...amounts,
    },
    switches: algorithm ? { [ALGORITHM_KEY]: algorithm } : {},
  };
}

const TIME_PRESERVING = [ALGORITHM_TRANSIENTS, ALGORITHM_FORMANTS];

const reverse: AudioStage = {
  id: "reverse",
  effectName: REVERSE_EFFECT_NAME,
  enabled: true,
  numbers: {},
  switches: {},
};

// A source whose sample at second `s` is `s / 100`: rising, and well below
// the limiter's knee.
function ramp(seconds: number): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] = index / SAMPLE_RATE / 100;
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function sine(seconds: number, hz: number): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] = 0.25 * Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE);
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

// The clip plays the media's first second from 0.5 s to 1.5 s.
function clip(stages: AudioStage[]): AudioMixClip {
  return {
    id: "a",
    mediaId: "a",
    startSeconds: 0.5,
    durationSeconds: 1,
    sourceOffsetSeconds: -0.5,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 3,
    effects: [],
    amplitude: 1,
    hasGain: true,
    busId: "bus",
    stages: [gainStageAt(1), ...stages],
  };
}

function render(mixClip: AudioMixClip, media: DecodedAudio, seconds = 2) {
  const mix: AudioMix = {
    clips: [mixClip],
    buses: [{ id: "bus", stages: [] }],
    master: [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: BPM,
    signature: DEFAULT_TIME_SIGNATURE,
  };
  const [output] = renderAudioMix(
    mix,
    new Map([["a", media]]),
    {
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      startSeconds: 0,
      length: Math.round(seconds * SAMPLE_RATE),
    },
    registry,
  );
  return output;
}

// The power of `output` at `hz` between two timeline seconds, Hann-windowed
// so neighboring tones do not leak into it.
function power(output: Float32Array, hz: number, from: number, to: number) {
  const start = Math.round(from * SAMPLE_RATE);
  const length = Math.round(to * SAMPLE_RATE) - start;
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < length; index++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
    const angle = (2 * Math.PI * hz * index) / SAMPLE_RATE;
    real += output[start + index] * window * Math.cos(angle);
    imaginary += output[start + index] * window * Math.sin(angle);
  }
  return (real * real + imaginary * imaginary) / length;
}

function peak(output: Float32Array, from: number, to: number) {
  let max = 0;
  for (
    let index = Math.round(from * SAMPLE_RATE);
    index < Math.round(to * SAMPLE_RATE);
    index++
  ) {
    max = Math.max(max, Math.abs(output[index]));
  }
  return max;
}

function at(output: Float32Array, seconds: number) {
  return output[Math.round(seconds * SAMPLE_RATE)];
}

function close(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message ?? ""} ${actual} != ${expected}`,
  );
}

// The frequency of a tone from its rising zero crossings between two
// timeline seconds.
function frequency(output: Float32Array, from: number, to: number) {
  let crossings = 0;
  const start = Math.round(from * SAMPLE_RATE);
  const end = Math.round(to * SAMPLE_RATE);
  for (let index = start + 1; index < end; index++) {
    if (output[index - 1] < 0 && output[index] >= 0) {
      crossings++;
    }
  }
  return crossings / (to - from);
}

describe("Re-Pitch", () => {
  it("is a clip-only audio effect with an algorithm and its knobs", () => {
    const definition = getEffectDefinition(RE_PITCH_EFFECT_NAME);
    assert.equal(definition.domain, "audio");
    assert.equal(definition.category, "utility");
    assert.deepEqual(definition.scopes, ["clip"]);
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [
              parameter.key,
              parameter.min,
              parameter.max,
              parameter.defaultValue,
              parameter.visibleWhen?.values,
            ]
          : parameter.kind === "enum"
            ? [parameter.key, parameter.options, parameter.defaultValue]
            : [],
      ),
      [
        [ALGORITHM_KEY, ALGORITHM_OPTIONS, ALGORITHM_TAPE],
        [SEMITONES_KEY, -12, 12, 0, undefined],
        [CENTS_KEY, -100, 100, 0, undefined],
        [TRANSIENTS_KEY, 0, 1, 1, [ALGORITHM_TRANSIENTS]],
        [FORMANTS_KEY, 0, 1, 1, [ALGORITHM_FORMANTS]],
      ],
    );
    assert.deepEqual(ALGORITHM_OPTIONS, ["Tape", "Transients", "Formants"]);
    assert.equal(ALGORITHM_DEFAULT, ALGORITHM_TAPE);
    assert.notEqual(
      definition.accent,
      getEffectDefinition(REVERSE_EFFECT_NAME).accent,
    );
    assert.equal(AUDIO_PROCESSORS.get(RE_PITCH_EFFECT_NAME), processor);
  });

  it("formats its knobs as signed semitones and cents", () => {
    assert.equal(formatSemitones(0), "0 st");
    assert.equal(formatSemitones(7), "+7 st");
    assert.equal(formatSemitones(-12), "−12 st");
    assert.equal(formatCents(25), "+25 ct");
    assert.equal(formatCents(-100), "−100 ct");
  });

  it("plays an octave up at double speed and an octave down at half", () => {
    assert.equal(rePitchRate(12), 2);
    assert.equal(rePitchRate(-12), 0.5);
    assert.equal(rePitchRate(0), 1);
    close(rePitchRate(0, 100), rePitchRate(1));
    close(rePitchRate(7, -50), 2 ** (6.5 / 12));
    // Clamped to the knobs' ranges.
    assert.equal(rePitchRate(24, 300), 2 ** (13 / 12));
  });

  it("raises a tone an octave at +12 and lowers it an octave at −12", () => {
    const media = sine(3, 200);
    const plain = render(clip([]), media);
    assert.ok(Math.abs(frequency(plain, 0.5, 1.5) - 200) <= 1, "plain");
    const up = render(clip([rePitch(12)]), media);
    // Sped up, the clip's window runs out halfway through.
    assert.ok(Math.abs(frequency(up, 0.5, 1) - 400) <= 2, "up");
    assert.ok(
      up.subarray(1.01 * SAMPLE_RATE, 1.5 * SAMPLE_RATE).every((v) => v === 0),
    );
    const down = render(clip([rePitch(-12)]), media);
    assert.ok(Math.abs(frequency(down, 0.5, 1.5) - 100) <= 1, "down");
  });

  it("reads the clip's media faster or slower from its start", () => {
    const media = ramp(3);
    const up = render(clip([rePitch(12)]), media);
    close(at(up, 0.75), 0.005);
    close(at(up, 0.95), 0.009);
    assert.equal(at(up, 1.25), 0);
    const down = render(clip([rePitch(-12)]), media);
    close(at(down, 1), 0.0025);
    close(at(down, 1.4), 0.0045);
    // Silent outside the clip.
    assert.equal(at(down, 0.25), 0);
    assert.equal(at(down, 1.75), 0);
  });

  it("passes the clip through unchanged at 0, bypassed or removed", () => {
    const media = sine(3, 200);
    const plain = render(clip([]), media);
    assert.deepEqual(render(clip([rePitch(0)]), media), plain);
    assert.deepEqual(render(clip([rePitch(12, 0, false)]), media), plain);
  });

  it("re-pitches the reversed sound when it follows Reverse", () => {
    const media = ramp(3);
    // Reverse first: the reversed sound, from the media's 1 s down to 0 s,
    // plays at half speed, so it ends on the media's 0.5 s.
    const after = render(clip([reverse, rePitch(-12)]), media);
    close(at(after, 0.6), 0.0095);
    close(at(after, 1), 0.0075);
    // Re-Pitch first: the slowed sound, from the media's 0 s to 0.5 s,
    // plays backwards.
    const before = render(clip([rePitch(-12), reverse]), media);
    close(at(before, 1), 0.0025);
    close(at(before, 1.4), 0.0005);
  });

  it("plays the same in the preview's decoded buffer as in export", () => {
    const media = sine(3, 330);
    const shifted = clip([rePitch(-5, 30)]);
    const exported = render(shifted, media);
    const preview = renderClipSpan(shifted, media, BPM, SAMPLE_RATE, 1);
    const start = Math.round(shifted.startSeconds * SAMPLE_RATE);
    for (let index = 0; index < preview[0].length; index++) {
      close(preview[0][index], exported[start + index], `${index}`);
    }
  });

  it("adds no latency at Tape, as before the Algorithm existed", () => {
    for (const stage of [rePitch(7), rePitch(7, 0, true, ALGORITHM_TAPE)]) {
      assert.equal(processor.latencyFrames?.(stage, 48_000), 0);
      assert.equal(processor.tailSeconds?.(stage, { bpm: BPM, signature: DEFAULT_TIME_SIGNATURE }), 0);
    }
    for (const algorithm of TIME_PRESERVING) {
      assert.equal(
        processor.latencyFrames?.(rePitch(7, 0, true, algorithm), 48_000),
        rePitchFrameSize(48_000),
      );
    }
    assert.equal(rePitchFrameSize(44_100), 2048);
    assert.equal(rePitchFrameSize(48_000), 2048);
    assert.equal(rePitchFrameSize(SAMPLE_RATE), 512);
  });

  for (const algorithm of TIME_PRESERVING) {
    describe(`at ${algorithm}`, () => {
      it("raises a tone an octave at +12 and keeps its timing", () => {
        const up = render(clip([rePitch(12, 0, true, algorithm)]), sine(3, 200));
        // An octave up from start to end, rather than running out halfway.
        for (const [from, to] of [
          [0.55, 0.95],
          [1.05, 1.45],
        ]) {
          assert.ok(
            power(up, 400, from, to) > 100 * power(up, 200, from, to),
            `${from}–${to}`,
          );
          assert.ok(peak(up, from, to) > 0.2, `${from}–${to} level`);
        }
        // Silent before the clip and once its last frame has played.
        assert.ok(peak(up, 0, 0.4) < 1e-3, "before");
        assert.ok(peak(up, 1.65, 2) < 1e-3, "after");
      });

      it("lowers a tone an octave at −12 and keeps its timing", () => {
        const down = render(
          clip([rePitch(-12, 0, true, algorithm)]),
          sine(3, 400),
        );
        for (const [from, to] of [
          [0.55, 0.95],
          [1.05, 1.45],
        ]) {
          assert.ok(
            power(down, 200, from, to) > 100 * power(down, 400, from, to),
            `${from}–${to}`,
          );
        }
      });

      it("passes the clip through in time at 0", () => {
        const media = sine(3, 200);
        const plain = render(clip([]), media);
        const shifted = render(clip([rePitch(0, 0, true, algorithm)]), media);
        for (let seconds = 0.6; seconds < 1.4; seconds += 0.01) {
          assert.ok(
            Math.abs(at(shifted, seconds) - at(plain, seconds)) < 1e-3,
            `${seconds}`,
          );
        }
      });

      it("reads the clip's media as it is in the preview's buffer", () => {
        const media = sine(3, 330);
        const plain = clip([]);
        const shifted = clip([rePitch(-5, 30, true, algorithm)]);
        assert.deepEqual(
          renderClipSpan(shifted, media, BPM, SAMPLE_RATE, 1),
          renderClipSpan(plain, media, BPM, SAMPLE_RATE, 1),
        );
      });
    });
  }

  // A hit every quarter second from the media's 0.1 s: a 600 Hz tone that
  // starts at full level and dies away over 40 ms.
  function hits(seconds: number): DecodedAudio {
    const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
    for (let index = 0; index < data.length; index++) {
      const time = (index / SAMPLE_RATE - 0.1 + 0.25) % 0.25;
      if (index / SAMPLE_RATE >= 0.1) {
        data[index] =
          0.5 *
          Math.cos(2 * Math.PI * 600 * time) *
          Math.exp(-time / 0.04);
      }
    }
    return { sampleRate: SAMPLE_RATE, channels: [data] };
  }

  for (const semitones of [7, -7]) {
    it(`keeps each attack crisp and in time at Transients, ${semitones} st`, () => {
      const crisp = render(
        clip([rePitch(semitones, 0, true, ALGORITHM_TRANSIENTS)]),
        hits(3),
      );
      // The clip plays the hits from 0.6 s on.
      for (const onset of [0.6, 0.85, 1.1, 1.35]) {
        assert.ok(peak(crisp, onset, onset + 0.003) > 0.4, `${onset} attack`);
        // Nothing of it played early, and the hit before has died away.
        assert.ok(
          peak(crisp, onset - 0.03, onset - 0.003) < 0.03,
          `${onset} before`,
        );
      }
    });
  }

  // A 150 Hz pulse train through a resonance at 1200 Hz, like a voice
  // holding a vowel.
  function vowel(seconds: number): DecodedAudio {
    const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
    const radius = 0.97;
    const theta = (2 * Math.PI * 1200) / SAMPLE_RATE;
    const a1 = 2 * radius * Math.cos(theta);
    const a2 = -radius * radius;
    let y1 = 0;
    let y2 = 0;
    const period = SAMPLE_RATE / 150;
    for (let index = 0; index < data.length; index++) {
      const pulse = index % period < 1 ? 0.02 : 0;
      const y = pulse + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      data[index] = y;
    }
    return { sampleRate: SAMPLE_RATE, channels: [data] };
  }

  // The frequency of the loudest harmonic of `pitch` in the clip's middle.
  function loudestHarmonic(output: Float32Array, pitch: number) {
    let best = 0;
    let bestPower = 0;
    for (let harmonic = 1; harmonic * pitch < SAMPLE_RATE / 2 - 100; harmonic++) {
      const level = power(output, harmonic * pitch, 0.7, 1.3);
      if (level > bestPower) {
        bestPower = level;
        best = harmonic * pitch;
      }
    }
    return best;
  }

  for (const semitones of [7, -7]) {
    it(`keeps the formant in place at Formants, ${semitones} st`, () => {
      const ratio = rePitchRate(semitones);
      const media = vowel(3);
      const kept = render(
        clip([rePitch(semitones, 0, true, ALGORITHM_FORMANTS)]),
        media,
      );
      const moved = render(
        clip([
          rePitch(semitones, 0, true, ALGORITHM_FORMANTS, { [FORMANTS_KEY]: 0 }),
        ]),
        media,
      );
      const pitch = 150 * ratio;
      // Its harmonics are shifted: none is left at the source's 1050 Hz,
      // near the resonance.
      assert.ok(
        power(kept, loudestHarmonic(kept, pitch), 0.7, 1.3) >
          10 * power(kept, 1050, 0.7, 1.3),
      );
      assert.ok(
        Math.abs(loudestHarmonic(kept, pitch) - 1200) < pitch,
        `kept ${loudestHarmonic(kept, pitch)}`,
      );
      assert.ok(
        Math.abs(loudestHarmonic(moved, pitch) - 1200 * ratio) < pitch,
        `moved ${loudestHarmonic(moved, pitch)}`,
      );
    });
  }
});
