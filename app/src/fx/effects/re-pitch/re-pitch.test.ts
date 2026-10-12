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
  CENTS_KEY,
  formatCents,
  formatSemitones,
  RE_PITCH_EFFECT_NAME,
  rePitchRate,
  SEMITONES_KEY,
} from "./re-pitch.ts";

const SAMPLE_RATE = 8000;
const BPM = 120;
const registry = createProcessorRegistry([
  gainProcessor,
  reverseProcessor,
  processor,
]);

function rePitch(semitones: number, cents = 0, enabled = true): AudioStage {
  return {
    id: "re-pitch",
    effectName: RE_PITCH_EFFECT_NAME,
    enabled,
    numbers: { [SEMITONES_KEY]: semitones, [CENTS_KEY]: cents },
    switches: {},
  };
}

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
  it("is a clip-only audio effect with semitone and cent knobs", () => {
    const definition = getEffectDefinition(RE_PITCH_EFFECT_NAME);
    assert.equal(definition.domain, "audio");
    assert.equal(definition.category, "utility");
    assert.deepEqual(definition.scopes, ["clip"]);
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [parameter.key, parameter.min, parameter.max, parameter.defaultValue]
          : [],
      ),
      [
        [SEMITONES_KEY, -12, 12, 0],
        [CENTS_KEY, -100, 100, 0],
      ],
    );
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
    assert.ok(up.subarray(1.01 * SAMPLE_RATE, 1.5 * SAMPLE_RATE).every((v) => v === 0));
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
});
