import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DecodedAudio } from "../../../audio-mix/mix.ts";
import { renderAudioMix } from "../../../audio-mix/mix.ts";
import { renderClipSpan } from "../../../audio-mix/preview-buffer-voice.ts";
import {
  type AudioStage,
  createProcessorRegistry,
  DEFAULT_TIME_SIGNATURE,
} from "../../../audio-mix/processor.ts";
import { AUDIO_PROCESSORS } from "../../../audio-mix/processors.ts";
import type { AudioMix, AudioMixClip } from "../../../audio-mix/resolve.ts";
import type { ClipWarp } from "../../../clip-warp.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import {
  gainStageAt,
  processor as gainProcessor,
} from "../gain/processor.ts";
import { processor } from "./processor.ts";
import { REVERSE_EFFECT_NAME, reverseReadSeconds } from "./reverse.ts";

const SAMPLE_RATE = 8000;
const BPM = 120;
const registry = createProcessorRegistry([gainProcessor, processor]);

function reverse(enabled = true): AudioStage {
  return {
    id: "reverse",
    effectName: REVERSE_EFFECT_NAME,
    enabled,
    numbers: {},
    switches: {},
  };
}

// A source whose sample at second `s` is `s / 100`: rising, and well below
// the limiter's knee.
function ramp(seconds: number): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] = index / SAMPLE_RATE / 100;
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

// Deterministic noise, so failures reproduce.
function noise(seconds: number): DecodedAudio {
  let state = 7;
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    data[index] = 0.5 * (state / 2 ** 32 - 0.5);
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function clip(overrides: Partial<AudioMixClip> = {}): AudioMixClip {
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
    stages: [gainStageAt(1), reverse()],
    ...overrides,
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

describe("Reverse", () => {
  it("is a clip-only audio effect with no parameters", () => {
    const definition = getEffectDefinition(REVERSE_EFFECT_NAME);
    assert.equal(definition.domain, "audio");
    assert.deepEqual(definition.scopes, ["clip"]);
    assert.deepEqual(definition.parameters, []);
    assert.notEqual(definition.accent, getEffectDefinition("Gain").accent);
    assert.equal(AUDIO_PROCESSORS.get(REVERSE_EFFECT_NAME), processor);
  });

  it("mirrors a timeline second within the clip's span", () => {
    const span = { startSeconds: 2, endSeconds: 5 };
    assert.equal(reverseReadSeconds(2, span), 5);
    assert.equal(reverseReadSeconds(3, span), 4);
    assert.equal(reverseReadSeconds(4.5, span), 2.5);
  });

  it("plays a rising ramp falling over the clip's span", () => {
    // The clip plays the media's first second from 0.5 s to 1.5 s.
    const output = render(clip(), ramp(3));
    close(at(output, 0.75), 0.0075);
    close(at(output, 1), 0.005);
    close(at(output, 1.25), 0.0025);
    const from = Math.round(0.5 * SAMPLE_RATE) + 1;
    const to = Math.round(1.5 * SAMPLE_RATE);
    for (let index = from + 1; index < to; index++) {
      assert.ok(output[index] < output[index - 1], `${index}`);
    }
    // Silent outside it.
    assert.equal(at(output, 0.25), 0);
    assert.equal(at(output, 1.75), 0);
  });

  it("reverses the clip's own window when it is trimmed", () => {
    // Trimmed to play the media's 1 s to 1.5 s from 0.5 s to 1 s.
    const trimmed = clip({
      durationSeconds: 0.5,
      sourceOffsetSeconds: 0.5,
      sourceWindowStartSeconds: 1,
      sourceWindowEndSeconds: 1.5,
    });
    const output = render(trimmed, ramp(3));
    close(at(output, 0.625), 0.01375);
    close(at(output, 0.875), 0.01125);
    assert.equal(at(output, 1.25), 0);
  });

  it("mirrors the forward timing through warp markers", () => {
    // Half speed over the first beat (0.5 s), then 1.5x over the second.
    const warp: ClipWarp = {
      markers: [
        { beatTime: 0, secTime: 0 },
        { beatTime: 1, secTime: 0.25 },
        { beatTime: 2, secTime: 1 },
      ],
      contentStartBeat: 0,
      anchorSeconds: 0,
    };
    const media = ramp(3);
    const forward = render(clip({ warp, stages: [gainStageAt(1)] }), media);
    const reversed = render(clip({ warp }), media);
    // The reversed clip at 0.5 s + x plays what the forward clip plays at
    // 1.5 s - x.
    const start = 0.5 * SAMPLE_RATE;
    const end = 1.5 * SAMPLE_RATE;
    for (let index = start + 1; index < end; index++) {
      assert.ok(
        Math.abs(reversed[index] - forward[start + end - index]) < 1e-5,
        `${index}`,
      );
    }
    // The slow first half of the forward clip is the slow second half here.
    close(at(reversed, 1.25), 0.00125, "slow");
    close(at(reversed, 0.75), 0.00625, "fast");
  });

  it("plays the same in the preview's decoded buffer as in export", () => {
    const media = noise(3);
    const reversed = clip();
    const exported = render(reversed, media);
    const preview = renderClipSpan(reversed, media, BPM, SAMPLE_RATE, 1);
    const start = Math.round(reversed.startSeconds * SAMPLE_RATE);
    for (let index = 0; index < preview[0].length; index++) {
      close(preview[0][index], exported[start + index], `${index}`);
    }
  });

  it("passes the clip through unchanged when bypassed or removed", () => {
    const media = noise(3);
    const plain = render(clip({ stages: [gainStageAt(1)] }), media);
    const bypassed = render(
      clip({ stages: [gainStageAt(1), reverse(false)] }),
      media,
    );
    assert.deepEqual(bypassed, plain);
  });

  it("feeds the reversed sound to the effects after it", () => {
    const halved = render(
      clip({ stages: [reverse(), gainStageAt(0.5)] }),
      ramp(3),
    );
    close(at(halved, 0.75), 0.00375);
  });
});
